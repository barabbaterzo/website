/* ── Contentful client ───────────────────────────────────────────────── */

const CF = (() => {
  const DEFAULT_ENVIRONMENT = 'master';
  const DEFAULT_LOCALE = 'en-US';

  function getSiteConfig() {
    return window.SITE_CONFIG || {};
  }

  function cfg() {
    const site = getSiteConfig();
    const contentful = site.contentful || {};
    return {
      spaceId: contentful.spaceId || '',
      deliveryToken: contentful.deliveryToken || '',
      environment: contentful.environment || DEFAULT_ENVIRONMENT,
      locale: contentful.locale || DEFAULT_LOCALE,
      adminApiBase: site.adminApiBase || '/api/admin',
      accessLogoutUrl: site.accessLogoutUrl || '/cdn-cgi/access/logout',
      settingsKey: site.settingsKey || 'main',
    };
  }

  function saveCfg() {
    console.warn('CF.saveCfg() is disabled. Configure js/site-config.js and Cloudflare secrets instead.');
  }

  function isConnected() {
    const c = cfg();
    return !!(c.spaceId && c.deliveryToken);
  }

  function localeWrap(fields, locale) {
    return Object.fromEntries(
      Object.entries(fields)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, { [locale]: value }])
    );
  }

  async function get(contentType, params = {}) {
    const c = cfg();
    if (!c.spaceId || !c.deliveryToken) return null;

    const qs = new URLSearchParams({
      content_type: contentType,
      include: 2,
      limit: 200,
      ...params,
    });

    const response = await fetch(
      `https://cdn.contentful.com/spaces/${c.spaceId}/environments/${c.environment}/entries?${qs.toString()}`,
      { headers: { Authorization: `Bearer ${c.deliveryToken}` } }
    );

    if (!response.ok) return null;

    const data = await response.json();
    const assets = {};
    (data.includes?.Asset || []).forEach((asset) => {
      const file = asset.fields?.file;
      if (file?.url) assets[asset.sys.id] = `https:${file.url}`;
    });

    return (data.items || []).map((item) => {
      const fields = { ...item.fields, _id: item.sys.id, _sys: item.sys };
      for (const [key, value] of Object.entries(fields)) {
        if (value?.sys?.linkType === 'Asset') {
          fields[`${key}AssetId`] = value.sys.id;
          fields[key] = assets[value.sys.id] || null;
        }
      }
      return fields;
    });
  }

  async function adminRequest(path, options = {}) {
    const c = cfg();
    const response = await fetch(`${c.adminApiBase}${path}`, options);
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await response.json().catch(() => ({}))
      : await response.text().catch(() => '');

    if (!response.ok) {
      const message = typeof payload === 'string'
        ? payload
        : payload.message || payload.error || response.statusText;
      throw new Error(message || 'Admin API request failed');
    }

    return payload;
  }

  async function mgmt(method, path, body, extraHeaders = {}) {
    const headers = {
      'Content-Type': 'application/vnd.contentful.management.v1+json',
      ...extraHeaders,
    };

    const opts = {
      method,
      headers,
    };

    if (body !== undefined && body !== null) {
      opts.body = JSON.stringify(body);
    }

    return adminRequest(`/contentful${path}`, opts);
  }

  async function uploadAsset(file) {
    const formData = new FormData();
    formData.append('file', file, file.name);
    const result = await adminRequest('/contentful-upload', {
      method: 'POST',
      body: formData,
    });
    return result.assetId;
  }

  async function publishEntry(id, version) {
    return mgmt('PUT', `/entries/${id}/published`, undefined, {
      'X-Contentful-Version': String(version),
    });
  }

  async function createEntry(contentType, fields) {
    const c = cfg();
    const entry = await mgmt(
      'POST',
      '/entries',
      { fields: localeWrap(fields, c.locale) },
      { 'X-Contentful-Content-Type': contentType }
    );
    await publishEntry(entry.sys.id, entry.sys.version);
    return entry.sys.id;
  }

  async function updateEntry(id, fields) {
    const c = cfg();
    const existing = await mgmt('GET', `/entries/${id}`);
    const updated = await mgmt(
      'PUT',
      `/entries/${id}`,
      { fields: { ...(existing.fields || {}), ...localeWrap(fields, c.locale) } },
      { 'X-Contentful-Version': String(existing.sys.version) }
    );
    await publishEntry(id, updated.sys.version);
    return updated;
  }

  async function deleteEntry(id) {
    const existing = await mgmt('GET', `/entries/${id}`);
    if (existing.sys.publishedVersion) {
      await adminRequest(`/contentful/entries/${id}/published`, { method: 'DELETE' });
    }
    await adminRequest(`/contentful/entries/${id}`, { method: 'DELETE' });
  }

  async function createContentTypes() {
    return adminRequest('/setup/content-types', { method: 'POST' });
  }

  return {
    cfg,
    saveCfg,
    isConnected,
    get,
    mgmt,
    publishEntry,
    uploadAsset,
    createEntry,
    updateEntry,
    deleteEntry,
    createContentTypes,
    localeWrap,
  };
})();
