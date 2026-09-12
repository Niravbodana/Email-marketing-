const fetch = require('node-fetch');

// Only Anthropic keys can actually be verified here (the /v1/models endpoint is a free,
// no-token-cost way to confirm a key works). Any other provider name is stored but shown
// as "not verifiable yet" rather than pretending to test it.
async function testAnthropicKey(key) {
  if (!key) return { ok: false, message: 'Key khaali hai.' };
  try {
    const resp = await fetch('https://api.anthropic.com/v1/models', {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
    });
    if (resp.ok) return { ok: true, message: 'Anthropic key valid hai.' };
    if (resp.status === 401) return { ok: false, message: 'Key invalid hai (401 unauthorized).' };
    return { ok: false, message: `Anthropic ne error diya (status ${resp.status}).` };
  } catch (err) {
    return { ok: false, message: `Connect nahi ho paya: ${err.message}` };
  }
}

async function testApiKey(name, key) {
  if ((name || '').trim().toLowerCase() === 'anthropic') return testAnthropicKey(key);
  return { ok: null, message: 'Is provider ko abhi verify nahi kar sakte, lekin key save ho jayegi.' };
}

module.exports = { testApiKey, testAnthropicKey };
