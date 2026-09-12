const nodemailer = require('nodemailer');

function buildTransport(smtp) {
  return nodemailer.createTransport({
    host: smtp.host,
    port: Number(smtp.port),
    secure: !!smtp.secure,
    auth: { user: smtp.user, pass: smtp.pass }
  });
}

function fillPlaceholders(text, contact) {
  return (text || '')
    .replace(/\{\{\s*name\s*\}\}/gi, contact.name || 'there')
    .replace(/\{\{\s*email\s*\}\}/gi, contact.email || '');
}

function stripHtml(html) {
  return (html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function sendOne({ smtp, template, contact, fromName, fromEmail, unsubscribeBaseUrl }) {
  const transport = buildTransport(smtp);
  const subject = fillPlaceholders(template.subject, contact);
  let html = fillPlaceholders(template.html, contact);

  const unsubscribeUrl = `${unsubscribeBaseUrl}?email=${encodeURIComponent(contact.email)}`;
  html += `<hr style="margin-top:24px;border:none;border-top:1px solid #eee"/>
  <p style="font-size:12px;color:#888">
    You are receiving this email from ${fromName || fromEmail}.
    <a href="${unsubscribeUrl}">Unsubscribe</a>
  </p>`;

  const text = stripHtml(html) + `\n\nUnsubscribe: ${unsubscribeUrl}`;

  return transport.sendMail({
    from: `"${fromName || ''}" <${fromEmail}>`,
    to: contact.email,
    subject,
    html,
    text,
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
    }
  });
}

module.exports = { sendOne, fillPlaceholders };
