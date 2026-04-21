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

  function isConnected() {
    const c = cfg();
    return !!(c.spaceId && c.deliveryToken);
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
          { id: 'key',               name: 'Key',                type: 'Symbol', required: true },
          { id: 'nameplateSubtitle', name: 'Nameplate subtitle', type: 'Symbol' },
          { id: 'bioText',           name: 'Bio text',           type: 'Text' },
          { id: 'photoIntro',        name: 'Photography intro',  type: 'Text' },
          { id: 'contactInfo',       name: 'Contact info',       type: 'Text' },
          { id: 'heroPosX',          name: 'Hero position X',    type: 'Integer' },
          { id: 'heroPosY',          name: 'Hero position Y',    type: 'Integer' },
          { id: 'bgColor',           name: 'Background color',   type: 'Symbol' },
          { id: 'textColor',         name: 'Text color',         type: 'Symbol' },
          { id: 'logoVariant',       name: 'Logo variant',       type: 'Symbol' },
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
          { id: 'key',        name: 'Key',         type: 'Symbol',  required: true },
          { id: 'heroBanner', name: 'Hero Banner',  type: 'Link', linkType: 'Asset' }
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
          /* exists but maybe not published — publish it */
          if (!existing.sys.publishedVersion) {
            const c = cfg();
            await fetch(
              `https://api.contentful.com/spaces/${c.spaceId}/environments/master/content_types/${t.id}/published`,
              {
                method: 'PUT',
                headers: {
                  Authorization: `Bearer ${c.mgmtToken}`,
                  'X-Contentful-Version': existing.sys.version,
                  'Content-Type': 'application/vnd.contentful.management.v1+json'
                }
              }
            );
            results.push({ id: t.id, status: 'published' });
          } else {
            results.push({ id: t.id, status: 'already exists' });
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

  return { cfg, saveCfg, isConnected, get, mgmt, publishEntry, uploadAsset, createEntry, updateEntry, deleteEntry, createContentTypes };
})();
