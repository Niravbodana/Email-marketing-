const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const adapter = new FileSync(path.join(dataDir, 'db.json'));
const db = low(adapter);

db.defaults({
  settings: {
    smtp: { host: '', port: 587, secure: false, user: '', pass: '', fromName: '', fromEmail: '' },
    anthropicApiKey: '',
    aiPersonalizeEmails: false,
    delayMinSec: 8,
    delayMaxSec: 20,
    dailyLimit: 300
  },
  templates: [],
  contacts: [],
  suppression: [],
  campaigns: [],
  logs: []
}).write();

module.exports = db;
