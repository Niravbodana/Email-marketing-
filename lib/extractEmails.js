const fetch = require('node-fetch');

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const MODEL = 'claude-sonnet-5';

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
      model: MODEL,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!resp.ok) {
    throw new Error(`Anthropic API error ${resp.status}: ${await resp.text()}`);
  }

  const data = await resp.json();
  const usage = data.usage
    ? { model: MODEL, inputTokens: data.usage.input_tokens || 0, outputTokens: data.usage.output_tokens || 0 }
    : null;
  const textOut = data.content?.map((c) => c.text).join('') || '[]';
  const jsonMatch = textOut.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return { contacts: regexExtract(rawText), usage };

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const seen = new Set();
    const contacts = parsed
      .filter((p) => {
        EMAIL_REGEX.lastIndex = 0;
        return p.email && EMAIL_REGEX.test(p.email);
      })
      .filter((p) => {
        const key = p.email.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((p) => ({ email: p.email.toLowerCase(), name: p.name || '' }));
    return { contacts, usage };
  } catch {
    return { contacts: regexExtract(rawText), usage };
  }
}

// Returns { contacts, usage }. usage is null when no API key was used (regex-only path)
// or the AI call failed before a response came back, so callers can skip cost logging.
async function extractEmails(rawText, apiKey) {
  if (!apiKey) return { contacts: regexExtract(rawText), usage: null };
  try {
    return await aiExtract(rawText, apiKey);
  } catch (err) {
    console.error('AI extraction failed, falling back to regex:', err.message);
    return { contacts: regexExtract(rawText), usage: null };
  }
}

module.exports = { extractEmails, regexExtract };
