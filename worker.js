import { EmailMessage } from 'cloudflare:email';

const CF_SPACE    = 'fejt7dmbrv9e';
const CF_DELIVERY = 'tOHgPb2AaW4raBzCEnxzs5QhFMnNdyOGJDF3sTKGAgc';

/* ── In-memory rate limiter (per Worker instance, resets on cold start) ──
   Cloudflare Workers have many instances, so this is a soft limit.
   KV-based limiting below is the stronger version. */
const inMemoryRates = new Map();
function inMemoryAllow(ip) {
  const now   = Date.now();
  const entry = inMemoryRates.get(ip) || { count: 0, resetAt: now + 3600_000 };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 3600_000; }
  entry.count++;
  inMemoryRates.set(ip, entry);
  /* Clean up old entries occasionally */
  if (inMemoryRates.size > 2000) {
    for (const [k, v] of inMemoryRates) {
      if (Date.now() > v.resetAt) inMemoryRates.delete(k);
    }
  }
  return entry.count <= 5; /* 5 per hour per instance */
}

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
      `https://cdn.contentful.com/spaces/${CF_SPACE}/environments/master/entries?content_type=siteContent&fields.key=main&limit=1`,
      { headers: { Authorization: `Bearer ${CF_DELIVERY}` } }
    );
    if (!r.ok) return 'a';
    const data = await r.json();
    const layout = (data.items?.[0]?.fields?.heroStyle || 'a').toLowerCase();

    /* Cache in KV for 5 minutes (KV's minimum is 60s; 5 min keeps
       daily writes well inside the free-plan limit). A layout change
       made in the admin shows up for visitors within 5 minutes. */
    if (env.KV) {
      env.KV.put('layout', layout, { expirationTtl: 300 }).catch(() => {});
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
    let name = '', email = '', message = '', honeypot = '', elapsed = '';

    if (contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded')) {
      const form = await request.formData();
      name      = String(form.get('name')    || '').trim();
      email     = String(form.get('email')   || '').trim();
      message   = String(form.get('message') || '').trim();
      honeypot  = String(form.get('hp')      || '').trim(); /* hidden honeypot */
      elapsed   = String(form.get('el')      || '').trim(); /* ms spent on page, set by JS */
    } else if (contentType.includes('application/json')) {
      const body = await request.json().catch(() => ({}));
      name      = String(body.name    || '').trim();
      email     = String(body.email   || '').trim();
      message   = String(body.message || '').trim();
      honeypot  = String(body.hp      || '').trim();
      elapsed   = String(body.el      || '').trim();
    }

    /* ── HONEYPOT CHECK ──
       If the hidden field is filled, it's almost certainly a bot.
       Return ok:true to not alert the bot, but skip sending the email. */
    if (honeypot) {
      return json({ ok: true });
    }

    /* ── TIMING CHECK ──
       The page's JS sends how many ms the visitor spent before submitting.
       Missing = bot posting straight to /api/contact without running the page.
       Under 3 seconds = no human types name, email and message that fast. */
    const elapsedMs = parseInt(elapsed, 10);
    if (!Number.isFinite(elapsedMs) || elapsedMs < 3000) {
      return json({ ok: true });
    }

    /* ── BASIC VALIDATION ── */
    if (!name || !email || !message)
      return json({ ok: false, error: 'Please fill in all fields.' }, { status: 400 });

    /* ── RATE LIMITING ──
       Max 3 submissions per IP per hour via KV (persistent across instances),
       with a soft in-memory fallback. */
    const ip = request.headers.get('cf-connecting-ip')
             || request.headers.get('x-forwarded-for')
             || 'unknown';

    if (env.KV) {
      const kvKey = `rate:${ip}`;
      const raw   = await env.KV.get(kvKey).catch(() => null);
      const count = raw ? parseInt(raw, 10) : 0;
      if (count >= 3) {
        /* Silent fake-success so bots don't retry aggressively */
        return json({ ok: true });
      }
      /* Increment counter; expires after 1 hour */
      env.KV.put(kvKey, String(count + 1), { expirationTtl: 3600 }).catch(() => {});
    } else {
      /* Fallback: in-memory limiter (weaker but better than nothing) */
      if (!inMemoryAllow(ip)) {
        return json({ ok: true });
      }
    }

    /* Reject obviously spammy content: messages full of URLs */
    const urlCount = (message.match(/https?:\/\//gi) || []).length;
    if (urlCount > 2) {
      return json({ ok: true }); /* silent drop */
    }

    const emailBinding = env.CONTACT_EMAIL;
    const destination  = env.CONTACT_DESTINATION;
    const sender       = env.CONTACT_SENDER;

    if (!emailBinding || !destination || !sender)
      return json({ ok: false, error: 'Contact form not configured.' }, { status: 503 });

    const safeName  = String(name).replace(/[\r\n]+/g, ' ').trim();
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
