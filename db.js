const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const adapter = new FileSync(path.join(dataDir, 'db.json'));
const db = low(adapter);

const crypto = require('crypto');

db.defaults({
  settings: {
    smtp: { host: '', port: 587, secure: false, user: '', pass: '', fromName: '', fromEmail: '' },
    smtpStatus: { ok: null, message: '', checkedAt: null },
    anthropicApiKey: '',
    apiKeys: [{ id: 'default-anthropic', name: 'Anthropic', key: '', status: { ok: null, message: '', checkedAt: null } }],
    aiPersonalizeEmails: false,
    delayMinSec: 8,
    delayMaxSec: 20,
    dailyLimit: 300,
    leadWebhookSecret: crypto.randomBytes(16).toString('hex'),
    sms: {
      provider: 'twilio',
      accountSid: '',
      authToken: '',
      fromNumber: '',
      delayMinSec: 5,
      delayMaxSec: 15,
      dailyLimit: 200
    },
    smsStatus: { ok: null, message: '', checkedAt: null }
  },
  templates: [],
  contacts: [],
  suppression: [],
  campaigns: [],
  logs: [],
  clicks: [],
  leads: [],
  smsContacts: [],
  smsTemplates: [],
  smsSuppression: [],
  smsCampaigns: [],
  smsLogs: []
}).write();

module.exports = db;
