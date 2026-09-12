const fetch = require('node-fetch');

// Rewrites one email's wording so it reads as individually written for this recipient,
// instead of an identical copy of the template — this is what genuinely makes bulk mail
// feel personal, on top of {{name}} substitution alone.
async function personalizeEmail({ apiKey, subject, html, contact }) {
  const prompt = `You are helping send ONE individual marketing email, not a bulk blast. Rewrite the wording and sentence structure below so it reads as a personally written message for this one recipient, while:
- Keeping the exact same offer, facts, numbers and meaning as the original (do not add new claims, discounts, rates, or promises).
- Keeping every <img ...> tag and every href="..." URL byte-for-byte exactly as in the original (do not remove, add, or change any image or link).
- Keeping it valid HTML.
- Naturally addressing them using the name given below, if one is given.
- Avoiding pushy sales language (no "act now", "click here", "guaranteed", "100% approved", etc.) — keep it calm and informative.

Recipient name: ${contact.name || '(no name given — use a friendly generic greeting like "Hi there")'}
Recipient email: ${contact.email}

Original subject: ${subject}

Original HTML body:
${html}

Return ONLY a JSON object of the form {"subject": "...", "html": "..."} with no other text.`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!resp.ok) {
    throw new Error(`Anthropic API error ${resp.status}: ${await resp.text()}`);
  }

  const data = await resp.json();
  const text = data.content?.map((c) => c.text).join('') || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI response could not be parsed');

  const parsed = JSON.parse(jsonMatch[0]);
  if (!parsed.subject || !parsed.html) throw new Error('AI response missing subject/html');
  return { subject: parsed.subject, html: parsed.html };
}

module.exports = { personalizeEmail };
