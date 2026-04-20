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

export async function onRequestPost(context) {
  try {
    const form = await context.request.formData();
    const name = String(form.get('name') || '').trim();
    const email = String(form.get('email') || '').trim();
    const message = String(form.get('message') || '').trim();

    if (!name || !email || !message) {
      return json({ ok: false, error: 'Please fill in all fields.' }, { status: 400 });
    }

    const emailBinding = context.env.CONTACT_EMAIL;
    const destination = context.env.CONTACT_DESTINATION;
    const sender = context.env.CONTACT_SENDER;

    if (!emailBinding || !destination || !sender) {
      return json({
        ok: false,
        error: 'Contact form backend not configured. Add CONTACT_EMAIL, CONTACT_DESTINATION and CONTACT_SENDER in Cloudflare Pages.'
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
