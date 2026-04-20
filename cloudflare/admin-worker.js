const CONTENT_TYPES = [
  {
    id: 'photo',
    name: 'Photo',
    displayField: 'title',
    fields: [
      { id: 'title', name: 'Title', type: 'Symbol', required: true },
      { id: 'image', name: 'Image', type: 'Link', linkType: 'Asset', required: true },
      { id: 'series', name: 'Series', type: 'Symbol' },
      { id: 'year', name: 'Year', type: 'Integer' },
      { id: 'location', name: 'Location', type: 'Symbol' },
      { id: 'caption', name: 'Caption', type: 'Text' },
      { id: 'featured', name: 'Featured', type: 'Boolean' },
    ],
  },
  {
    id: 'siteContent',
    name: 'Site Content',
    displayField: 'key',
    fields: [
      { id: 'key', name: 'Key', type: 'Symbol', required: true },
      { id: 'nameplateSubtitle', name: 'Nameplate subtitle', type: 'Symbol' },
      { id: 'bioText', name: 'Bio text', type: 'Text' },
      { id: 'photoIntro', name: 'Photography intro', type: 'Text' },
      { id: 'contactInfo', name: 'Contact info', type: 'Text' },
      { id: 'heroPosX', name: 'Hero position X', type: 'Integer' },
      { id: 'heroPosY', name: 'Hero position Y', type: 'Integer' },
      { id: 'heroStyle', name: 'Hero style', type: 'Symbol' },
      { id: 'fontSecondary', name: 'Secondary font', type: 'Symbol' },
      { id: 'fontPrimaryWeight', name: 'Primary font weight', type: 'Integer' },
      { id: 'fontSecondaryWeight', name: 'Secondary font weight', type: 'Integer' },
      { id: 'fontPrimaryItalic', name: 'Primary font italic', type: 'Boolean' },
      { id: 'fontSecondaryItalic', name: 'Secondary font italic', type: 'Boolean' },
      { id: 'sizeBannerTitle', name: 'Banner title size', type: 'Integer' },
      { id: 'sizeBannerSubtitle', name: 'Banner subtitle size', type: 'Integer' },
      { id: 'sizeTalks', name: 'Talk size', type: 'Integer' },
      { id: 'sizePhotoIntro', name: 'Photo intro size', type: 'Integer' },
      { id: 'sizeLabels', name: 'Labels size', type: 'Integer' },
      { id: 'sizeFooter', name: 'Footer size', type: 'Integer' },
      { id: 'bioLineHeight', name: 'Bio line height', type: 'Integer' },
      { id: 'logoVariant', name: 'Logo variant', type: 'Symbol' },
    ],
  },
  {
    id: 'siteSettings',
    name: 'Site Settings',
    displayField: 'key',
    fields: [
      { id: 'key', name: 'Key', type: 'Symbol', required: true },
      { id: 'heroBanner', name: 'Hero banner', type: 'Link', linkType: 'Asset' },
      { id: 'backgroundColor', name: 'Background color', type: 'Symbol' },
      { id: 'textColor', name: 'Text color', type: 'Symbol' },
      { id: 'fontPrimary', name: 'Primary font', type: 'Symbol' },
      { id: 'fontSizeBio', name: 'Bio font size', type: 'Integer' },
      { id: 'fontSizePubs', name: 'Publications font size', type: 'Integer' },
    ],
  },
  {
    id: 'publication',
    name: 'Publication',
    displayField: 'title',
    fields: [
      { id: 'title', name: 'Title', type: 'Symbol', required: true },
      { id: 'venue', name: 'Venue', type: 'Symbol' },
      { id: 'year', name: 'Year', type: 'Integer' },
      { id: 'link', name: 'Link', type: 'Symbol' },
      { id: 'pubType', name: 'Type', type: 'Symbol' },
      { id: 'forthcoming', name: 'Forthcoming', type: 'Boolean' },
      { id: 'order', name: 'Order', type: 'Integer' },
    ],
  },
  {
    id: 'talk',
    name: 'Talk',
    displayField: 'title',
    fields: [
      { id: 'title', name: 'Title', type: 'Symbol', required: true },
      { id: 'venue', name: 'Venue', type: 'Symbol' },
      { id: 'year', name: 'Year', type: 'Integer' },
      { id: 'upcoming', name: 'Upcoming', type: 'Boolean' },
      { id: 'talkType', name: 'Type', type: 'Symbol' },
      { id: 'order', name: 'Order', type: 'Integer' },
    ],
  },
  {
    id: 'series',
    name: 'Series',
    displayField: 'name',
    fields: [
      { id: 'name', name: 'Name', type: 'Symbol', required: true },
      { id: 'slug', name: 'Slug', type: 'Symbol', required: true },
      { id: 'description', name: 'Description', type: 'Text' },
      { id: 'coverImage', name: 'Cover Image', type: 'Link', linkType: 'Asset' },
      { id: 'order', name: 'Order', type: 'Integer' },
    ],
  },
];

let jwksCache = null;
let jwksCacheAt = 0;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith('/api/admin/')) {
      return new Response('Not found', { status: 404 });
    }

    try {
      await verifyAccess(request, env);

      if (url.pathname === '/api/admin/setup/content-types' && request.method === 'POST') {
        return json(await ensureContentTypes(env));
      }

      if (url.pathname === '/api/admin/contentful-upload' && request.method === 'POST') {
        return json(await uploadAsset(request, env));
      }

      if (url.pathname.startsWith('/api/admin/contentful/')) {
        return proxyManagementRequest(request, env, url.pathname.replace('/api/admin/contentful', ''), url.search);
      }

      return new Response('Not found', { status: 404 });
    } catch (error) {
      return json({ error: error.message || 'Unexpected error' }, error.status || 500);
    }
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function managementBase(env) {
  return `https://api.contentful.com/spaces/${env.CONTENTFUL_SPACE_ID}/environments/${env.CONTENTFUL_ENVIRONMENT || 'master'}`;
}

async function cmaFetch(env, path, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${env.CONTENTFUL_MANAGEMENT_TOKEN}`);
  headers.set('Content-Type', headers.get('Content-Type') || 'application/vnd.contentful.management.v1+json');

  const response = await fetch(`${managementBase(env)}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(payload.message || response.statusText || 'Contentful request failed');
    error.status = response.status;
    throw error;
  }

  if (response.status === 204) return null;
  return response.json();
}

async function proxyManagementRequest(request, env, pathSuffix, search) {
  const target = `${managementBase(env)}${pathSuffix}${search}`;
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${env.CONTENTFUL_MANAGEMENT_TOKEN}`);

  const passthrough = ['Content-Type', 'X-Contentful-Version', 'X-Contentful-Content-Type'];
  passthrough.forEach((name) => {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  });

  const response = await fetch(target, {
    method: request.method,
    headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
  });

  return new Response(response.body, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('Content-Type') || 'application/json; charset=utf-8',
    },
  });
}

async function uploadAsset(request, env) {
  const formData = await request.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) {
    throw Object.assign(new Error('Missing file'), { status: 400 });
  }

  const uploadResponse = await fetch(`https://upload.contentful.com/spaces/${env.CONTENTFUL_SPACE_ID}/uploads`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.CONTENTFUL_MANAGEMENT_TOKEN}`,
      'Content-Type': 'application/octet-stream',
    },
    body: await file.arrayBuffer(),
  });

  if (!uploadResponse.ok) {
    const payload = await uploadResponse.json().catch(() => ({}));
    throw Object.assign(new Error(payload.message || 'Upload failed'), { status: uploadResponse.status });
  }

  const upload = await uploadResponse.json();
  const locale = env.CONTENTFUL_LOCALE || 'en-US';

  const asset = await cmaFetch(env, '/assets', {
    method: 'POST',
    body: JSON.stringify({
      fields: {
        title: { [locale]: file.name.replace(/\.[^.]+$/, '') },
        file: {
          [locale]: {
            contentType: file.type || 'application/octet-stream',
            fileName: file.name,
            uploadFrom: { sys: { type: 'Link', linkType: 'Upload', id: upload.sys.id } },
          },
        },
      },
    }),
  });

  await cmaFetch(env, `/assets/${asset.sys.id}/files/${locale}/process`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/vnd.contentful.management.v1+json' },
  });

  let processed = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await sleep(1200);
    processed = await cmaFetch(env, `/assets/${asset.sys.id}`, { method: 'GET' });
    const url = processed?.fields?.file?.[locale]?.url;
    if (url) break;
  }

  if (!processed?.fields?.file?.[locale]?.url) {
    throw Object.assign(new Error('Asset processing timed out'), { status: 504 });
  }

  await cmaFetch(env, `/assets/${asset.sys.id}/published`, {
    method: 'PUT',
    headers: {
      'X-Contentful-Version': String(processed.sys.version),
      'Content-Type': 'application/vnd.contentful.management.v1+json',
    },
  });

  return { assetId: asset.sys.id, url: `https:${processed.fields.file[locale].url}` };
}

async function ensureContentTypes(env) {
  const results = [];

  for (const type of CONTENT_TYPES) {
    try {
      let existing = null;
      try {
        existing = await cmaFetch(env, `/content_types/${type.id}`, { method: 'GET' });
      } catch (error) {
        if (error.status !== 404) throw error;
      }

      if (!existing) {
        const created = await cmaFetch(env, `/content_types/${type.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: type.name,
            displayField: type.displayField,
            fields: type.fields,
          }),
        });

        await cmaFetch(env, `/content_types/${type.id}/published`, {
          method: 'PUT',
          headers: {
            'X-Contentful-Version': String(created.sys.version),
            'Content-Type': 'application/vnd.contentful.management.v1+json',
          },
        });
        results.push({ id: type.id, status: 'created' });
        continue;
      }

      const existingIds = new Set(existing.fields.map((field) => field.id));
      const missingFields = type.fields.filter((field) => !existingIds.has(field.id));

      if (missingFields.length) {
        const updated = await cmaFetch(env, `/content_types/${type.id}`, {
          method: 'PUT',
          headers: {
            'X-Contentful-Version': String(existing.sys.version),
            'Content-Type': 'application/vnd.contentful.management.v1+json',
          },
          body: JSON.stringify({
            name: existing.name || type.name,
            displayField: existing.displayField || type.displayField,
            fields: [...existing.fields, ...missingFields],
          }),
        });

        await cmaFetch(env, `/content_types/${type.id}/published`, {
          method: 'PUT',
          headers: {
            'X-Contentful-Version': String(updated.sys.version),
            'Content-Type': 'application/vnd.contentful.management.v1+json',
          },
        });
        results.push({ id: type.id, status: `updated (+${missingFields.length} fields)` });
        continue;
      }

      if (!existing.sys.publishedVersion) {
        await cmaFetch(env, `/content_types/${type.id}/published`, {
          method: 'PUT',
          headers: {
            'X-Contentful-Version': String(existing.sys.version),
            'Content-Type': 'application/vnd.contentful.management.v1+json',
          },
        });
        results.push({ id: type.id, status: 'published' });
      } else {
        results.push({ id: type.id, status: 'already exists' });
      }
    } catch (error) {
      results.push({ id: type.id, status: 'error', message: error.message });
    }
  }

  return results;
}

async function verifyAccess(request, env) {
  if (env.SKIP_ACCESS_VALIDATION === 'true') return;

  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) {
    throw Object.assign(new Error('Missing Cloudflare Access token'), { status: 401 });
  }

  const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw Object.assign(new Error('Malformed Access token'), { status: 401 });
  }

  const header = JSON.parse(decodeBase64Url(encodedHeader));
  const payload = JSON.parse(decodeBase64Url(encodedPayload));
  const jwks = await getJwks(env);
  const jwk = (jwks.keys || []).find((key) => key.kid === header.kid);
  if (!jwk) {
    throw Object.assign(new Error('Unable to find matching Access signing key'), { status: 401 });
  }

  const algorithm = header.alg === 'RS512' ? 'SHA-512' : 'SHA-256';
  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: algorithm },
    false,
    ['verify']
  );

  const verified = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    cryptoKey,
    base64UrlToUint8Array(encodedSignature),
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
  );

  if (!verified) {
    throw Object.assign(new Error('Invalid Access token signature'), { status: 401 });
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    throw Object.assign(new Error('Cloudflare Access token expired'), { status: 401 });
  }

  const aud = payload.aud;
  const allowed = Array.isArray(aud) ? aud.includes(env.ACCESS_AUD) : aud === env.ACCESS_AUD;
  if (!allowed) {
    throw Object.assign(new Error('Cloudflare Access audience mismatch'), { status: 403 });
  }
}

async function getJwks(env) {
  const now = Date.now();
  if (jwksCache && now - jwksCacheAt < 5 * 60 * 1000) return jwksCache;

  const response = await fetch(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
  if (!response.ok) {
    throw Object.assign(new Error('Unable to fetch Cloudflare Access certificates'), { status: 500 });
  }

  jwksCache = await response.json();
  jwksCacheAt = now;
  return jwksCache;
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + (4 - normalized.length % 4) % 4, '=');
  const binary = atob(padded);
  return binary;
}

function base64UrlToUint8Array(value) {
  const binary = decodeBase64Url(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
