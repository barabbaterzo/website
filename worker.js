import { EmailMessage } from 'cloudflare:email';

const CF_SPACE    = 'fejt7dmbrv9e';
const CF_DELIVERY = 'tOHgPb2AaW4raBzCEnxzs5QhFMnNdyOGJDF3sTKGAgc';

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

async function getLayout(env) {
  /* Try KV cache first */
  if (env.KV) {
    const cached = await env.KV.get('layout').catch(() => null);
    if (cached) return cached;
  }

  /* Fetch from Contentful */
  try {
    const r = await fetch(
      `https://cdn.contentful.com/spaces/${CF_SPACE}/environments/master/entries?content_type=siteContent&limit=1`,
      { headers: { Authorization: `Bearer ${CF_DELIVERY}` } }
    );
    if (!r.ok) return 'a';
    const data = await r.json();
    const layout = (data.items?.[0]?.fields?.heroStyle || 'a').toLowerCase();

    /* Cache in KV for 60 seconds */
    if (env.KV) {
      env.KV.put('layout', layout, { expirationTtl: 5 }).catch(() => {});
    }
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

    const safeName = String(name).replace(/[\r\n]+/g, ' ').trim();
    const safeEmail = String(email).replace(/[\r\n]+/g, ' ').trim();

    const html = `<h2>New message</h2>
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      <p><strong>Message:</strong></p>
      <p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>`;

    const raw = [
      `From: Tomaso Pignocchi Website <${sender}>`,
      `To: ${destination}`,
      `Reply-To: ${safeName} <${safeEmail}>`,
      `Subject: New message from tomasopignocchi.com`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      '',
      html.trim()
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

    /* For homepage: inject layout class server-side using HTMLRewriter */
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const [assetResponse, layout] = await Promise.all([
        env.ASSETS.fetch(request),
        getLayout(env)
      ]);

      if (!assetResponse.ok) return assetResponse;

      /* Use HTMLRewriter to inject class into <body> — streaming, no buffering */
      return new HTMLRewriter()
        .on('body', {
          element(el) {
            /* Replace ly-* class with the correct one */
            const existing = el.getAttribute('class') || '';
            const cleaned  = existing.replace(/\bly-\S+/g, '').trim();
            el.setAttribute('class', (cleaned + ' ly-' + layout).trim());
          }
        })
        .transform(new Response(assetResponse.body, {
          headers: {
            ...Object.fromEntries(assetResponse.headers),
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
          }
        }));
    }

    return env.ASSETS.fetch(request);
  }
};
