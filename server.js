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
const { addTrackingToLinks } = require('./lib/tracking');

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 4000;
const runningCampaigns = new Map(); // campaignId -> { stop: boolean }

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

// ---------- Templates ----------
app.get('/api/templates', (req, res) => {
  res.json(db.get('templates').value());
});

app.post('/api/templates', (req, res) => {
  const { name, subject, html, imageUrl } = req.body;
  if (!name || !subject || !html) {
    return res.status(400).json({ error: 'name, subject and html are required' });
  }
  const template = { id: uuid(), name, subject, html, imageUrl: imageUrl || '', createdAt: Date.now() };
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
  res.json({ sent, clicks: clickRows.length, uniqueClickers, ctr });
});

// ---------- Link click tracking ----------
app.get('/api/track/click', (req, res) => {
  const { tid, e, u } = req.query;
  const url = u || '';
  if (!/^https?:\/\//i.test(url)) return res.status(400).send('Invalid link');
  db.get('clicks').push({ id: uuid(), templateId: tid || null, email: e || null, url, clickedAt: Date.now() }).write();
  res.redirect(302, url);
});

// ---------- Contacts ----------
app.get('/api/contacts', (req, res) => {
  res.json(db.get('contacts').value());
});

app.post('/api/contacts/extract', async (req, res) => {
  const { rawText } = req.body;
  if (!rawText) return res.status(400).json({ error: 'rawText is required' });

  const settings = db.get('settings').value();
  const extracted = await extractEmails(rawText, settings.anthropicApiKey);
  const suppression = new Set(db.get('suppression').value());
  const existing = new Set(db.get('contacts').value().map((c) => c.email));

  const added = [];
  extracted.forEach(({ email, name }) => {
    if (existing.has(email)) return;
    let status = 'active';
    if (suppression.has(email)) status = 'suppressed';
    else if (!isValidFormat(email)) status = 'invalid';
    else if (isDisposable(email)) status = 'invalid';
    const contact = { id: uuid(), email, name: name || '', status, bounceCount: 0, lastBounceReason: null, addedAt: Date.now() };
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

app.post('/api/campaign/start', (req, res) => {
  const { templateId, contactIds } = req.body;
  const settings = db.get('settings').value();
  const template = db.get('templates').find({ id: templateId }).value();
  if (!template) return res.status(400).json({ error: 'Template not found' });
  if (!settings.smtp.host || !settings.smtp.user || !settings.smtp.pass) {
    return res.status(400).json({ error: 'SMTP settings are incomplete. Configure them first.' });
  }

  const suppression = new Set(db.get('suppression').value());
  let contacts = db.get('contacts').value();
  if (Array.isArray(contactIds) && contactIds.length) {
    const idSet = new Set(contactIds);
    contacts = contacts.filter((c) => idSet.has(c.id));
  }
  contacts = contacts.filter((c) => c.status === 'active' && !suppression.has(c.email));

  const dailyLimit = Number(settings.dailyLimit) || 300;
  contacts = contacts.slice(0, dailyLimit);

  const campaign = {
    id: uuid(),
    templateId,
    status: 'running',
    total: contacts.length,
    sent: 0,
    failed: 0,
    skipped: 0,
    createdAt: Date.now()
  };
  db.get('campaigns').push(campaign).write();
  runningCampaigns.set(campaign.id, { stop: false });

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const unsubscribeBaseUrl = `${baseUrl}/api/unsubscribe`;

  (async () => {
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
      let logEntry = { id: uuid(), campaignId: campaign.id, templateId, email: contact.email, status: 'sent', error: null, sentAt: Date.now(), aiPersonalized: false };
      try {
        let subject = fillPlaceholders(template.subject, contact);
        let html = fillPlaceholders(template.html, contact);

        if (settings.aiPersonalizeEmails && settings.anthropicApiKey) {
          try {
            const rewritten = await personalizeEmail({ apiKey: settings.anthropicApiKey, subject: template.subject, html: template.html, contact });
            subject = rewritten.subject;
            html = rewritten.html;
            logEntry.aiPersonalized = true;
          } catch (aiErr) {
            console.error(`AI personalize failed for ${contact.email}, sending plain version:`, aiErr.message);
          }
        }

        html = addTrackingToLinks(html, { baseUrl, templateId, email: contact.email });

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
  })();

  res.json(campaign);
});

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

  res.json({
    counts: {
      total: contacts.length,
      pending: pendingContacts.length,
      sent: sentContacts.length,
      bounced: bouncedContacts.length,
      invalid: invalidContacts.length,
      suppressed: suppressedContacts.length,
      sentToday
    },
    lists: {
      pending: pendingContacts.slice(0, 200),
      sent: sentContacts.sort((a, b) => b.lastSentAt - a.lastSentAt).slice(0, 200),
      bounced: bouncedContacts.slice(0, 200),
      invalid: invalidContacts.slice(0, 200),
      suppressed: suppressedContacts.slice(0, 200)
    },
    health
  });
});

app.listen(PORT, () => {
  console.log(`Neercred email marketing tool running at http://localhost:${PORT}`);
});
