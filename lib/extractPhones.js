// Matches phone numbers with an optional country code, e.g. +919876543210, 9876543210,
// +1 415 555 0100. Deliberately simple — always let the user double check the list.
const PHONE_REGEX = /(?:\+?\d{1,3}[-.\s]?)?\d{10}\b|\+\d{7,15}\b/g;

function extractPhones(rawText) {
  const found = (rawText || '').match(PHONE_REGEX) || [];
  const normalized = found.map((p) => p.replace(/[-.\s]/g, ''));
  return [...new Set(normalized)].map((phone) => ({ phone, name: '' }));
}

module.exports = { extractPhones };
