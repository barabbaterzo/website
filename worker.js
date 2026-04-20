import { EmailMessage } from 'cloudflare:email';

function json(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init.headers || {})
    }
  });
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function handleContact(request, env) {
  try {
    if (request.method !== 'POST') {
      return json({ ok: false, error: 'Method not allowed.' }, { status: 405 });
    }

    const contentType = request.headers.get('content-type') || '';
    let name = '';
    let email = '';
    let message = '';

    if (contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded')) {
      const form = await request.formData();
      name = String(form.get('name') || '').trim();
      email = String(form.get('email') || '').trim();
      message = String(form.get('message') || '').trim();
    } else if (contentType.includes('application/json')) {
      const body = await request.json().catch(() => ({}));
      name = String(body.name || '').trim();
      email = String(body.email || '').trim();
      message = String(body.message || '').trim();
    }

    if (!name || !email || !message) {
      return json({ ok: false, error: 'Please fill in all fields.' }, { status: 400 });
    }

    const emailBinding = env.CONTACT_EMAIL;
    const destination = env.CONTACT_DESTINATION;
    const sender = env.CONTACT_SENDER;

    if (!emailBinding || !destination || !sender) {
      return json({
        ok: false,
        error: 'Contact form backend not configured. Add CONTACT_EMAIL, CONTACT_DESTINATION and CONTACT_SENDER in Cloudflare.'
      }, { status: 503 });
    }

    const html = `
      <h2>New website message</h2>
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      <p><strong>Message:</strong></p>
      <p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>
    `;

    const raw = [
      `From: ${sender}`,
      `To: ${destination}`,
      `Reply-To: ${email}`,
      'Subject: Website contact form',
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      '',
      html.trim()
    ].join('\r\n');

    const outbound = new EmailMessage(sender, destination, raw);
    await emailBinding.send(outbound);
    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, error: error.message || 'Unexpected server error.' }, { status: 500 });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/contact') {
      return handleContact(request, env);
    }

    return env.ASSETS.fetch(request);
  }
};
