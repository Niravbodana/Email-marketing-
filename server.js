const express = require('express');
const path = require('path');
const { v4: uuid } = require('uuid');
const db = require('./db');
const { sendOne } = require('./lib/mailer');
const { extractEmails } = require('./lib/extractEmails');

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
  db.set('settings', { ...db.get('settings').value(), ...req.body }).write();
  res.json(db.get('settings').value());
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
    const suppressed = suppression.has(email);
    const contact = { id: uuid(), email, name: name || '', status: suppressed ? 'suppressed' : 'active', addedAt: Date.now() };
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
  contacts = contacts.filter((c) => c.status !== 'suppressed' && !suppression.has(c.email));

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

  const unsubscribeBaseUrl = `${req.protocol}://${req.get('host')}/api/unsubscribe`;

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
      let logEntry = { id: uuid(), campaignId: campaign.id, email: contact.email, status: 'sent', error: null, sentAt: Date.now() };
      try {
        await sendOne({
          smtp: settings.smtp,
          template,
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

app.listen(PORT, () => {
  console.log(`Neercred email marketing tool running at http://localhost:${PORT}`);
});
