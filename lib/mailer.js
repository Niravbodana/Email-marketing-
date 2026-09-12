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

async function sendOne({ smtp, subject: rawSubject, html: rawHtml, contact, fromName, fromEmail, unsubscribeBaseUrl }) {
  const transport = buildTransport(smtp);
  const subject = rawSubject;
  let html = rawHtml;

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

async function testSmtpConnection(smtp) {
  if (!smtp.host || !smtp.user || !smtp.pass) {
    return { ok: false, message: 'Host, user aur password teeno bharo pehle.' };
  }
  try {
    const transport = buildTransport(smtp);
    await transport.verify();
    return { ok: true, message: `Connected as ${smtp.user}` };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

module.exports = { sendOne, fillPlaceholders, testSmtpConnection };
