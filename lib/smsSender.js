const fetch = require('node-fetch');

// Uses Twilio's REST API directly (no SDK dependency needed) so an account SID +
// auth token + a Twilio "from" number is all that's required.
//
// Important, honest limitation: this does NOT check India's National DND (NDNC)
// registry — there is no free public API for that. In India, promotional SMS must go
// through a DLT (Distributed Ledger Technology)-registered template via a telecom
// operator/aggregator (e.g. Kaleyra, Gupshup, MSG91's DLT flow) — DND-registered
// numbers are then automatically blocked by the operator itself. Twilio is not
// DLT-registered for India, so promotional SMS sent to Indian numbers through Twilio
// can be blocked or non-compliant. Use a DLT-registered provider for real Indian SMS
// marketing; this integration is best suited for transactional/OTP-style use or
// non-Indian numbers unless you swap in a DLT-compliant provider's API here.

async function sendSms({ provider, to, body }) {
  const kind = String(provider.provider || provider.type || 'twilio').toLowerCase();
  if (kind !== 'twilio') {
    throw new Error(`Unsupported SMS provider: ${kind}`);
  }
  if (!provider.accountSid || !provider.authToken || !provider.fromNumber) {
    throw new Error('Twilio accountSid, authToken and fromNumber must all be set.');
  }

  const auth = Buffer.from(`${provider.accountSid}:${provider.authToken}`).toString('base64');
  const params = new URLSearchParams({ To: to, From: provider.fromNumber, Body: body });

  const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${provider.accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: params
  });

  const data = await resp.json();
  if (!resp.ok) {
    const err = new Error(data.message || `Twilio error ${resp.status}`);
    err.code = data.code;
    throw err;
  }
  return data;
}

async function testSmsProvider(provider) {
  if (!provider.accountSid || !provider.authToken) {
    return { ok: false, message: 'Account SID aur Auth Token bharo pehle.' };
  }
  try {
    const auth = Buffer.from(`${provider.accountSid}:${provider.authToken}`).toString('base64');
    const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${provider.accountSid}.json`, {
      headers: { Authorization: `Basic ${auth}` }
    });
    if (resp.ok) return { ok: true, message: 'Twilio account connected.' };
    if (resp.status === 401) return { ok: false, message: 'Invalid Account SID / Auth Token.' };
    return { ok: false, message: `Twilio error (status ${resp.status}).` };
  } catch (err) {
    return { ok: false, message: `Connect nahi ho paya: ${err.message}` };
  }
}

module.exports = { sendSms, testSmsProvider };
