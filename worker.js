import { EmailMessage } from 'cloudflare:email';

const CF_SPACE    = 'fejt7dmbrv9e';
const CF_DELIVERY = 'tOHgPb2AaW4raBzCEnxzs5QhFMnNdyOGJDF3sTKGAgc';
const CACHE_TTL   = 60; // seconds to cache the layout setting

function json(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(init.headers || {}) }
  });
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ── Fetch layout from Contentful (with cache) ── */
async function getLayout(ctx) {
  const cacheKey = 'cf-layout-v1';
  const cached = await ctx.env?.KV?.get(cacheKey).catch(() => null);
  if (cached) return cached;

  try {
    const r = await fetch(
      `https://cdn.contentful.com/spaces/${CF_SPACE}/environments/master/entries?content_type=siteContent&limit=1`,
      { headers: { Authorization: `Bearer ${CF_DELIVERY}` }, cf: { cacheTtl: CACHE_TTL } }
    );
    if (!r.ok) return 'a';
    const data = await r.json();
    const style = data.items?.[0]?.fields?.heroStyle || 'a';
    const layout = style.toLowerCase();
    ctx.env?.KV?.put(cacheKey, layout, { expirationTtl: CACHE_TTL }).catch(() => {});
    return layout;
  } catch {
    return 'a';
  }
}

async function handleContact(request, env) {
  try {
    if (request.method !== 'POST')
      return json({ ok: false, error: 'Method not allowed.' }, { status: 405 });

    const contentType = request.headers.get('content-type') || '';
    let name = '', email = '', message = '';

    if (contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded')) {
      const form = await request.formData();
      name    = String(form.get('name')    || '').trim();
      email   = String(form.get('email')   || '').trim();
      message = String(form.get('message') || '').trim();
    } else if (contentType.includes('application/json')) {
      const body = await request.json().catch(() => ({}));
      name    = String(body.name    || '').trim();
      email   = String(body.email   || '').trim();
      message = String(body.message || '').trim();
    }

    if (!name || !email || !message)
      return json({ ok: false, error: 'Please fill in all fields.' }, { status: 400 });

    const emailBinding = env.CONTACT_EMAIL;
    const destination  = env.CONTACT_DESTINATION;
    const sender       = env.CONTACT_SENDER;

    if (!emailBinding || !destination || !sender)
      return json({ ok: false, error: 'Contact form not configured.' }, { status: 503 });

    const html = `<h2>New message</h2>
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      <p><strong>Message:</strong></p>
      <p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>`;

    const raw = [
      `From: ${sender}`, `To: ${destination}`, `Reply-To: ${email}`,
      'Subject: Website contact form', 'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8', '', html.trim()
    ].join('\r\n');

    await emailBinding.send(new EmailMessage(sender, destination, raw));
    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, error: error.message || 'Unexpected error.' }, { status: 500 });
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    /* Contact form API */
    if (url.pathname === '/api/contact')
      return handleContact(request, env);

    /* For the homepage only: inject layout class server-side */
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const assetResponse = await env.ASSETS.fetch(request);
      if (!assetResponse.ok) return assetResponse;

      /* Get layout from Contentful (fast, cached) */
      const layout = await getLayout({ env, ctx });

      /* Inject class into <body> tag */
      const html = await assetResponse.text();
      const patched = html.replace(
        /<body([^>]*)class="([^"]*)">/,
        (match, attrs, classes) => {
          const cleaned = classes.replace(/\bly-\S+/g, '').trim();
          return `<body${attrs}class="${cleaned} ly-${layout}">`;
        }
      );

      return new Response(patched, {
        headers: {
          ...Object.fromEntries(assetResponse.headers),
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store', /* always fresh */
        }
      });
    }

    return env.ASSETS.fetch(request);
  }
};
