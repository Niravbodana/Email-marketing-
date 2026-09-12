const XLSX = require('xlsx');
const { regexExtract } = require('./extractEmails');

const EMAIL_IN_CELL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

function looksLikeEmailHeader(value) {
  const v = String(value || '').trim().toLowerCase();
  return /^(e[\s-]?mail(s)?(\s+(address|id|ids))?|mail id|gmail|work email|office email|primary email|contact email|user email|business email)$/i.test(v);
}

function looksLikeNameHeader(value) {
  return /^(name|naam|full name|contact name|person|customer|client|first name|firstname|given name)$/i.test(String(value || '').trim());
}

function looksLikeLastNameHeader(value) {
  return /^(last name|lastname|surname|family name)$/i.test(String(value || '').trim());
}

function addUnique(results, seen, email, name, source) {
  const key = String(email || '').toLowerCase().trim();
  if (!key || !key.includes('@') || seen.has(key)) return;
  seen.add(key);
  results.push({
    email: key,
    name: String(name || '').replace(/\s+/g, ' ').trim().slice(0, 80),
    source
  });
}

function guessNameFromRow(cells, email) {
  const others = cells
    .map((c) => String(c || '').trim())
    .filter((c) => c && !c.toLowerCase().includes(String(email || '').toLowerCase()) && !c.includes('@') && /[a-zA-Z]{2,}/.test(c));
  return others[0] || '';
}

function detectFromRows(rows, sheetName) {
  const results = [];
  const seen = new Set();
  if (!rows.length) return results;

  const header = rows[0].map((c) => String(c || '').trim());
  const emailCol = header.findIndex(looksLikeEmailHeader);
  const nameCol = header.findIndex(looksLikeNameHeader);
  const lastCol = header.findIndex(looksLikeLastNameHeader);
  const start = emailCol >= 0 ? 1 : 0;

  if (emailCol >= 0) {
    for (let i = start; i < rows.length; i += 1) {
      const row = rows[i] || [];
      const cell = String(row[emailCol] || '');
      EMAIL_IN_CELL.lastIndex = 0;
      const found = cell.match(EMAIL_IN_CELL) || [];
      let name = '';
      if (nameCol >= 0 || lastCol >= 0) {
        name = [nameCol >= 0 ? row[nameCol] : '', lastCol >= 0 ? row[lastCol] : '']
          .map((part) => String(part || '').trim())
          .filter(Boolean)
          .join(' ');
      } else {
        name = guessNameFromRow(row, found[0] || '');
      }
      found.forEach((email) => addUnique(results, seen, email, name, `${sheetName} row ${i + 1}`));
    }
  }

  rows.forEach((row, i) => {
    const cells = (row || []).map((c) => String(c ?? ''));
    const text = cells.join(' ');
    regexExtract(text).forEach(({ email }) => {
      addUnique(results, seen, email, guessNameFromRow(cells, email), `${sheetName} row ${i + 1}`);
    });
  });

  return results;
}

function sheetToRows(sheet) {
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '', blankrows: false });
}

function looksLikeExcel(filename, buffer) {
  if (/\.(xlsx|xlsm|xls)$/i.test(filename || '')) return true;
  if (!buffer || buffer.length < 4) return false;
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) return true;
  if (buffer[0] === 0xd0 && buffer[1] === 0xcf) return true;
  return false;
}

function parseContactFile({ filename, buffer, text } = {}) {
  const name = String(filename || 'upload');
  const cleanedText = String(text || '').replace(/^\uFEFF/, '');
  const isExcel = looksLikeExcel(name, buffer);

  try {
    let workbook;
    if (isExcel) {
      if (!buffer || !buffer.length) throw new Error('Excel file is empty');
      workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
    } else {
      workbook = XLSX.read(cleanedText, { type: 'string' });
    }

    const detected = [];
    const seen = new Set();
    let rowCount = 0;

    (workbook.SheetNames || []).forEach((sheetName) => {
      const rows = sheetToRows(workbook.Sheets[sheetName]);
      rowCount += rows.length;
      detectFromRows(rows, sheetName).forEach((item) => {
        if (seen.has(item.email)) return;
        seen.add(item.email);
        detected.push(item);
      });
    });

    if (!detected.length && cleanedText) {
      regexExtract(cleanedText).forEach(({ email }) => addUnique(detected, seen, email, '', name));
    }

    return {
      detected,
      sheetNames: workbook.SheetNames || [],
      rowCount,
      filename: filename || 'file'
    };
  } catch (err) {
    if (!isExcel && cleanedText) {
      const detected = [];
      const seen = new Set();
      regexExtract(cleanedText).forEach(({ email }) => addUnique(detected, seen, email, '', filename || 'file'));
      return { detected, sheetNames: [], rowCount: cleanedText.split(/\r?\n/).length, filename: filename || 'file' };
    }
    throw new Error(`Could not read ${filename || 'that file'}: ${err.message}`);
  }
}

module.exports = { parseContactFile, detectFromRows };
