const STRICT_EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}$/;

const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'tempmail.com', 'guerrillamail.com', '10minutemail.com', 'yopmail.com', 'trashmail.com'
]);

function isValidFormat(email) {
  if (!email || email.length > 254) return false;
  if (email.includes('..')) return false;
  return STRICT_EMAIL_REGEX.test(email);
}

function isDisposable(email) {
  const domain = (email.split('@')[1] || '').toLowerCase();
  return DISPOSABLE_DOMAINS.has(domain);
}

// Classifies an SMTP send error as a permanent (hard) bounce vs a temporary failure.
function isHardBounce(err) {
  const code = err.responseCode || (err.response ? parseInt(err.response, 10) : null);
  if (code && code >= 500 && code < 600) return true;
  const msg = String(err.message || err.response || '').toLowerCase();
  return /no such user|user unknown|mailbox unavailable|does not exist|invalid recipient|invalid mailbox|address rejected/.test(msg);
}

module.exports = { isValidFormat, isDisposable, isHardBounce };
