const express = require('express');
const path = require('path');
const { v4: uuid } = require('uuid');
const db = require('./db');
const { sendOne, fillPlaceholders, testSmtpConnection } = require('./lib/mailer');
const { extractEmails } = require('./lib/extractEmails');
const { isValidFormat, isDisposable, isHardBounce } = require('./lib/validateEmail');
const { computeSendingHealth, findSpamWordsInText } = require('./lib/health');
const { personalizeEmail } = require('./lib/personalize');
const { testApiKey } = require('./lib/apiKeyCheck');
const { calcCostUsd } = require('./lib/pricing');
const { addTrackingToLinks } = require('./lib/tracking');
const { sendSms, testSmsProvider } = require('./lib/smsSender');
const { extractPhones } = require('./lib/extractPhones');

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 4000;
const runningCampaigns = new Map(); // campaignId -> { stop: boolean }

// ---------- API cost tracking ----------
function getTotalSpentUsd() {
  return db.get('apiUsage').value().reduce((sum, u) => sum + u.costUsd, 0);
}

function recordApiUsage(feature, usage) {
  if (!usage) return 0;
  const costUsd = calcCostUsd(usage.model, usage.inputTokens, usage.outputTokens);
  db.get('apiUsage').push({
    id: uuid(),
    feature,
    model: usage.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costUsd,
    createdAt: Date.now()
  }).write();
  return costUsd;
}

function isBudgetExceeded() {
  const budget = db.get('settings.apiBudget').value();
  if (!budget || !budget.maxUsd) return false;
  return getTotalSpentUsd() >= budget.maxUsd;
}

app.get('/api/usage/summary', (req, res) => {
  const usage = db.get('apiUsage').value();
  const budget = db.get('settings.apiBudget').value() || { maxUsd: 0 };
  const spentUsd = usage.reduce((sum, u) => sum + u.costUsd, 0);
  const byFeature = {};
  usage.forEach((u) => {
    byFeature[u.feature] = (byFeature[u.feature] || 0) + u.costUsd;
  });
  const maxUsd = Number(budget.maxUsd) || 0;
  const percentUsed = maxUsd ? Math.min(999, Math.round((spentUsd / maxUsd) * 1000) / 10) : 0;
  res.json({
    spentUsd: Math.round(spentUsd * 10000) / 10000,
    maxUsd,
    remainingUsd: maxUsd ? Math.max(0, Math.round((maxUsd - spentUsd) * 10000) / 10000) : null,
    percentUsed,
    callCount: usage.length,
    byFeature
  });
});

// ---------- Settings ----------
app.get('/api/settings', (req, res) => {
  res.json(db.get('settings').value());
});

app.post('/api/settings', (req, res) => {
  const merged = { ...db.get('settings').value(), ...req.body };
  // Keep anthropicApiKey (used internally by extraction/personalization) in sync with
  // whatever key is labeled "Anthropic" in the multi-key list, so the rest of the app
  // doesn't need to know about the apiKeys array.
  if (Array.isArray(merged.apiKeys)) {
    const anthropicEntry = merged.apiKeys.find((k) => (k.name || '').trim().toLowerCase() === 'anthropic');
    if (anthropicEntry) merged.anthropicApiKey = anthropicEntry.key || '';
  }
  db.set('settings', merged).write();
  res.json(db.get('settings').value());
});

app.post('/api/settings/test-smtp', async (req, res) => {
  const smtp = req.body.smtp || db.get('settings').value().smtp;
  const result = await testSmtpConnection(smtp);
  db.get('settings').set('smtpStatus', { ...result, checkedAt: Date.now() }).write();
  res.json(result);
});

app.post('/api/settings/test-api-key', async (req, res) => {
  const { id, name, key } = req.body;
  const result = await testApiKey(name, key);
  if (id) {
    const apiKeys = db.get('settings.apiKeys').value() || [];
    const idx = apiKeys.findIndex((k) => k.id === id);
    if (idx !== -1) {
      db.get('settings.apiKeys')
        .find({ id })
        .assign({ status: { ...result, checkedAt: Date.now() } })
        .write();
    }
  }
  res.json(result);
});

app.post('/api/settings/test-sms', async (req, res) => {
  const provider = req.body.sms || db.get('settings').value().sms;
  const result = await testSmsProvider(provider);
  db.get('settings').set('smsStatus', { ...result, checkedAt: Date.now() }).write();
  res.json(result);
});

// ---------- Templates ----------
app.get('/api/templates', (req, res) => {
  res.json(db.get('templates').value());
});

function buildCtaButtonHtml(ctaText, ctaUrl) {
  if (!ctaText || !ctaUrl) return '';
  return `<div style="text-align:center;margin:28px 0">
  <a href="${ctaUrl}" style="background:#2563eb;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:600;font-size:16px;display:inline-block">${ctaText}</a>
</div>`;
}

app.post('/api/templates', (req, res) => {
  const { name, subject, html, imageUrl, ctaText, ctaUrl } = req.body;
  if (!name || !subject || !html) {
    return res.status(400).json({ error: 'name, subject and html are required' });
  }
  if (ctaUrl && !/^https?:\/\//i.test(ctaUrl)) {
    return res.status(400).json({ error: 'Button link http:// ya https:// se shuru honi chahiye.' });
  }
  const fullHtml = html + buildCtaButtonHtml(ctaText, ctaUrl);
  const template = {
    id: uuid(),
    name,
    subject,
    html: fullHtml,
    imageUrl: imageUrl || '',
    ctaText: ctaText || '',
    ctaUrl: ctaUrl || '',
    createdAt: Date.now()
  };
  db.get('templates').push(template).write();
  res.json(template);
});

app.delete('/api/templates/:id', (req, res) => {
  db.get('templates').remove({ id: req.params.id }).write();
  res.json({ ok: true });
});

app.post('/api/templates/check-words', (req, res) => {
  const { subject, html } = req.body;
  const matches = findSpamWordsInText(`${subject || ''} ${html || ''}`);
  res.json({ matches });
});

// Per-template stats: how many were sent under this template, and how many of those
// recipients actually clicked through to the website — the closest proxy we have for
// "which template brings leads" without a direct integration into neercred.com itself.
app.get('/api/templates/:id/stats', (req, res) => {
  const templateId = req.params.id;
  const sent = db.get('logs').filter({ templateId, status: 'sent' }).value().length;
  const clickRows = db.get('clicks').filter({ templateId }).value();
  const uniqueClickers = new Set(clickRows.map((c) => c.email)).size;
  const ctr = sent ? Math.round((uniqueClickers / sent) * 1000) / 10 : 0;
  const leadsCount = db.get('leads').filter({ attributedTemplateId: templateId }).value().length;
  res.json({ sent, clicks: clickRows.length, uniqueClickers, ctr, leadsCount });
});

// ---------- Link click tracking ----------
app.get('/api/track/click', (req, res) => {
  const { tid, e, u } = req.query;
  const url = u || '';
  if (!/^https?:\/\//i.test(url)) return res.status(400).send('Invalid link');
  db.get('clicks').push({ id: uuid(), templateId: tid || null, email: e || null, url, clickedAt: Date.now() }).write();
  res.redirect(302, url);
});

// ---------- Lead-conversion webhook ----------
// neercred.com's Apply form should POST here when someone actually submits, so we can
// tell "clicked the email" apart from "actually became a lead" per template.
app.post('/api/leads/webhook', (req, res) => {
  const { secret, email, phone, name } = req.body;
  const expected = db.get('settings.leadWebhookSecret').value();
  if (!secret || secret !== expected) return res.status(401).json({ error: 'Invalid webhook secret' });
  if (!email && !phone) return res.status(400).json({ error: 'email or phone is required' });

  // Attribute this lead to whichever template's tracked link this email most recently clicked.
  const clicksByEmail = email
    ? db.get('clicks').filter((c) => c.email === email).value().sort((a, b) => b.clickedAt - a.clickedAt)
    : [];
  const attributedTemplateId = clicksByEmail[0]?.templateId || null;

  const lead = {
    id: uuid(),
    email: email || null,
    phone: phone || null,
    name: name || '',
    attributedTemplateId,
    receivedAt: Date.now()
  };
  db.get('leads').push(lead).write();
  res.json({ ok: true, attributedTemplateId });
});

app.get('/api/leads', (req, res) => {
  res.json(db.get('leads').value().slice().reverse());
});

// ---------- Contacts ----------
app.get('/api/contacts', (req, res) => {
  res.json(db.get('contacts').value());
});

app.post('/api/contacts/extract', async (req, res) => {
  const { rawText } = req.body;
  if (!rawText) return res.status(400).json({ error: 'rawText is required' });

  const settings = db.get('settings').value();
  const apiKeyToUse = isBudgetExceeded() ? null : settings.anthropicApiKey;
  const { contacts: extracted, usage } = await extractEmails(rawText, apiKeyToUse);
  recordApiUsage('extraction', usage);
  const suppression = new Set(db.get('suppression').value());
  const existing = new Set(db.get('contacts').value().map((c) => c.email));

  const added = [];
  extracted.forEach(({ email, name }) => {
    if (existing.has(email)) return;
    let status = 'active';
    if (suppression.has(email)) status = 'suppressed';
    else if (!isValidFormat(email)) status = 'invalid';
    else if (isDisposable(email)) status = 'invalid';
    const contact = { id: uuid(), email, name: name || '', tags: [], status, bounceCount: 0, lastBounceReason: null, addedAt: Date.now() };
    db.get('contacts').push(contact).write();
    existing.add(email);
    added.push(contact);
  });

  res.json({ addedCount: added.length, totalExtracted: extracted.length, added });
});

app.delete('/api/contacts/:id', (req, res) => {
  db.get('contacts').remove({ id: req.params.id }).write();
  res.json({ ok: true });
});

app.patch('/api/contacts/:id/tags', (req, res) => {
  const tags = Array.isArray(req.body.tags) ? req.body.tags.map((t) => String(t).trim()).filter(Boolean) : [];
  const contact = db.get('contacts').find({ id: req.params.id }).assign({ tags }).write();
  res.json(contact);
});

app.get('/api/contacts/tags', (req, res) => {
  const tagSet = new Set();
  db.get('contacts').value().forEach((c) => (c.tags || []).forEach((t) => tagSet.add(t)));
  res.json([...tagSet].sort());
});

function toCsv(rows, columns) {
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = columns.map(escape).join(',');
  const body = rows.map((r) => columns.map((c) => escape(r[c])).join(',')).join('\n');
  return `${header}\n${body}`;
}

app.get('/api/contacts/export.csv', (req, res) => {
  const contacts = db.get('contacts').value().map((c) => ({ ...c, tags: (c.tags || []).join('|') }));
  const csv = toCsv(contacts, ['email', 'name', 'status', 'tags', 'bounceCount', 'lastBounceReason', 'addedAt']);
  res.set('Content-Type', 'text/csv');
  res.set('Content-Disposition', 'attachment; filename="contacts.csv"');
  res.send(csv);
});

app.get('/api/logs/export.csv', (req, res) => {
  const logs = db.get('logs').value();
  const csv = toCsv(logs, ['email', 'templateId', 'campaignId', 'status', 'error', 'aiPersonalized', 'sentAt']);
  res.set('Content-Type', 'text/csv');
  res.set('Content-Disposition', 'attachment; filename="send-logs.csv"');
  res.send(csv);
});

// Re-validates every contact's email format/domain and flags dupes; does not touch
// suppressed/bounced status set by real unsubscribes or send failures.
app.post('/api/contacts/health-check', (req, res) => {
  const suppression = new Set(db.get('suppression').value());
  const contacts = db.get('contacts').value();
  const seen = new Set();
  let invalidCount = 0;
  let duplicateCount = 0;

  contacts.forEach((c) => {
    if (c.status === 'suppressed' || c.status === 'bounced') return;
    const key = c.email.toLowerCase();
    if (seen.has(key)) {
      db.get('contacts').find({ id: c.id }).assign({ status: 'invalid', lastBounceReason: 'duplicate' }).write();
      duplicateCount += 1;
      return;
    }
    seen.add(key);
    if (suppression.has(key)) {
      db.get('contacts').find({ id: c.id }).assign({ status: 'suppressed' }).write();
      return;
    }
    if (!isValidFormat(c.email) || isDisposable(c.email)) {
      db.get('contacts').find({ id: c.id }).assign({ status: 'invalid', lastBounceReason: 'bad_format_or_disposable' }).write();
      invalidCount += 1;
      return;
    }
    if (c.status === 'invalid') {
      db.get('contacts').find({ id: c.id }).assign({ status: 'active' }).write();
    }
  });

  res.json({ checked: contacts.length, invalidCount, duplicateCount });
});

app.get('/api/contacts/health', (req, res) => {
  const contacts = db.get('contacts').value();
  const summary = { total: contacts.length, active: 0, invalid: 0, bounced: 0, suppressed: 0 };
  contacts.forEach((c) => {
    if (summary[c.status] !== undefined) summary[c.status] += 1;
  });
  res.json(summary);
});

// ---------- Suppression / Unsubscribe ----------
app.get('/api/unsubscribe', (req, res) => {
  const email = (req.query.email || '').toLowerCase();
  if (email) {
    const suppression = db.get('suppression');
    if (!suppression.value().includes(email)) suppression.push(email).write();
    db.get('contacts').find({ email }).assign({ status: 'suppressed' }).write();
  }
  res.send('<html><body style="font-family:sans-serif;padding:40px"><h2>You have been unsubscribed.</h2><p>You will not receive further emails from us.</p></body></html>');
});

app.get('/api/suppression', (req, res) => {
  res.json(db.get('suppression').value());
});

// ---------- Campaigns ----------
function randomDelayMs(minSec, maxSec) {
  const min = Math.max(1, Number(minSec) || 8);
  const max = Math.max(min, Number(maxSec) || 20);
  return (min + Math.random() * (max - min)) * 1000;
}

async function runEmailCampaignLoop(campaign, contacts, template, baseUrl) {
  const settings = db.get('settings').value();
  const unsubscribeBaseUrl = `${baseUrl}/api/unsubscribe`;

  for (const contact of contacts) {
    const state = runningCampaigns.get(campaign.id);
    if (!state || state.stop) {
      db.get('campaigns').find({ id: campaign.id }).assign({ status: 'stopped' }).write();
      return;
    }
    const currentSuppression = new Set(db.get('suppression').value());
    if (currentSuppression.has(contact.email)) {
      db.get('campaigns').find({ id: campaign.id }).update('skipped', (n) => n + 1).write();
      continue;
    }
    let logEntry = { id: uuid(), campaignId: campaign.id, templateId: template.id, email: contact.email, status: 'sent', error: null, sentAt: Date.now(), aiPersonalized: false };
    try {
      let subject = fillPlaceholders(template.subject, contact);
      let html = fillPlaceholders(template.html, contact);

      if (settings.aiPersonalizeEmails && settings.anthropicApiKey && !isBudgetExceeded()) {
        try {
          const rewritten = await personalizeEmail({ apiKey: settings.anthropicApiKey, subject: template.subject, html: template.html, contact });
          subject = rewritten.subject;
          html = rewritten.html;
          logEntry.aiPersonalized = true;
          recordApiUsage('personalization', rewritten.usage);
        } catch (aiErr) {
          console.error(`AI personalize failed for ${contact.email}, sending plain version:`, aiErr.message);
          recordApiUsage('personalization', aiErr.usage);
        }
      }

      html = addTrackingToLinks(html, { baseUrl, templateId: template.id, email: contact.email });

      await sendOne({
        smtp: settings.smtp,
        subject,
        html,
        contact,
        fromName: settings.smtp.fromName,
        fromEmail: settings.smtp.fromEmail,
        unsubscribeBaseUrl
      });
      db.get('campaigns').find({ id: campaign.id }).update('sent', (n) => n + 1).write();
    } catch (err) {
      logEntry.status = 'failed';
      logEntry.error = err.message;
      db.get('campaigns').find({ id: campaign.id }).update('failed', (n) => n + 1).write();

      const bounceCount = (contact.bounceCount || 0) + 1;
      if (isHardBounce(err)) {
        db.get('contacts').find({ id: contact.id }).assign({ status: 'bounced', bounceCount, lastBounceReason: err.message }).write();
        if (!db.get('suppression').value().includes(contact.email)) {
          db.get('suppression').push(contact.email).write();
        }
      } else {
        db.get('contacts').find({ id: contact.id }).assign({ bounceCount, lastBounceReason: err.message }).write();
      }
    }
    db.get('logs').push(logEntry).write();
    await new Promise((r) => setTimeout(r, randomDelayMs(settings.delayMinSec, settings.delayMaxSec)));
  }
  db.get('campaigns').find({ id: campaign.id }).assign({ status: 'completed' }).write();
  runningCampaigns.delete(campaign.id);
}

function resolveCampaignContacts({ contactIds, tag, dailyLimit }) {
  const suppression = new Set(db.get('suppression').value());
  let contacts = db.get('contacts').value();
  if (Array.isArray(contactIds) && contactIds.length) {
    const idSet = new Set(contactIds);
    contacts = contacts.filter((c) => idSet.has(c.id));
  } else if (tag) {
    contacts = contacts.filter((c) => (c.tags || []).includes(tag));
  }
  contacts = contacts.filter((c) => c.status === 'active' && !suppression.has(c.email));
  return contacts.slice(0, dailyLimit);
}

app.post('/api/campaign/start', (req, res) => {
  const { templateId, contactIds, tag, scheduledAt } = req.body;
  const settings = db.get('settings').value();
  const template = db.get('templates').find({ id: templateId }).value();
  if (!template) return res.status(400).json({ error: 'Template not found' });
  if (!settings.smtp.host || !settings.smtp.user || !settings.smtp.pass) {
    return res.status(400).json({ error: 'SMTP settings are incomplete. Configure them first.' });
  }

  const dailyLimit = Number(settings.dailyLimit) || 300;
  const contacts = resolveCampaignContacts({ contactIds, tag, dailyLimit });
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const scheduledTime = scheduledAt ? new Date(scheduledAt).getTime() : null;
  const isFuture = scheduledTime && scheduledTime > Date.now();

  const campaign = {
    id: uuid(),
    templateId,
    contactIds: contacts.map((c) => c.id),
    tag: tag || null,
    baseUrl,
    status: isFuture ? 'scheduled' : 'running',
    scheduledAt: isFuture ? scheduledTime : null,
    total: contacts.length,
    sent: 0,
    failed: 0,
    skipped: 0,
    createdAt: Date.now()
  };
  db.get('campaigns').push(campaign).write();

  if (!isFuture) {
    runningCampaigns.set(campaign.id, { stop: false });
    runEmailCampaignLoop(campaign, contacts, template, baseUrl);
  }

  res.json(campaign);
});

// Checks every 30s for scheduled campaigns whose time has come and starts them.
setInterval(() => {
  const due = db.get('campaigns').filter((c) => c.status === 'scheduled' && c.scheduledAt <= Date.now()).value();
  due.forEach((campaign) => {
    const template = db.get('templates').find({ id: campaign.templateId }).value();
    if (!template) {
      db.get('campaigns').find({ id: campaign.id }).assign({ status: 'failed_no_template' }).write();
      return;
    }
    const contacts = db.get('contacts').value().filter((c) => campaign.contactIds.includes(c.id));
    const suppression = new Set(db.get('suppression').value());
    const readyContacts = contacts.filter((c) => c.status === 'active' && !suppression.has(c.email));
    db.get('campaigns').find({ id: campaign.id }).assign({ status: 'running', total: readyContacts.length }).write();
    runningCampaigns.set(campaign.id, { stop: false });
    runEmailCampaignLoop(campaign, readyContacts, template, campaign.baseUrl);
  });
}, 30000);

app.post('/api/campaign/:id/stop', (req, res) => {
  const state = runningCampaigns.get(req.params.id);
  if (state) state.stop = true;
  res.json({ ok: true });
});

app.get('/api/campaign/:id/status', (req, res) => {
  const campaign = db.get('campaigns').find({ id: req.params.id }).value();
  if (!campaign) return res.status(404).json({ error: 'not found' });
  const logs = db.get('logs').filter({ campaignId: campaign.id }).value();
  res.json({ campaign, logs });
});

app.get('/api/campaigns', (req, res) => {
  res.json(db.get('campaigns').value().slice().reverse());
});

// ================= SMS MARKETING (separate channel, mirrors the email flow) =================
// Honest limitation shown in the UI too: this cannot check India's DND/NDNC registry —
// there's no free public API for that. Real Indian promotional SMS needs a DLT-registered
// provider (the operator blocks DND numbers automatically at that layer). Twilio (the
// provider wired up here) is not DLT-registered for India — fine for testing / non-Indian
// numbers, but swap in a DLT-compliant provider's API in lib/smsSender.js for real
// India-wide loan SMS marketing.

app.get('/api/sms/contacts', (req, res) => {
  res.json(db.get('smsContacts').value());
});

app.post('/api/sms/contacts/extract', (req, res) => {
  const { rawText } = req.body;
  if (!rawText) return res.status(400).json({ error: 'rawText is required' });

  const extracted = extractPhones(rawText);
  const suppression = new Set(db.get('smsSuppression').value());
  const existing = new Set(db.get('smsContacts').value().map((c) => c.phone));

  const added = [];
  extracted.forEach(({ phone, name }) => {
    if (existing.has(phone)) return;
    const status = suppression.has(phone) ? 'suppressed' : 'active';
    const contact = { id: uuid(), phone, name: name || '', tags: [], status, failCount: 0, lastError: null, addedAt: Date.now() };
    db.get('smsContacts').push(contact).write();
    existing.add(phone);
    added.push(contact);
  });

  res.json({ addedCount: added.length, totalExtracted: extracted.length, added });
});

app.delete('/api/sms/contacts/:id', (req, res) => {
  db.get('smsContacts').remove({ id: req.params.id }).write();
  res.json({ ok: true });
});

app.get('/api/sms/templates', (req, res) => {
  res.json(db.get('smsTemplates').value());
});

app.post('/api/sms/templates', (req, res) => {
  const { name, body, ctaUrl } = req.body;
  if (!name || !body) return res.status(400).json({ error: 'name and body are required' });
  if (ctaUrl && !/^https?:\/\//i.test(ctaUrl)) {
    return res.status(400).json({ error: 'Link http:// ya https:// se shuru honi chahiye.' });
  }
  const fullBody = ctaUrl ? `${body}\n${ctaUrl}` : body;
  const template = { id: uuid(), name, body: fullBody, ctaUrl: ctaUrl || '', createdAt: Date.now() };
  db.get('smsTemplates').push(template).write();
  res.json(template);
});

app.delete('/api/sms/templates/:id', (req, res) => {
  db.get('smsTemplates').remove({ id: req.params.id }).write();
  res.json({ ok: true });
});

app.get('/api/sms/opt-out', (req, res) => {
  const phone = (req.query.phone || '').replace(/[-.\s]/g, '');
  if (phone) {
    const suppression = db.get('smsSuppression');
    if (!suppression.value().includes(phone)) suppression.push(phone).write();
    db.get('smsContacts').find({ phone }).assign({ status: 'suppressed' }).write();
  }
  res.send('You have been unsubscribed from SMS updates.');
});

// Twilio (or any SMS provider) can point its inbound-message webhook here; a reply of
// STOP/UNSUBSCRIBE opts that number out permanently, same as the email unsubscribe link.
app.post('/api/sms/webhook/inbound', (req, res) => {
  const from = (req.body.From || req.body.from || '').replace(/[-.\s]/g, '');
  const text = (req.body.Body || req.body.body || '').trim().toLowerCase();
  if (from && ['stop', 'unsubscribe', 'stop all'].includes(text)) {
    const suppression = db.get('smsSuppression');
    if (!suppression.value().includes(from)) suppression.push(from).write();
    db.get('smsContacts').find({ phone: from }).assign({ status: 'suppressed' }).write();
  }
  res.set('Content-Type', 'text/xml').send('<Response></Response>');
});

function randomSmsDelayMs(minSec, maxSec) {
  const min = Math.max(1, Number(minSec) || 5);
  const max = Math.max(min, Number(maxSec) || 15);
  return (min + Math.random() * (max - min)) * 1000;
}

async function runSmsCampaignLoop(campaign, contacts, template) {
  const settings = db.get('settings').value();
  for (const contact of contacts) {
    const state = runningCampaigns.get(campaign.id);
    if (!state || state.stop) {
      db.get('smsCampaigns').find({ id: campaign.id }).assign({ status: 'stopped' }).write();
      return;
    }
    const currentSuppression = new Set(db.get('smsSuppression').value());
    if (currentSuppression.has(contact.phone)) {
      db.get('smsCampaigns').find({ id: campaign.id }).update('skipped', (n) => n + 1).write();
      continue;
    }
    const body = fillPlaceholders(template.body, { name: contact.name, email: contact.phone });
    let logEntry = { id: uuid(), campaignId: campaign.id, templateId: template.id, phone: contact.phone, status: 'sent', error: null, sentAt: Date.now() };
    try {
      await sendSms({ provider: settings.sms, to: contact.phone, body });
      db.get('smsCampaigns').find({ id: campaign.id }).update('sent', (n) => n + 1).write();
    } catch (err) {
      logEntry.status = 'failed';
      logEntry.error = err.message;
      db.get('smsCampaigns').find({ id: campaign.id }).update('failed', (n) => n + 1).write();
      const failCount = (contact.failCount || 0) + 1;
      db.get('smsContacts').find({ id: contact.id }).assign({ failCount, lastError: err.message, status: failCount >= 3 ? 'bounced' : contact.status }).write();
    }
    db.get('smsLogs').push(logEntry).write();
    await new Promise((r) => setTimeout(r, randomSmsDelayMs(settings.sms.delayMinSec, settings.sms.delayMaxSec)));
  }
  db.get('smsCampaigns').find({ id: campaign.id }).assign({ status: 'completed' }).write();
  runningCampaigns.delete(campaign.id);
}

app.post('/api/sms/campaign/start', (req, res) => {
  const { templateId, contactIds, tag } = req.body;
  const settings = db.get('settings').value();
  const template = db.get('smsTemplates').find({ id: templateId }).value();
  if (!template) return res.status(400).json({ error: 'Template not found' });
  if (!settings.sms.accountSid || !settings.sms.authToken || !settings.sms.fromNumber) {
    return res.status(400).json({ error: 'SMS provider settings are incomplete. Configure them first.' });
  }

  const suppression = new Set(db.get('smsSuppression').value());
  let contacts = db.get('smsContacts').value();
  if (Array.isArray(contactIds) && contactIds.length) {
    const idSet = new Set(contactIds);
    contacts = contacts.filter((c) => idSet.has(c.id));
  } else if (tag) {
    contacts = contacts.filter((c) => (c.tags || []).includes(tag));
  }
  contacts = contacts.filter((c) => c.status === 'active' && !suppression.has(c.phone));

  const dailyLimit = Number(settings.sms.dailyLimit) || 200;
  contacts = contacts.slice(0, dailyLimit);

  const campaign = { id: uuid(), templateId, status: 'running', total: contacts.length, sent: 0, failed: 0, skipped: 0, createdAt: Date.now() };
  db.get('smsCampaigns').push(campaign).write();
  runningCampaigns.set(campaign.id, { stop: false });
  runSmsCampaignLoop(campaign, contacts, template);

  res.json(campaign);
});

app.post('/api/sms/campaign/:id/stop', (req, res) => {
  const state = runningCampaigns.get(req.params.id);
  if (state) state.stop = true;
  res.json({ ok: true });
});

app.get('/api/sms/campaign/:id/status', (req, res) => {
  const campaign = db.get('smsCampaigns').find({ id: req.params.id }).value();
  if (!campaign) return res.status(404).json({ error: 'not found' });
  const logs = db.get('smsLogs').filter({ campaignId: campaign.id }).value();
  res.json({ campaign, logs });
});

app.get('/api/sms/dashboard', (req, res) => {
  const contacts = db.get('smsContacts').value();
  const logs = db.get('smsLogs').value();
  const summary = { total: contacts.length, active: 0, bounced: 0, suppressed: 0 };
  contacts.forEach((c) => {
    if (summary[c.status] !== undefined) summary[c.status] += 1;
  });
  const sent = logs.filter((l) => l.status === 'sent').length;
  const failed = logs.filter((l) => l.status === 'failed').length;
  res.json({ ...summary, sent, failed });
});

// ---------- Dashboard ----------
app.get('/api/dashboard', async (req, res) => {
  const settings = db.get('settings').value();
  const contacts = db.get('contacts').value();
  const logs = db.get('logs').value();
  const templates = db.get('templates').value();

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const sentToday = logs.filter((l) => l.status === 'sent' && l.sentAt >= startOfToday.getTime()).length;

  // Most recent successful send per email
  const lastSentByEmail = new Map();
  logs.forEach((l) => {
    if (l.status !== 'sent') return;
    const prev = lastSentByEmail.get(l.email);
    if (!prev || l.sentAt > prev) lastSentByEmail.set(l.email, l.sentAt);
  });

  const activeContacts = contacts.filter((c) => c.status === 'active');
  const bouncedContacts = contacts.filter((c) => c.status === 'bounced');
  const invalidContacts = contacts.filter((c) => c.status === 'invalid');
  const suppressedContacts = contacts.filter((c) => c.status === 'suppressed');

  const sentContacts = [];
  const pendingContacts = [];
  activeContacts.forEach((c) => {
    if (lastSentByEmail.has(c.email)) {
      sentContacts.push({ ...c, lastSentAt: lastSentByEmail.get(c.email) });
    } else {
      pendingContacts.push(c);
    }
  });
  // A contact can bounce after previously being counted active; also surface anyone
  // ever successfully sent to, even if their status later changed.
  contacts.forEach((c) => {
    if (c.status !== 'active' && lastSentByEmail.has(c.email)) {
      sentContacts.push({ ...c, lastSentAt: lastSentByEmail.get(c.email) });
    }
  });

  const totalAttempted = logs.filter((l) => l.status === 'sent' || l.status === 'failed').length;

  const health = await computeSendingHealth({
    settings,
    sentToday,
    totalAttempted,
    bouncedCount: bouncedContacts.length,
    suppressedCount: suppressedContacts.length,
    totalContacts: contacts.length,
    invalidCount: invalidContacts.length,
    templates
  });

  // SMS summary (separate channel, same shape idea as email counts)
  const smsContacts = db.get('smsContacts').value();
  const smsLogs = db.get('smsLogs').value();
  const smsSent = smsLogs.filter((l) => l.status === 'sent').length;
  const smsFailed = smsLogs.filter((l) => l.status === 'failed').length;

  // Queue: campaigns not finished yet (scheduled, or running with more left to send)
  const emailCampaigns = db.get('campaigns').value();
  const smsCampaigns = db.get('smsCampaigns').value();
  const scheduledCampaigns = emailCampaigns.filter((c) => c.status === 'scheduled');
  const runningEmailCampaigns = emailCampaigns.filter((c) => c.status === 'running');
  const runningSmsCampaigns = smsCampaigns.filter((c) => c.status === 'running');
  const inQueueCount =
    scheduledCampaigns.reduce((sum, c) => sum + c.total, 0) +
    runningEmailCampaigns.reduce((sum, c) => sum + (c.total - c.sent - c.failed - c.skipped), 0) +
    runningSmsCampaigns.reduce((sum, c) => sum + (c.total - c.sent - c.failed - c.skipped), 0);

  const usageSummary = (() => {
    const usage = db.get('apiUsage').value();
    const budget = settings.apiBudget || { maxUsd: 0 };
    const spentUsd = usage.reduce((sum, u) => sum + u.costUsd, 0);
    const maxUsd = Number(budget.maxUsd) || 0;
    const percentUsed = maxUsd ? Math.min(999, Math.round((spentUsd / maxUsd) * 1000) / 10) : 0;
    return { spentUsd: Math.round(spentUsd * 10000) / 10000, maxUsd, percentUsed };
  })();

  const alerts = [];
  if (!settings.smtp.host && !settings.smtp.user) {
    alerts.push({ id: 'smtp-unconfigured', severity: 'info', title: 'Email account set nahi hai', message: 'Abhi tak koi SMTP email connect nahi kiya.', fix: 'Settings tab me jaake apna email host/user/password bharo aur "Test Connection" dabao.' });
  } else if (settings.smtpStatus?.ok === false) {
    alerts.push({ id: 'smtp-down', severity: 'critical', title: 'Email connection kaam nahi kar raha', message: settings.smtpStatus.message || 'SMTP connection fail ho raha hai.', fix: 'Settings tab me jaake SMTP host/port/password check karo, phir "Test Connection" dobara dabao.' });
  }
  (settings.apiKeys || []).forEach((k) => {
    if (k.key && k.status?.ok === false) {
      alerts.push({ id: `apikey-${k.id}`, severity: 'warning', title: `${k.name || 'API'} key invalid hai`, message: k.status.message || 'Yeh API key kaam nahi kar rahi.', fix: 'Settings tab me sahi key daalo aur "Test" dabao.' });
    }
  });
  if (settings.sms?.accountSid && settings.smsStatus?.ok === false) {
    alerts.push({ id: 'sms-down', severity: 'warning', title: 'SMS provider connect nahi ho raha', message: settings.smsStatus.message || 'Twilio connection fail ho raha hai.', fix: 'Settings tab me SMS Account SID/Auth Token check karo aur "Test SMS Connection" dabao.' });
  }
  if (usageSummary.maxUsd > 0 && usageSummary.percentUsed >= 100) {
    alerts.push({ id: 'budget-exceeded', severity: 'critical', title: 'API budget khatam ho gaya', message: `$${usageSummary.spentUsd} spent, limit $${usageSummary.maxUsd} thi. AI personalization/extraction ab kaam nahi karega jab tak limit nahi badhao.`, fix: 'Settings me "API Cost & Budget" section me max limit badhao, ya wait karo agle mahine tak.' });
  } else if (usageSummary.maxUsd > 0 && usageSummary.percentUsed >= (settings.apiBudget?.alertThresholdPct || 80)) {
    alerts.push({ id: 'budget-warning', severity: 'warning', title: 'API budget khatam hone wala hai', message: `Ab tak $${usageSummary.spentUsd} spend ho chuka hai, limit $${usageSummary.maxUsd} ki hai (${usageSummary.percentUsed}%).`, fix: 'Settings me budget check karo — chaho to limit badha do taaki AI features rukein na.' });
  }
  if (health.riskPercent >= 45) {
    alerts.push({ id: 'spam-risk-high', severity: 'warning', title: 'Spam risk high hai', message: `Abhi spam risk ${health.riskPercent}% hai (Danger level).`, fix: 'Dashboard ke "Spam Risk Meter" section me neeche scroll karke red/yellow items dekho aur unhe fix karo.' });
  }
  const recentCompleted = emailCampaigns.filter((c) => c.status === 'completed' && c.total > 0).slice(-3);
  recentCompleted.forEach((c) => {
    const failRate = c.failed / c.total;
    if (failRate > 0.3) {
      alerts.push({ id: `campaign-fail-${c.id}`, severity: 'warning', title: 'Pichli campaign me bahot fail hui', message: `${c.failed} out of ${c.total} emails fail hui (${Math.round(failRate * 100)}%).`, fix: 'SMTP connection aur contact list check karo — Send Campaign tab me us campaign ke logs dekho.' });
    }
  });

  res.json({
    counts: {
      total: contacts.length,
      pending: pendingContacts.length,
      sent: sentContacts.length,
      bounced: bouncedContacts.length,
      invalid: invalidContacts.length,
      suppressed: suppressedContacts.length,
      sentToday,
      smsSent,
      smsFailed,
      inQueue: inQueueCount
    },
    lists: {
      pending: pendingContacts.slice(0, 200),
      sent: sentContacts.sort((a, b) => b.lastSentAt - a.lastSentAt).slice(0, 200),
      bounced: bouncedContacts.slice(0, 200),
      invalid: invalidContacts.slice(0, 200),
      suppressed: suppressedContacts.slice(0, 200)
    },
    health,
    usage: usageSummary,
    alerts
  });
});

app.listen(PORT, () => {
  console.log(`Neercred email marketing tool running at http://localhost:${PORT}`);
});
