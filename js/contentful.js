/* ── Contentful client ───────────────────────────────────────────────── */

const CF = (() => {
  const KEY = 'pignocchi_cf';

  /* Public delivery credentials — read-only, safe to expose */
  const PUBLIC_SPACE_ID = 'fejt7dmbrv9e';
  const PUBLIC_DELIVERY_TOKEN = 'tOHgPb2AaW4raBzCEnxzs5QhFMnNdyOGJDF3sTKGAgc';

  function cfg() {
    try {
      const stored = JSON.parse(localStorage.getItem(KEY)) || {};
      /* Fall back to hardcoded public credentials if not set */
      if (!stored.spaceId)      stored.spaceId      = PUBLIC_SPACE_ID;
      if (!stored.deliveryToken) stored.deliveryToken = PUBLIC_DELIVERY_TOKEN;
      return stored;
    } catch { return { spaceId: PUBLIC_SPACE_ID, deliveryToken: PUBLIC_DELIVERY_TOKEN }; }
  }
  function saveCfg(obj) { localStorage.setItem(KEY, JSON.stringify(obj)); }

  function hasReadAccess() {
    const c = cfg();
    return !!(c.spaceId && c.deliveryToken);
  }

  function hasWriteAccess() {
    const c = cfg();
    return !!(c.spaceId && c.deliveryToken && c.mgmtToken);
  }

  function isConnected() {
    return hasReadAccess();
  }

  /* ── Delivery API (public read) ── */
  async function get(contentType, params = {}) {
    const c = cfg();
    if (!c.spaceId || !c.deliveryToken) return null;
    const qs = new URLSearchParams({
      content_type: contentType,
      limit: 200,
      ...params
    });
    const r = await fetch(
      `https://cdn.contentful.com/spaces/${c.spaceId}/environments/master/entries?${qs}`,
      { headers: { Authorization: `Bearer ${c.deliveryToken}` } }
    );
    if (!r.ok) return null;
    const data = await r.json();
    /* resolve assets inline */
    const assets = {};
    (data.includes?.Asset || []).forEach(a => {
      assets[a.sys.id] = 'https:' + a.fields.file.url;
    });
    return (data.items || []).map(item => {
      const f = { ...item.fields, _id: item.sys.id };
      /* replace linked asset fields with URL */
      for (const [k, v] of Object.entries(f)) {
        if (v?.sys?.linkType === 'Asset') f[k] = assets[v.sys.id] || null;
      }
      return f;
    });
  }

  /* ── Management API (admin write) ── */
  async function mgmt(method, path, body) {
    const c = cfg();
    if (!c.spaceId || !c.mgmtToken) throw new Error('Management token missing');
    const base = `https://api.contentful.com/spaces/${c.spaceId}/environments/master`;
    const opts = {
      method,
      headers: {
        Authorization: `Bearer ${c.mgmtToken}`,
        'Content-Type': 'application/vnd.contentful.management.v1+json'
      }
    };
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch(base + path, opts);
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json.message || r.statusText);
    return json;
  }

  /* ── Upload an image asset ── */
  async function uploadAsset(file) {
    const c = cfg();
    /* 1. create upload */
    const upR = await fetch(
      `https://upload.contentful.com/spaces/${c.spaceId}/uploads`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${c.mgmtToken}`,
          'Content-Type': 'application/octet-stream'
        },
        body: file
      }
    );
    if (!upR.ok) throw new Error('Upload failed');
    const up = await upR.json();

    /* 2. create asset entry linked to upload */
    const name = file.name.replace(/\.[^.]+$/, '');
    const asset = await mgmt('POST', '/assets', {
      fields: {
        title: { 'en-US': name },
        file: {
          'en-US': {
            contentType: file.type || 'image/jpeg',
            fileName: file.name,
            uploadFrom: { sys: { type: 'Link', linkType: 'Upload', id: up.sys.id } }
          }
        }
      }
    });

    /* 3. process */
    await mgmt('PUT', `/assets/${asset.sys.id}/files/en-US/process`, null);
    await new Promise(r => setTimeout(r, 3000)); /* wait for processing */

    /* 4. publish with correct version */
    const processed = await mgmt('GET', `/assets/${asset.sys.id}`);
    const cfgNow = cfg();
    const pubResp = await fetch(
      `https://api.contentful.com/spaces/${cfgNow.spaceId}/environments/master/assets/${asset.sys.id}/published`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${cfgNow.mgmtToken}`,
          'X-Contentful-Version': processed.sys.version,
          'Content-Type': 'application/vnd.contentful.management.v1+json'
        }
      }
    );
    if (!pubResp.ok) {
      const err = await pubResp.json().catch(() => ({}));
      throw new Error(err.message || 'Asset publish failed');
    }
    return asset.sys.id;
  }

  /* ── Create / update / delete entries ── */
  async function createEntry(contentType, fields) {
    const entry = await mgmt('POST', `/entries`, {
      fields: Object.fromEntries(
        Object.entries(fields).map(([k, v]) => [k, { 'en-US': v }])
      )
    });
    /* set content type */
    await mgmt('PUT', `/entries/${entry.sys.id}`, {
      ...entry,
      sys: { ...entry.sys, contentType: { sys: { type: 'Link', linkType: 'ContentType', id: contentType } } }
    }).catch(() => {});
    /* publish */
    const fresh = await mgmt('GET', `/entries/${entry.sys.id}`);
    await mgmt('PUT', `/entries/${entry.sys.id}/published`, fresh);
    return entry.sys.id;
  }

  async function publishEntry(id, version) {
    const c = cfg();
    const r = await fetch(
      `https://api.contentful.com/spaces/${c.spaceId}/environments/master/entries/${id}/published`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${c.mgmtToken}`,
          'X-Contentful-Version': version,
          'Content-Type': 'application/vnd.contentful.management.v1+json'
        }
      }
    );
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.message || 'Publish failed');
    }
    return r.json();
  }

  async function updateEntry(id, fields) {
    const existing = await mgmt('GET', `/entries/${id}`);
    const c = cfg();
    const r = await fetch(
      `https://api.contentful.com/spaces/${c.spaceId}/environments/master/entries/${id}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${c.mgmtToken}`,
          'Content-Type': 'application/vnd.contentful.management.v1+json',
          'X-Contentful-Version': existing.sys.version
        },
        body: JSON.stringify({
          fields: Object.fromEntries(
            Object.entries(fields).map(([k, v]) => [k, { 'en-US': v }])
          )
        })
      }
    );
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.message || 'Update failed');
    }
    const updated = await r.json();
    await publishEntry(id, updated.sys.version);
    return updated;
  }

  async function deleteEntry(id) {
    const e = await mgmt('GET', `/entries/${id}`);
    if (e.sys.publishedVersion) await mgmt('DELETE', `/entries/${id}/published`);
    await mgmt('DELETE', `/entries/${id}`);
  }

  /* ── Create content types (first-time setup) ── */
  async function createContentTypes() {
    const types = [
      {
        id: 'photo',
        name: 'Photo',
        fields: [
          { id: 'title',    name: 'Title',       type: 'Symbol',  required: true },
          { id: 'image',    name: 'Image',        type: 'Link', linkType: 'Asset', required: true },
          { id: 'series',   name: 'Series',       type: 'Symbol' },
          { id: 'year',     name: 'Year',         type: 'Integer' },
          { id: 'location', name: 'Location',     type: 'Symbol' },
          { id: 'caption',  name: 'Caption',      type: 'Text' },
          { id: 'featured', name: 'Featured',     type: 'Boolean' }
        ],
        displayField: 'title'
      },
      {
        id: 'siteContent',
        name: 'Site Content',
        fields: [
          { id: 'key',                name: 'Key',                 type: 'Symbol', required: true },
          { id: 'nameplateSubtitle',  name: 'Entry title',         type: 'Symbol' },
          { id: 'bioText',            name: 'Bio text',            type: 'Text' },
          { id: 'photoIntro',         name: 'Photography intro',   type: 'Text' },
          { id: 'contactInfo',        name: 'Contact info',        type: 'Text' },
          { id: 'heroPosX',           name: 'Hero Position X',     type: 'Integer' },
          { id: 'heroPosY',           name: 'Hero Position Y',     type: 'Integer' },
          { id: 'heroStyle',          name: 'heroStyle',           type: 'Symbol' },
          { id: 'sizeBannerTitle',    name: 'sizeBannerTitle',     type: 'Integer' },
          { id: 'sizeBannerSubtitle', name: 'sizeBannerSubtitle',  type: 'Integer' },
          { id: 'sizeBio',            name: 'sizeBio',             type: 'Integer' },
          { id: 'sizePubs',           name: 'sizePubs',            type: 'Integer' },
          { id: 'sizePhotoIntro',     name: 'sizePhotoIntro',      type: 'Integer' },
          { id: 'sizeLabels',         name: 'sizeLabels',          type: 'Integer' },
          { id: 'sizeFooter',         name: 'sizeFooter',          type: 'Integer' },
          { id: 'bioLineHeight',      name: 'Bio Line Height',     type: 'Integer' },
          { id: 'bgColor',            name: 'bgColor',             type: 'Symbol' },
          { id: 'textColor',          name: 'textColor',           type: 'Symbol' },
          { id: 'logoVariant',        name: 'logoVariant',         type: 'Symbol' },
          { id: 'sizeVenue',          name: 'sizeVenue',           type: 'Integer' },
          { id: 'venueColor',         name: 'venueColor',          type: 'Symbol' },
          { id: 'sizeSublabels',      name: 'sizeSublabels',       type: 'Integer' },
          { id: 'sizeSeemore',        name: 'sizeSeemore',         type: 'Integer' },
          { id: 'nameFont',           name: 'nameFont',            type: 'Symbol' },
          { id: 'nameFontWeight',     name: 'nameFontWeight',      type: 'Integer' },
          { id: 'nameColor',          name: 'nameColor',           type: 'Symbol' },
          { id: 'subFont',            name: 'subFont',             type: 'Symbol' },
          { id: 'subFontWeight',      name: 'subFontWeight',       type: 'Integer' },
          { id: 'subColor',           name: 'subColor',            type: 'Symbol' },
          { id: 'bioFont',            name: 'bioFont',             type: 'Symbol' },
          { id: 'bioFontWeight',      name: 'bioFontWeight',       type: 'Integer' },
          { id: 'bioColor',           name: 'bioColor',            type: 'Symbol' },
          { id: 'pubsFont',           name: 'pubsFont',            type: 'Symbol' },
          { id: 'pubsFontWeight',     name: 'pubsFontWeight',      type: 'Integer' },
          { id: 'pubsColor',          name: 'pubsColor',           type: 'Symbol' },
          { id: 'venueFont',          name: 'venueFont',           type: 'Symbol' },
          { id: 'venueFontWeight',    name: 'venueFontWeight',     type: 'Integer' },
          { id: 'labelsFont',         name: 'labelsFont',          type: 'Symbol' },
          { id: 'labelsFontWeight',   name: 'labelsFontWeight',    type: 'Integer' },
          { id: 'labelsColor',        name: 'labelsColor',         type: 'Symbol' },
          { id: 'sublabelsFont',      name: 'sublabelsFont',       type: 'Symbol' },
          { id: 'sublabelsFontWeight',name: 'sublabelsFontWeight', type: 'Integer' },
          { id: 'sublabelsColor',     name: 'sublabelsColor',      type: 'Symbol' },
          { id: 'seemoreFont',        name: 'seemoreFont',         type: 'Symbol' },
          { id: 'seemoreColor',       name: 'seemoreColor',        type: 'Symbol' },
          { id: 'photoFont',          name: 'photoFont',           type: 'Symbol' },
          { id: 'photoFontWeight',    name: 'photoFontWeight',     type: 'Integer' },
          { id: 'photoColor',         name: 'photoColor',          type: 'Symbol' },
          { id: 'footerFont',         name: 'footerFont',          type: 'Symbol' },
          { id: 'footerColor',        name: 'footerColor',         type: 'Symbol' }
        ],
        displayField: 'key'
      },
      {
        id: 'publication',
        name: 'Publication',
        fields: [
          { id: 'title',       name: 'Title',       type: 'Symbol',  required: true },
          { id: 'venue',       name: 'Venue',       type: 'Symbol' },
          { id: 'year',        name: 'Year',        type: 'Integer' },
          { id: 'link',        name: 'Link',        type: 'Symbol' },
          { id: 'pubType',     name: 'Type',        type: 'Symbol' },
          { id: 'forthcoming', name: 'Forthcoming', type: 'Boolean' },
          { id: 'order',       name: 'Order',       type: 'Integer' },
        ],
        displayField: 'title'
      },
      {
        id: 'talk',
        name: 'Talk',
        fields: [
          { id: 'title',    name: 'Title',    type: 'Symbol',  required: true },
          { id: 'venue',    name: 'Venue',    type: 'Symbol' },
          { id: 'year',     name: 'Year',     type: 'Integer' },
          { id: 'upcoming', name: 'Upcoming', type: 'Boolean' },
          { id: 'talkType', name: 'Type',     type: 'Symbol' },
          { id: 'order',    name: 'Order',    type: 'Integer' },
        ],
        displayField: 'title'
      },
      {
        id: 'siteSettings',
        name: 'Site Settings',
        fields: [
          { id: 'key',                   name: 'Key',                   type: 'Symbol', required: true },
          { id: 'backgroundColor',       name: 'backgroundColor',       type: 'Symbol' },
          { id: 'textColor',             name: 'textColor',             type: 'Symbol' },
          { id: 'fontPrimary',           name: 'fontPrimary',           type: 'Symbol' },
          { id: 'fontSizeBio',           name: 'fontSizeBio',           type: 'Integer' },
          { id: 'fontSizePubs',          name: 'fontSizePubs',          type: 'Integer' },
          { id: 'heroBanner',            name: 'heroBanner',            type: 'Symbol' },
          { id: 'banner1Url',            name: 'banner1Url',            type: 'Symbol' },
          { id: 'banner1PosX',           name: 'banner1PosX',           type: 'Integer' },
          { id: 'banner1PosY',           name: 'banner1PosY',           type: 'Integer' },
          { id: 'banner2Url',            name: 'banner2Url',            type: 'Symbol' },
          { id: 'banner2PosX',           name: 'banner2PosX',           type: 'Integer' },
          { id: 'banner2PosY',           name: 'banner2PosY',           type: 'Integer' },
          { id: 'banner3Url',            name: 'banner3Url',            type: 'Symbol' },
          { id: 'banner3PosX',           name: 'banner3PosX',           type: 'Integer' },
          { id: 'banner3PosY',           name: 'banner3PosY',           type: 'Integer' },
          { id: 'label1Text',            name: 'label1Text',            type: 'Symbol' },
          { id: 'label1Font',            name: 'label1Font',            type: 'Symbol' },
          { id: 'label1Color',           name: 'label1Color',           type: 'Symbol' },
          { id: 'label1Size',            name: 'label1Size',            type: 'Integer' },
          { id: 'label2Text',            name: 'label2Text',            type: 'Symbol' },
          { id: 'label2Font',            name: 'label2Font',            type: 'Symbol' },
          { id: 'label2Color',           name: 'label2Color',           type: 'Symbol' },
          { id: 'label2Size',            name: 'label2Size',            type: 'Integer' },
          { id: 'label3Text',            name: 'label3Text',            type: 'Symbol' },
          { id: 'label3Font',            name: 'label3Font',            type: 'Symbol' },
          { id: 'label3Color',           name: 'label3Color',           type: 'Symbol' },
          { id: 'label3Size',            name: 'label3Size',            type: 'Integer' },
          { id: 'label1Weight',          name: 'label1Weight',          type: 'Integer' },
          { id: 'label2Weight',          name: 'label2Weight',          type: 'Integer' },
          { id: 'label3Weight',          name: 'label3Weight',          type: 'Integer' },
          { id: 'philosophyPortraitUrl', name: 'philosophyPortraitUrl', type: 'Symbol' },
          { id: 'siteTitle',             name: 'siteTitle',             type: 'Symbol' },
          { id: 'logoSize',              name: 'logoSize',              type: 'Integer' },
          { id: 'academiaUrl',           name: 'academiaUrl',           type: 'Symbol' },
          { id: 'philpeopleUrl',         name: 'philpeopleUrl',         type: 'Symbol' },
          { id: 'orcidUrl',              name: 'orcidUrl',              type: 'Symbol' },
          { id: 'instagramUrl',          name: 'instagramUrl',          type: 'Symbol' },
          { id: 'researchGateUrl',       name: 'researchGateUrl',       type: 'Symbol' },
          { id: 'googleScholarUrl',      name: 'googleScholarUrl',      type: 'Symbol' },
          { id: 'secondaryTitleSize',    name: 'secondaryTitleSize',    type: 'Integer' },
          { id: 'contactFormTextColor',  name: 'contactFormTextColor',  type: 'Symbol' },
          { id: 'elsewhereLinkColor',    name: 'elsewhereLinkColor',    type: 'Symbol' }
        ],
        displayField: 'key'
      },
      {
        id: 'series',
        name: 'Series',
        fields: [
          { id: 'name',        name: 'Name',        type: 'Symbol',  required: true },
          { id: 'slug',        name: 'Slug',        type: 'Symbol',  required: true },
          { id: 'description', name: 'Description', type: 'Text' },
          { id: 'coverImage',  name: 'Cover Image', type: 'Link', linkType: 'Asset' },
          { id: 'order',       name: 'Order',       type: 'Integer' }
        ],
        displayField: 'name'
      }
    ];

    const results = [];
    for (const t of types) {
      try {
        const existing = await mgmt('GET', `/content_types/${t.id}`).catch(() => null);

        if (existing) {
          const existingFields = Array.isArray(existing.fields) ? existing.fields : [];
          const existingIds = new Set(existingFields.map(f => f.id));
          const missingFields = t.fields.filter(f => !existingIds.has(f.id));

          let nextVersion = existing.sys.version;
          let status = 'already exists';

          if (missingFields.length) {
            const c = cfg();
            const payload = {
              name: existing.name || t.name,
              displayField: existing.displayField || t.displayField,
              fields: existingFields.concat(
                missingFields.map(f => ({
                  id: f.id,
                  name: f.name,
                  type: f.type,
                  ...(f.linkType ? { linkType: f.linkType } : {}),
                  ...(f.required ? { required: true } : {})
                }))
              )
            };
            const updR = await fetch(
              `https://api.contentful.com/spaces/${c.spaceId}/environments/master/content_types/${t.id}`,
              {
                method: 'PUT',
                headers: {
                  Authorization: `Bearer ${c.mgmtToken}`,
                  'X-Contentful-Version': existing.sys.version,
                  'Content-Type': 'application/vnd.contentful.management.v1+json'
                },
                body: JSON.stringify(payload)
              }
            );
            const upd = await updR.json().catch(() => ({}));
            if (!updR.ok) throw new Error(upd.message || `Could not update content type ${t.id}`);
            nextVersion = upd.sys.version;
            status = 'updated';
          }

          if (!existing.sys.publishedVersion || missingFields.length) {
            const c = cfg();
            await fetch(
              `https://api.contentful.com/spaces/${c.spaceId}/environments/master/content_types/${t.id}/published`,
              {
                method: 'PUT',
                headers: {
                  Authorization: `Bearer ${c.mgmtToken}`,
                  'X-Contentful-Version': nextVersion,
                  'Content-Type': 'application/vnd.contentful.management.v1+json'
                }
              }
            );
            results.push({ id: t.id, status: status === 'updated' ? 'updated + published' : 'published' });
          } else {
            results.push({ id: t.id, status });
          }
          continue;
        }

        const ct = await mgmt('PUT', `/content_types/${t.id}`, {
          name: t.name,
          displayField: t.displayField,
          fields: t.fields.map(f => ({
            id: f.id, name: f.name, type: f.type,
            ...(f.linkType ? { linkType: f.linkType } : {}),
            ...(f.required ? { required: true } : {})
          }))
        });

        /* publish with correct version header */
        const c = cfg();
        await fetch(
          `https://api.contentful.com/spaces/${c.spaceId}/environments/master/content_types/${t.id}/published`,
          {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${c.mgmtToken}`,
              'X-Contentful-Version': ct.sys.version,
              'Content-Type': 'application/vnd.contentful.management.v1+json'
            }
          }
        );
        results.push({ id: t.id, status: 'created' });
      } catch (e) {
        results.push({ id: t.id, status: 'error', message: e.message });
      }
    }
    return results;
  }

  return { cfg, saveCfg, hasReadAccess, hasWriteAccess, isConnected, get, mgmt, publishEntry, uploadAsset, createEntry, updateEntry, deleteEntry, createContentTypes };
})();
