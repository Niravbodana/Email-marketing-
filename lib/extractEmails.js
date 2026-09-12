const fetch = require('node-fetch');

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

function regexExtract(rawText) {
  const found = rawText.match(EMAIL_REGEX) || [];
  return [...new Set(found.map((e) => e.toLowerCase()))].map((email) => ({ email, name: '' }));
}

async function aiExtract(rawText, apiKey) {
  const prompt = `Extract every valid email address from the text below. For each, also guess a display name if one is clearly associated with it in the text (e.g. from a "Name <email>" pattern or a nearby name/column), otherwise leave name empty.
Return ONLY a JSON array like [{"email":"a@b.com","name":"John"}], no other text.

TEXT:
${rawText.slice(0, 15000)}`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!resp.ok) {
    throw new Error(`Anthropic API error ${resp.status}: ${await resp.text()}`);
  }

  const data = await resp.json();
  const textOut = data.content?.map((c) => c.text).join('') || '[]';
  const jsonMatch = textOut.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return regexExtract(rawText);

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const seen = new Set();
    return parsed
      .filter((p) => p.email && EMAIL_REGEX.test(p.email))
      .filter((p) => {
        const key = p.email.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((p) => ({ email: p.email.toLowerCase(), name: p.name || '' }));
  } catch {
    return regexExtract(rawText);
  }
}

async function extractEmails(rawText, apiKey) {
  if (!apiKey) return regexExtract(rawText);
  try {
    return await aiExtract(rawText, apiKey);
  } catch (err) {
    console.error('AI extraction failed, falling back to regex:', err.message);
    return regexExtract(rawText);
  }
}

module.exports = { extractEmails, regexExtract };
