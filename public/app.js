const $ = (id) => document.getElementById(id);

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    $(`tab-${btn.dataset.tab}`).classList.add('active');
    if (btn.dataset.tab === 'dashboard' && typeof loadDashboard === 'function') loadDashboard();
    if (btn.dataset.tab === 'campaign' && typeof loadCampaignList === 'function') { loadCampaignList(); loadCampaignTags(); }
    if (btn.dataset.tab === 'sms' && typeof loadSmsDashboard === 'function') { loadSmsDashboard(); loadSmsContacts(); loadSmsTemplates(); }
    if (btn.dataset.tab === 'contacts' && typeof loadContacts === 'function') { loadContacts(); loadHealth(); }
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
let apiKeys = [];

function setStatusDot(dotEl, textEl, status) {
  const ok = status?.ok;
  dotEl.className = `status-dot ${ok === true ? 'good' : ok === false ? 'bad' : 'neutral'}`;
  textEl.textContent = status?.message || 'Not tested yet';
}

function renderApiKeyList() {
  $('apiKeyList').innerHTML = apiKeys.map((k, i) => `
    <div class="api-key-row" data-index="${i}">
      <input class="key-name" placeholder="Key name (e.g. Anthropic)" value="${k.name || ''}" />
      <input class="key-value" type="password" placeholder="key..." value="${k.key || ''}" />
      <span class="status-dot ${k.status?.ok === true ? 'good' : k.status?.ok === false ? 'bad' : 'neutral'}" title="${k.status?.message || 'Not tested yet'}"></span>
      <button class="test-key" type="button">Test</button>
      <button class="remove-key" type="button">✕</button>
    </div>
  `).join('');

  document.querySelectorAll('#apiKeyList .api-key-row').forEach((row) => {
    const idx = Number(row.dataset.index);
    row.querySelector('.key-name').addEventListener('input', (e) => { apiKeys[idx].name = e.target.value; });
    row.querySelector('.key-value').addEventListener('input', (e) => { apiKeys[idx].key = e.target.value; });
    row.querySelector('.remove-key').addEventListener('click', () => {
      apiKeys.splice(idx, 1);
      renderApiKeyList();
    });
    row.querySelector('.test-key').addEventListener('click', async () => {
      const dot = row.querySelector('.status-dot');
      dot.className = 'status-dot neutral';
      try {
        const result = await api('/api/settings/test-api-key', {
          method: 'POST',
          body: JSON.stringify({ id: apiKeys[idx].id, name: apiKeys[idx].name, key: apiKeys[idx].key })
        });
        apiKeys[idx].status = result;
        dot.className = `status-dot ${result.ok === true ? 'good' : result.ok === false ? 'bad' : 'neutral'}`;
        dot.title = result.message;
      } catch (e) {
        dot.className = 'status-dot bad';
        dot.title = e.message;
      }
    });
  });
}

$('addApiKeyBtn').addEventListener('click', () => {
  apiKeys.push({ id: `key-${Date.now()}`, name: '', key: '', status: { ok: null, message: '' } });
  renderApiKeyList();
});

async function loadSettings() {
  const s = await api('/api/settings');
  $('smtpHost').value = s.smtp.host || '';
  $('smtpPort').value = s.smtp.port || '';
  $('smtpSecure').value = String(!!s.smtp.secure);
  $('smtpUser').value = s.smtp.user || '';
  $('smtpPass').value = s.smtp.pass || '';
  $('fromName').value = s.smtp.fromName || '';
  $('fromEmail').value = s.smtp.fromEmail || '';
  $('aiPersonalize').checked = !!s.aiPersonalizeEmails;
  $('delayMin').value = s.delayMinSec ?? 8;
  $('delayMax').value = s.delayMaxSec ?? 20;
  $('dailyLimit').value = s.dailyLimit ?? 300;

  setStatusDot($('smtpStatusDot'), $('smtpStatusText'), s.smtpStatus);
  apiKeys = (s.apiKeys && s.apiKeys.length) ? s.apiKeys : [{ id: 'default-anthropic', name: 'Anthropic', key: '', status: { ok: null, message: '' } }];
  renderApiKeyList();

  $('smsSid').value = s.sms?.accountSid || '';
  $('smsToken').value = s.sms?.authToken || '';
  $('smsFrom').value = s.sms?.fromNumber || '';
  $('smsDelayMin').value = s.sms?.delayMinSec ?? 5;
  $('smsDelayMax').value = s.sms?.delayMaxSec ?? 15;
  $('smsDailyLimit').value = s.sms?.dailyLimit ?? 200;
  setStatusDot($('smsStatusDot'), $('smsStatusText'), s.smsStatus);

  $('webhookUrl').value = `${window.location.origin}/api/leads/webhook`;
  $('webhookSecret').value = s.leadWebhookSecret || '';

  $('apiMaxBudget').value = s.apiBudget?.maxUsd ?? 10;
  $('apiAlertThreshold').value = s.apiBudget?.alertThresholdPct ?? 80;
  loadBudgetSpentInfo();
}

async function loadBudgetSpentInfo() {
  try {
    const u = await api('/api/usage/summary');
    $('budgetSpentInfo').textContent = `Ab tak spend: $${u.spentUsd} of $${u.maxUsd} (${u.percentUsed}%) — ${u.callCount} API call(s).`;
  } catch {
    // ignore
  }
}

$('testSmtpBtn').addEventListener('click', async () => {
  $('smtpTestMsg').textContent = 'Testing...';
  $('smtpTestMsg').className = 'msg';
  try {
    const smtp = {
      host: $('smtpHost').value,
      port: Number($('smtpPort').value) || 587,
      secure: $('smtpSecure').value === 'true',
      user: $('smtpUser').value,
      pass: $('smtpPass').value,
      fromName: $('fromName').value,
      fromEmail: $('fromEmail').value
    };
    const result = await api('/api/settings/test-smtp', { method: 'POST', body: JSON.stringify({ smtp }) });
    setStatusDot($('smtpStatusDot'), $('smtpStatusText'), result);
    $('smtpTestMsg').textContent = result.ok ? '✅ Connection successful!' : `❌ ${result.message}`;
    $('smtpTestMsg').className = result.ok ? 'msg' : 'msg error';
  } catch (e) {
    $('smtpTestMsg').textContent = e.message;
    $('smtpTestMsg').className = 'msg error';
  }
});

$('testSmsBtn').addEventListener('click', async () => {
  $('smsTestMsg').textContent = 'Testing...';
  $('smsTestMsg').className = 'msg';
  try {
    const sms = { accountSid: $('smsSid').value, authToken: $('smsToken').value, fromNumber: $('smsFrom').value };
    const result = await api('/api/settings/test-sms', { method: 'POST', body: JSON.stringify({ sms }) });
    setStatusDot($('smsStatusDot'), $('smsStatusText'), result);
    $('smsTestMsg').textContent = result.ok ? '✅ Connection successful!' : `❌ ${result.message}`;
    $('smsTestMsg').className = result.ok ? 'msg' : 'msg error';
  } catch (e) {
    $('smsTestMsg').textContent = e.message;
    $('smsTestMsg').className = 'msg error';
  }
});

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
        apiKeys,
        aiPersonalizeEmails: $('aiPersonalize').checked,
        delayMinSec: Number($('delayMin').value) || 8,
        delayMaxSec: Number($('delayMax').value) || 20,
        dailyLimit: Number($('dailyLimit').value) || 300,
        sms: {
          provider: 'twilio',
          accountSid: $('smsSid').value,
          authToken: $('smsToken').value,
          fromNumber: $('smsFrom').value,
          delayMinSec: Number($('smsDelayMin').value) || 5,
          delayMaxSec: Number($('smsDelayMax').value) || 15,
          dailyLimit: Number($('smsDailyLimit').value) || 200
        },
        apiBudget: {
          maxUsd: Number($('apiMaxBudget').value) || 0,
          alertThresholdPct: Number($('apiAlertThreshold').value) || 80
        }
      })
    });
    $('settingsMsg').textContent = 'Settings saved.';
    $('settingsMsg').className = 'msg';
    loadBudgetSpentInfo();
  } catch (e) {
    $('settingsMsg').textContent = e.message;
    $('settingsMsg').className = 'msg error';
  }
});

// ---------- Templates ----------
async function loadTemplates() {
  const templates = await api('/api/templates');
  $('templateList').innerHTML = templates.map((t) => `
    <div class="template-card" data-id="${t.id}">
      <div class="row1">
        <span>${t.name} &mdash; <em>${t.subject}</em></span>
        <button data-id="${t.id}" class="deleteTemplate">Delete</button>
      </div>
      <div class="stats" id="stats-${t.id}">Loading stats...</div>
    </div>`).join('') || '<div class="list-row">No templates yet.</div>';

  $('campaignTemplate').innerHTML = templates.map((t) => `<option value="${t.id}">${t.name}</option>`).join('');

  document.querySelectorAll('.deleteTemplate').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await api(`/api/templates/${btn.dataset.id}`, { method: 'DELETE' });
      loadTemplates();
    });
  });

  templates.forEach(async (t) => {
    try {
      const stats = await api(`/api/templates/${t.id}/stats`);
      const el = document.getElementById(`stats-${t.id}`);
      if (el) el.textContent = `📧 Sent: ${stats.sent} · 🖱️ Clicked by: ${stats.uniqueClickers} (${stats.ctr}% CTR)`;
    } catch {
      // ignore stat load failure for one template
    }
  });
}

$('checkWordsBtn').addEventListener('click', async () => {
  try {
    const result = await api('/api/templates/check-words', {
      method: 'POST',
      body: JSON.stringify({ subject: $('tplSubject').value, html: `${$('tplHtml').value} ${$('tplCtaText').value}` })
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
        imageUrl: $('tplImage').value,
        ctaText: $('tplCtaText').value,
        ctaUrl: $('tplCtaUrl').value
      })
    });
    $('templateMsg').textContent = 'Template saved.';
    $('templateMsg').className = 'msg';
    $('tplName').value = '';
    $('tplSubject').value = '';
    $('tplHtml').value = '';
    $('tplImage').value = '';
    $('tplCtaText').value = 'Check Your Eligibility';
    $('tplCtaUrl').value = 'https://neercred.com/apply';
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
      <span>${c.email} ${c.name ? `(${c.name})` : ''} &mdash; <span class="status-${c.status}">${c.status}</span>
        <span class="tag-editor" data-id="${c.id}" title="Click to edit tags">🏷️ ${(c.tags || []).join(', ') || 'add tags'}</span>
      </span>
      <button data-id="${c.id}" class="deleteContact">Remove</button>
    </div>`).join('') || '<div class="list-row">No contacts yet. Paste bulk data above and extract.</div>';

  document.querySelectorAll('.deleteContact').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await api(`/api/contacts/${btn.dataset.id}`, { method: 'DELETE' });
      loadContacts();
    });
  });

  document.querySelectorAll('.tag-editor').forEach((el) => {
    el.addEventListener('click', async () => {
      const current = contacts.find((c) => c.id === el.dataset.id)?.tags || [];
      const input = window.prompt('Tags (comma-separated):', current.join(', '));
      if (input === null) return;
      const tags = input.split(',').map((t) => t.trim()).filter(Boolean);
      await api(`/api/contacts/${el.dataset.id}/tags`, { method: 'PATCH', body: JSON.stringify({ tags }) });
      loadContacts();
      loadCampaignTags();
    });
  });
}

async function loadCampaignTags() {
  const tags = await api('/api/contacts/tags');
  const select = $('campaignTag');
  const current = select.value;
  select.innerHTML = '<option value="">All contacts</option>' + tags.map((t) => `<option value="${t}">${t}</option>`).join('');
  if (tags.includes(current)) select.value = current;
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

$('scheduleToggle').addEventListener('change', (e) => {
  $('scheduleTimeRow').hidden = !e.target.checked;
});

$('startCampaign').addEventListener('click', async () => {
  try {
    const templateId = $('campaignTemplate').value;
    if (!templateId) return alert('Save a template first.');
    const body = { templateId, tag: $('campaignTag').value || undefined };
    if ($('scheduleToggle').checked) {
      if (!$('scheduleTime').value) return alert('Schedule time choose karo.');
      body.scheduledAt = new Date($('scheduleTime').value).toISOString();
    }
    const campaign = await api('/api/campaign/start', { method: 'POST', body: JSON.stringify(body) });
    if (campaign.status === 'scheduled') {
      $('campaignStatus').innerHTML = `⏰ Scheduled for ${new Date(campaign.scheduledAt).toLocaleString()} — ${campaign.total} contact(s).`;
      loadCampaignList();
      return;
    }
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
    loadCampaignList();
  }
}

async function loadCampaignList() {
  const campaigns = await api('/api/campaigns');
  $('campaignList').innerHTML = campaigns.slice(0, 20).map((c) => `
    <div class="list-row">
      <span>${c.status === 'scheduled' ? `⏰ Scheduled for ${new Date(c.scheduledAt).toLocaleString()}` : new Date(c.createdAt).toLocaleString()}</span>
      <span>${c.status} &mdash; sent ${c.sent}/${c.total}</span>
    </div>`).join('') || '<div class="list-row">Koi campaign nahi hui abhi.</div>';
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

const ALERT_ICON = { critical: '🚨', warning: '⚠️', info: 'ℹ️' };
let seenAlertIds = new Set();

function renderAlerts(alerts) {
  if (!alerts.length) {
    $('alertsBox').innerHTML = '';
    return;
  }
  $('alertsBox').innerHTML = alerts.map((a) => `
    <div class="alert-box ${a.severity}">
      <span class="icon">${ALERT_ICON[a.severity] || 'ℹ️'}</span>
      <div class="body">
        <b>${a.title}</b>
        <p class="msg-line">${a.message}</p>
        <p class="fix-line"><b>Kya karo:</b> ${a.fix}</p>
      </div>
    </div>
  `).join('');

  // Best-effort browser notification for NEW critical alerts (only while this tab/browser
  // is open and permission is granted — this is not a phone push notification).
  if ('Notification' in window) {
    const newCritical = alerts.filter((a) => a.severity === 'critical' && !seenAlertIds.has(a.id));
    if (newCritical.length) {
      if (Notification.permission === 'default') {
        Notification.requestPermission();
      }
      if (Notification.permission === 'granted') {
        newCritical.forEach((a) => new Notification(a.title, { body: `${a.message} — ${a.fix}` }));
      }
    }
  }
  seenAlertIds = new Set(alerts.map((a) => a.id));
}

function renderCostMeter(usage) {
  const color = usage.percentUsed >= 100 ? 'bad' : usage.percentUsed >= 80 ? 'warn' : 'good';
  $('costMeterBox').innerHTML = `
    <div class="cost-meter">
      <div class="cost-row">
        <span class="cost-amount">$${usage.spentUsd.toFixed(4)}</span>
        <span class="cost-limit">of $${usage.maxUsd} limit (${usage.percentUsed}%)</span>
      </div>
      <div class="meter-bar-track"><div class="meter-bar-fill ${color}" style="width:${Math.min(100, usage.percentUsed)}%"></div></div>
    </div>`;
}

async function loadDashboard() {
  dashData = await api('/api/dashboard');
  const c = dashData.counts;
  $('cardTotal').textContent = c.total;
  $('cardPending').textContent = c.pending;
  $('cardQueue').textContent = c.inQueue;
  $('cardSent').textContent = c.sent;
  $('cardSmsSent').textContent = c.smsSent;
  $('cardBounced').textContent = c.bounced;
  $('cardInvalid').textContent = c.invalid;
  $('cardSuppressed').textContent = c.suppressed;
  renderMeter(dashData.health);
  renderDashList();
  renderAlerts(dashData.alerts || []);
  renderCostMeter(dashData.usage || { spentUsd: 0, maxUsd: 0, percentUsed: 0 });
}

setInterval(() => {
  if (document.getElementById('tab-dashboard').classList.contains('active')) loadDashboard();
}, 5000);

// ================= SMS MARKETING =================
async function loadSmsDashboard() {
  const d = await api('/api/sms/dashboard');
  $('smsCardTotal').textContent = d.total;
  $('smsCardSent').textContent = d.sent;
  $('smsCardFailed').textContent = d.failed;
  $('smsCardSuppressed').textContent = d.suppressed;
}

async function loadSmsContacts() {
  const contacts = await api('/api/sms/contacts');
  $('smsContactList').innerHTML = contacts.map((c) => `
    <div class="list-row">
      <span>${c.phone} ${c.name ? `(${c.name})` : ''} &mdash; <span class="status-${c.status}">${c.status}</span></span>
      <button data-id="${c.id}" class="deleteSmsContact">Remove</button>
    </div>`).join('') || '<div class="list-row">No SMS contacts yet.</div>';

  document.querySelectorAll('.deleteSmsContact').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await api(`/api/sms/contacts/${btn.dataset.id}`, { method: 'DELETE' });
      loadSmsContacts();
    });
  });
}

$('smsExtractBtn').addEventListener('click', async () => {
  const rawText = $('smsRawData').value.trim();
  if (!rawText) return;
  try {
    const result = await api('/api/sms/contacts/extract', { method: 'POST', body: JSON.stringify({ rawText }) });
    $('smsExtractMsg').textContent = `Found ${result.totalExtracted} number(s), added ${result.addedCount} new contact(s).`;
    $('smsRawData').value = '';
    loadSmsContacts();
    loadSmsDashboard();
  } catch (e) {
    $('smsExtractMsg').textContent = e.message;
    $('smsExtractMsg').className = 'msg error';
  }
});

async function loadSmsTemplates() {
  const templates = await api('/api/sms/templates');
  $('smsTemplateList').innerHTML = templates.map((t) => `
    <div class="list-row">
      <span>${t.name} &mdash; <em>${t.body.slice(0, 60)}${t.body.length > 60 ? '...' : ''}</em></span>
      <button data-id="${t.id}" class="deleteSmsTemplate">Delete</button>
    </div>`).join('') || '<div class="list-row">No SMS templates yet.</div>';

  $('smsCampaignTemplate').innerHTML = templates.map((t) => `<option value="${t.id}">${t.name}</option>`).join('');

  document.querySelectorAll('.deleteSmsTemplate').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await api(`/api/sms/templates/${btn.dataset.id}`, { method: 'DELETE' });
      loadSmsTemplates();
    });
  });
}

$('smsSaveTemplate').addEventListener('click', async () => {
  try {
    await api('/api/sms/templates', {
      method: 'POST',
      body: JSON.stringify({ name: $('smsTplName').value, body: $('smsTplBody').value, ctaUrl: $('smsTplCtaUrl').value })
    });
    $('smsTemplateMsg').textContent = 'SMS template saved.';
    $('smsTemplateMsg').className = 'msg';
    $('smsTplName').value = '';
    $('smsTplBody').value = '';
    loadSmsTemplates();
  } catch (e) {
    $('smsTemplateMsg').textContent = e.message;
    $('smsTemplateMsg').className = 'msg error';
  }
});

let currentSmsCampaignId = null;
let smsPollTimer = null;

$('smsStartCampaign').addEventListener('click', async () => {
  try {
    const templateId = $('smsCampaignTemplate').value;
    if (!templateId) return alert('Save an SMS template first.');
    const campaign = await api('/api/sms/campaign/start', { method: 'POST', body: JSON.stringify({ templateId }) });
    currentSmsCampaignId = campaign.id;
    $('smsStartCampaign').disabled = true;
    $('smsStopCampaign').disabled = false;
    pollSmsStatus();
    smsPollTimer = setInterval(pollSmsStatus, 3000);
  } catch (e) {
    $('smsCampaignStatus').textContent = e.message;
    $('smsCampaignStatus').className = 'msg error';
  }
});

$('smsStopCampaign').addEventListener('click', async () => {
  if (!currentSmsCampaignId) return;
  await api(`/api/sms/campaign/${currentSmsCampaignId}/stop`, { method: 'POST' });
});

async function pollSmsStatus() {
  if (!currentSmsCampaignId) return;
  const { campaign, logs } = await api(`/api/sms/campaign/${currentSmsCampaignId}/status`);
  $('smsCampaignStatus').innerHTML = `Status: <b>${campaign.status}</b> &mdash; Sent: ${campaign.sent} / Failed: ${campaign.failed} / Skipped: ${campaign.skipped} / Total: ${campaign.total}`;
  $('smsCampaignLogs').innerHTML = logs.slice().reverse().map((l) => `
    <div class="list-row"><span>${l.phone}</span><span class="status-${l.status}">${l.status}${l.error ? ` (${l.error})` : ''}</span></div>
  `).join('');

  if (campaign.status === 'completed' || campaign.status === 'stopped') {
    clearInterval(smsPollTimer);
    $('smsStartCampaign').disabled = false;
    $('smsStopCampaign').disabled = true;
    loadSmsDashboard();
  }
}

loadSettings();
loadTemplates();
loadContacts();
loadHealth();
loadDashboard();
loadCampaignTags();
loadCampaignList();
loadSmsDashboard();
loadSmsContacts();
loadSmsTemplates();
