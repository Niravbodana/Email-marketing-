const $ = (id) => document.getElementById(id);

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    $(`tab-${btn.dataset.tab}`).classList.add('active');
    if (btn.dataset.tab === 'dashboard' && typeof loadDashboard === 'function') loadDashboard();
  });
});

async function api(path, opts) {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...opts
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ---------- Settings ----------
async function loadSettings() {
  const s = await api('/api/settings');
  $('smtpHost').value = s.smtp.host || '';
  $('smtpPort').value = s.smtp.port || '';
  $('smtpSecure').value = String(!!s.smtp.secure);
  $('smtpUser').value = s.smtp.user || '';
  $('smtpPass').value = s.smtp.pass || '';
  $('fromName').value = s.smtp.fromName || '';
  $('fromEmail').value = s.smtp.fromEmail || '';
  $('anthropicKey').value = s.anthropicApiKey || '';
  $('aiPersonalize').checked = !!s.aiPersonalizeEmails;
  $('delayMin').value = s.delayMinSec ?? 8;
  $('delayMax').value = s.delayMaxSec ?? 20;
  $('dailyLimit').value = s.dailyLimit ?? 300;
}

$('saveSettings').addEventListener('click', async () => {
  try {
    await api('/api/settings', {
      method: 'POST',
      body: JSON.stringify({
        smtp: {
          host: $('smtpHost').value,
          port: Number($('smtpPort').value) || 587,
          secure: $('smtpSecure').value === 'true',
          user: $('smtpUser').value,
          pass: $('smtpPass').value,
          fromName: $('fromName').value,
          fromEmail: $('fromEmail').value
        },
        anthropicApiKey: $('anthropicKey').value,
        aiPersonalizeEmails: $('aiPersonalize').checked,
        delayMinSec: Number($('delayMin').value) || 8,
        delayMaxSec: Number($('delayMax').value) || 20,
        dailyLimit: Number($('dailyLimit').value) || 300
      })
    });
    $('settingsMsg').textContent = 'Settings saved.';
    $('settingsMsg').className = 'msg';
  } catch (e) {
    $('settingsMsg').textContent = e.message;
    $('settingsMsg').className = 'msg error';
  }
});

// ---------- Templates ----------
async function loadTemplates() {
  const templates = await api('/api/templates');
  $('templateList').innerHTML = templates.map((t) => `
    <div class="list-row">
      <span>${t.name} &mdash; <em>${t.subject}</em></span>
      <button data-id="${t.id}" class="deleteTemplate">Delete</button>
    </div>`).join('') || '<div class="list-row">No templates yet.</div>';

  $('campaignTemplate').innerHTML = templates.map((t) => `<option value="${t.id}">${t.name}</option>`).join('');

  document.querySelectorAll('.deleteTemplate').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await api(`/api/templates/${btn.dataset.id}`, { method: 'DELETE' });
      loadTemplates();
    });
  });
}

$('checkWordsBtn').addEventListener('click', async () => {
  try {
    const result = await api('/api/templates/check-words', {
      method: 'POST',
      body: JSON.stringify({ subject: $('tplSubject').value, html: $('tplHtml').value })
    });
    if (!result.matches.length) {
      $('spamWordsResult').innerHTML = '<p class="msg">✅ Koi risky/spammy word nahi mila.</p>';
      return;
    }
    $('spamWordsResult').innerHTML = `
      <div class="word-suggestions">
        ${result.matches.map((m) => `
          <div class="word-row">
            <span class="word-bad">"${m.phrase}"</span>
            <span class="word-arrow">→</span>
            <span class="word-good">${m.alternatives.map((a) => `"${a}"`).join(' or ')}</span>
          </div>
        `).join('')}
      </div>`;
  } catch (e) {
    $('spamWordsResult').innerHTML = `<p class="msg error">${e.message}</p>`;
  }
});

$('saveTemplate').addEventListener('click', async () => {
  try {
    await api('/api/templates', {
      method: 'POST',
      body: JSON.stringify({
        name: $('tplName').value,
        subject: $('tplSubject').value,
        html: $('tplHtml').value,
        imageUrl: $('tplImage').value
      })
    });
    $('templateMsg').textContent = 'Template saved.';
    $('templateMsg').className = 'msg';
    $('tplName').value = '';
    $('tplSubject').value = '';
    $('tplHtml').value = '';
    $('tplImage').value = '';
    $('spamWordsResult').innerHTML = '';
    loadTemplates();
  } catch (e) {
    $('templateMsg').textContent = e.message;
    $('templateMsg').className = 'msg error';
  }
});

// ---------- Contacts ----------
async function loadContacts() {
  const contacts = await api('/api/contacts');
  $('contactCount').textContent = contacts.length;
  $('contactList').innerHTML = contacts.map((c) => `
    <div class="list-row">
      <span>${c.email} ${c.name ? `(${c.name})` : ''} &mdash; <span class="status-${c.status}">${c.status}</span></span>
      <button data-id="${c.id}" class="deleteContact">Remove</button>
    </div>`).join('') || '<div class="list-row">No contacts yet. Paste bulk data above and extract.</div>';

  document.querySelectorAll('.deleteContact').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await api(`/api/contacts/${btn.dataset.id}`, { method: 'DELETE' });
      loadContacts();
    });
  });
}

$('extractBtn').addEventListener('click', async () => {
  const rawText = $('rawData').value.trim();
  if (!rawText) return;
  $('extractMsg').textContent = 'Extracting...';
  $('extractMsg').className = 'msg';
  try {
    const result = await api('/api/contacts/extract', { method: 'POST', body: JSON.stringify({ rawText }) });
    $('extractMsg').textContent = `Found ${result.totalExtracted} email(s), added ${result.addedCount} new contact(s).`;
    $('rawData').value = '';
    loadContacts();
    loadHealth();
  } catch (e) {
    $('extractMsg').textContent = e.message;
    $('extractMsg').className = 'msg error';
  }
});

// ---------- List Health ----------
async function loadHealth() {
  const h = await api('/api/contacts/health');
  const cards = [
    ['active', 'Active (sendable)'],
    ['invalid', 'Invalid'],
    ['bounced', 'Bounced'],
    ['suppressed', 'Suppressed']
  ];
  $('healthSummary').innerHTML = cards.map(([key, label]) => `
    <div class="health-card"><span class="num">${h[key]}</span><span class="label">${label}</span></div>
  `).join('');
}

$('healthCheckBtn').addEventListener('click', async () => {
  $('healthMsg').textContent = 'Checking...';
  $('healthMsg').className = 'msg';
  try {
    const result = await api('/api/contacts/health-check', { method: 'POST' });
    $('healthMsg').textContent = `Checked ${result.checked} contact(s): ${result.invalidCount} invalid, ${result.duplicateCount} duplicate(s) flagged.`;
    loadContacts();
    loadHealth();
  } catch (e) {
    $('healthMsg').textContent = e.message;
    $('healthMsg').className = 'msg error';
  }
});

// ---------- Campaign ----------
let currentCampaignId = null;
let pollTimer = null;

$('startCampaign').addEventListener('click', async () => {
  try {
    const templateId = $('campaignTemplate').value;
    if (!templateId) return alert('Save a template first.');
    const campaign = await api('/api/campaign/start', { method: 'POST', body: JSON.stringify({ templateId }) });
    currentCampaignId = campaign.id;
    $('startCampaign').disabled = true;
    $('stopCampaign').disabled = false;
    pollStatus();
    pollTimer = setInterval(pollStatus, 3000);
  } catch (e) {
    $('campaignStatus').textContent = e.message;
    $('campaignStatus').className = 'msg error';
  }
});

$('stopCampaign').addEventListener('click', async () => {
  if (!currentCampaignId) return;
  await api(`/api/campaign/${currentCampaignId}/stop`, { method: 'POST' });
});

async function pollStatus() {
  if (!currentCampaignId) return;
  const { campaign, logs } = await api(`/api/campaign/${currentCampaignId}/status`);
  $('campaignStatus').innerHTML = `Status: <b>${campaign.status}</b> &mdash; Sent: ${campaign.sent} / Failed: ${campaign.failed} / Skipped: ${campaign.skipped} / Total: ${campaign.total}`;
  $('campaignLogs').innerHTML = logs.slice().reverse().map((l) => `
    <div class="list-row"><span>${l.email}</span><span class="status-${l.status}">${l.status}${l.error ? ` (${l.error})` : ''}</span></div>
  `).join('');

  if (campaign.status === 'completed' || campaign.status === 'stopped') {
    clearInterval(pollTimer);
    $('startCampaign').disabled = false;
    $('stopCampaign').disabled = true;
  }
}

// ---------- Dashboard ----------
let dashData = null;
let activeDashList = 'pending';

const STATUS_ICON = { good: '✅', warn: '⚠️', bad: '❌', neutral: 'ℹ️' };

function renderMeter(health) {
  $('healthMeterBox').innerHTML = `
    <div class="meter-wrap">
      <div class="meter-score-row">
        <div class="meter-score">${health.riskPercent}%<span style="font-size:16px;color:#9ca3af"> spam risk</span></div>
        <div class="meter-rating ${health.ratingColor}">${health.rating}</div>
      </div>
      <div class="meter-bar-track"><div class="meter-bar-fill ${health.ratingColor}" style="width:${health.riskPercent}%"></div></div>
      <p class="hint" style="margin-top:-8px;margin-bottom:14px">Safety score: ${health.score}/100 &mdash; jitna kam risk %, utna better.</p>
      <div class="meter-checks">
        ${health.checks.map((c) => `
          <div class="meter-check">
            <span class="icon">${STATUS_ICON[c.status]}</span>
            <span class="txt"><b>${c.label}${c.weight ? ` <span class="risk-badge ${c.status}">+${c.riskPercent}% risk</span>` : ''}</b><span>${c.message}</span></span>
          </div>
        `).join('')}
      </div>
    </div>`;
}

function renderDashList() {
  const items = (dashData?.lists?.[activeDashList]) || [];
  if (!items.length) {
    $('dashListBox').innerHTML = '<div class="list-row">Yahan kuch nahi hai.</div>';
    return;
  }
  $('dashListBox').innerHTML = items.map((c) => {
    let extra = '';
    if (activeDashList === 'sent') extra = `sent ${new Date(c.lastSentAt).toLocaleString()}`;
    if (activeDashList === 'bounced') extra = c.lastBounceReason || '';
    return `<div class="list-row"><span>${c.email} ${c.name ? `(${c.name})` : ''}</span><span style="color:#6b7280;font-size:12px">${extra}</span></div>`;
  }).join('');
}

document.querySelectorAll('.dash-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.dash-tab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    activeDashList = btn.dataset.list;
    renderDashList();
  });
});

async function loadDashboard() {
  dashData = await api('/api/dashboard');
  const c = dashData.counts;
  $('cardTotal').textContent = c.total;
  $('cardPending').textContent = c.pending;
  $('cardSent').textContent = c.sent;
  $('cardBounced').textContent = c.bounced;
  $('cardInvalid').textContent = c.invalid;
  $('cardSuppressed').textContent = c.suppressed;
  renderMeter(dashData.health);
  renderDashList();
}

setInterval(() => {
  if (document.getElementById('tab-dashboard').classList.contains('active')) loadDashboard();
}, 5000);

loadSettings();
loadTemplates();
loadContacts();
loadHealth();
loadDashboard();
