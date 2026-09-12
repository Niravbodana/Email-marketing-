// Rewrites every http(s) link inside a template's HTML to go through our own
// /api/track/click redirect first, so we can measure which template/email actually
// gets clicked through to the website (a proxy for "which template brings leads").
const LINK_REGEX = /href=["'](https?:\/\/[^"']+)["']/gi;

function addTrackingToLinks(html, { baseUrl, templateId, email }) {
  return (html || '').replace(LINK_REGEX, (match, url) => {
    const tracked = `${baseUrl}/api/track/click?tid=${encodeURIComponent(templateId)}&e=${encodeURIComponent(email)}&u=${encodeURIComponent(url)}`;
    return `href="${tracked}"`;
  });
}

module.exports = { addTrackingToLinks };
