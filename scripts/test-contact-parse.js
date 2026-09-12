const { writeFileSync, unlinkSync } = require('node:fs');
const XLSX = require('xlsx');
const { parseContactFile } = require('../lib/parseContactFile');

const csv = Buffer.from('Name,Email\nAisha,aisha@brand.com\nRohan,rohan@studio.in\n');
const csvOut = parseContactFile({ filename: 'list.csv', buffer: csv, text: csv.toString('utf8') });
if (csvOut.detected.length !== 2) throw new Error('csv fail ' + JSON.stringify(csvOut));
if (csvOut.detected[0].name !== 'Aisha') throw new Error('csv name fail');

const bomCsv = Buffer.from('\uFEFFFull Name,Work Email\nKabir Rao,kabir@atelier.co\n');
const bomText = bomCsv.toString('utf8');
const bomOut = parseContactFile({ filename: 'bom.csv', buffer: bomCsv, text: bomText });
if (bomOut.detected.length !== 1 || bomOut.detected[0].name !== 'Kabir Rao') {
  throw new Error('bom/work-email fail ' + JSON.stringify(bomOut));
}

const txt = Buffer.from('hello please mail us at hello@neercred.com and cc ops@neercred.in\n');
const txtOut = parseContactFile({ filename: 'notes.txt', buffer: txt, text: txt.toString('utf8') });
if (txtOut.detected.length !== 2) throw new Error('txt fail ' + JSON.stringify(txtOut));

const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet([
  ['First Name', 'Last Name', 'Work Email', 'Phone'],
  ['Meera', 'Shah', 'meera@atelier.co', '999'],
  ['Kabir', 'Rao', 'kabir@atelier.co', '888'],
  ['Skip', 'Row', 'not-an-email', ''],
]);
XLSX.utils.book_append_sheet(wb, ws, 'Leads');
const xlsxBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
writeFileSync('/tmp/leads.xlsx', xlsxBuf);
const xlsxOut = parseContactFile({ filename: 'leads.xlsx', buffer: xlsxBuf, text: '' });
unlinkSync('/tmp/leads.xlsx');
if (xlsxOut.detected.length !== 2) throw new Error('xlsx fail ' + JSON.stringify(xlsxOut));
if (xlsxOut.detected[0].name !== 'Meera Shah') throw new Error('first+last name fail ' + JSON.stringify(xlsxOut.detected[0]));
if (!xlsxOut.sheetNames.includes('Leads')) throw new Error('sheet names');

console.log('parseContactFile ok', {
  csv: csvOut.detected.length,
  bom: bomOut.detected.length,
  txt: txtOut.detected.length,
  xlsx: xlsxOut.detected.length
});
