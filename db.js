const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const _ = require('lodash');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const adapter = new FileSync(path.join(dataDir, 'db.json'));
const db = low(adapter);

const DEFAULTS = {
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
    smsStatus: { ok: null, message: '', checkedAt: null },
    apiBudget: { maxUsd: 10, alertThresholdPct: 80 }
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
  smsLogs: [],
  apiUsage: []
};

// Plain db.defaults() only fills in top-level keys that are completely absent — it will
// NOT add a new nested field (like settings.sms) into an already-existing "settings"
// object from an older version of this app. That used to crash the whole server the
// first time a route touched a field that didn't exist yet. Deep-merging the saved
// state on top of DEFAULTS guarantees every field this app expects always exists,
// while never overwriting a value the user already saved.
const existing = db.getState();
const merged = _.merge({}, DEFAULTS, existing);
db.setState(merged).write();

module.exports = db;
