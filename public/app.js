const $ = (id) => document.getElementById(id);

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toast(message, type = 'ok') {
  const stack = $('toastStack');
  if (!stack) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function setLive(text, mode) {
  const pill = $('livePill');
  const label = $('livePillText');
  if (label) label.textContent = text;
  if (pill) pill.className = `live-pill ${mode || ''}`;
}

function showOverlay(title, detail, steps) {
  $('processTitle').textContent = title;
  $('processDetail').textContent = detail;
  $('processSteps').innerHTML = (steps || []).map((s, i) => `<li data-i="${i}">${esc(s)}</li>`).join('');
  $('processOverlay').hidden = false;
}

function overlayStep(index) {
  $('processSteps').querySelectorAll('li').forEach((li, i) => {
    li.className = i < index ? 'done' : i === index ? 'on' : '';
  });
}

function hideOverlay() {
  $('processOverlay').hidden = true;
}

function animateNumber(el, next) {
  if (!el) return;
  const target = Number(next) || 0;
  const current = Number(el.dataset.value || el.textContent) || 0;
  if (current === target) {
    el.textContent = String(target);
    el.dataset.value = String(target);
    return;
  }
  const start = performance.now();
  const duration = 500;
  const from = current;
  const tick = (now) => {
    const p = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = String(Math.round(from + (target - from) * eased));
    if (p < 1) requestAnimationFrame(tick);
    else {
      el.textContent = String(target);
      el.dataset.value = String(target);
    }
  };
  requestAnimationFrame(tick);
}

function setMsg(id, text, isError) {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.className = isError ? 'msg error' : 'msg';
}

function openTab(name) {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
  document.querySelectorAll('.journey-step').forEach((s) => s.classList.toggle('active', s.dataset.goto === name));
  if (name === 'dashboard') { loadDashboard(); refreshJourney(); }
  if (name === 'campaign') { loadCampaignList(); loadCampaignTags(); updateCampaignReady(); }
  if (name === 'sms') { loadSmsDashboard(); loadSmsContacts(); loadSmsTemplates(); }
  if (name === 'contacts') { loadContacts(); loadHealth(); }
  if (name === 'templates') { loadTemplates(); refreshPreview(); }
}

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => openTab(btn.dataset.tab));
});

document.querySelectorAll('.journey-step').forEach((btn) => {
  btn.addEventListener('click', () => openTab(btn.dataset.goto));
});

document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-goto]');
  if (go && !go.classList.contains('journey-step') && !go.classList.contains('tab')) {
    e.preventDefault();
    openTab(go.dataset.goto);
  }
});

async function api(path, opts) {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...opts
  });
  const raw = await res.text();
  let data = {};
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(res.ok ? 'Unexpected server response' : `Request failed (${res.status})`);
    }
  }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function updateJourneyDone({ hasSmtp, hasTemplate, hasContacts }) {
  document.querySelectorAll('.journey-step').forEach((step) => {
    const n = step.dataset.step;
    const done = (n === '1' && hasSmtp) || (n === '2' && hasTemplate) || (n === '3' && hasContacts) || (n === '4' && hasTemplate && hasContacts && hasSmtp);
    step.classList.toggle('done', !!done);
  });
}

function renderNextAction({ hasSmtp, hasTemplate, hasContacts }) {
  const box = $('nextActionBox');
  if (!box) return;
  let title = 'Ready to send';
  let text = 'Mail is connected, a template is saved, and people are on the list.';
  let tab = 'campaign';
  let btn = 'Open Send';
  if (!hasSmtp) {
    title = 'First: connect the sending inbox';
    text = 'Add SMTP host, user and password. The agent cannot mail anyone until this works.';
    tab = 'settings';
    btn = 'Open Connect';
  } else if (!hasTemplate) {
    title = 'Next: write the email';
    text = 'Save one template with a calm subject and {{name}} so each mail feels personal.';
    tab = 'templates';
    btn = 'Open Write';
  } else if (!hasContacts) {
    title = 'Next: add people';
    text = 'Paste any list. The agent extracts emails and skips unsubscribes.';
    tab = 'contacts';
    btn = 'Open Contacts';
  }
  box.className = 'next-action';
  box.innerHTML = `<div class="copy"><strong>${esc(title)}</strong><p>${esc(text)}</p></div><button type="button" class="btn-primary" data-goto="${tab}">${esc(btn)}</button>`;
}

let apiKeys = [];

function setStatusDot(dotEl, textEl, status) {
  const ok = status?.ok;
  dotEl.className = `status-dot ${ok === true ? 'good' : ok === false ? 'bad' : 'neutral'}`;
  textEl.textContent = status?.message || 'Not tested yet';
}

function renderApiKeyList() {
  $('apiKeyList').innerHTML = apiKeys.map((k, i) => `
    <div class="api-key-row" data-index="${i}">
      <input class="key-name" placeholder="Key name (e.g. Anthropic)" value="${esc(k.name || '')}" />
      <input class="key-value" type="password" placeholder="key..." value="${esc(k.key || '')}" />
      <span class="status-dot ${k.status?.ok === true ? 'good' : k.status?.ok === false ? 'bad' : 'neutral'}" title="${esc(k.status?.message || 'Not tested yet')}"></span>
      <button class="test-key btn-ghost" type="button">Test</button>
      <button class="remove-key" type="button">Remove</button>
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
        toast(result.message, result.ok ? 'ok' : 'error');
      } catch (e) {
        dot.className = 'status-dot bad';
        dot.title = e.message;
        toast(e.message, 'error');
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
  return s;
}

async function loadBudgetSpentInfo() {
  try {
    const u = await api('/api/usage/summary');
    $('budgetSpentInfo').textContent = `Spent so far: $${u.spentUsd} of $${u.maxUsd} (${u.percentUsed}%) — ${u.callCount} API call(s).`;
  } catch {
    // ignore
  }
}

$('testSmtpBtn').addEventListener('click', async () => {
  setMsg('smtpTestMsg', 'Testing connection…');
  setLive('Testing mail…', 'busy');
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
    setMsg('smtpTestMsg', result.ok ? 'Connection successful.' : result.message, !result.ok);
    toast(result.ok ? 'Mail connection works' : result.message, result.ok ? 'ok' : 'error');
    setLive(result.ok ? 'Mail connected' : 'Mail failed', result.ok ? 'good' : '');
  } catch (e) {
    setMsg('smtpTestMsg', e.message, true);
    toast(e.message, 'error');
    setLive('Ready');
  }
});

$('testSmsBtn').addEventListener('click', async () => {
  setMsg('smsTestMsg', 'Testing SMS…');
  setLive('Testing SMS…', 'busy');
  try {
    const sms = { accountSid: $('smsSid').value, authToken: $('smsToken').value, fromNumber: $('smsFrom').value };
    const result = await api('/api/settings/test-sms', { method: 'POST', body: JSON.stringify({ sms }) });
    setStatusDot($('smsStatusDot'), $('smsStatusText'), result);
    setMsg('smsTestMsg', result.ok ? 'SMS connection successful.' : result.message, !result.ok);
    toast(result.ok ? 'SMS connection works' : result.message, result.ok ? 'ok' : 'error');
    setLive(result.ok ? 'SMS connected' : 'SMS failed', result.ok ? 'good' : '');
  } catch (e) {
    setMsg('smsTestMsg', e.message, true);
    toast(e.message, 'error');
    setLive('Ready');
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
    setMsg('settingsMsg', 'Settings saved.');
    toast('Settings saved');
    loadBudgetSpentInfo();
    refreshJourney();
  } catch (e) {
    setMsg('settingsMsg', e.message, true);
    toast(e.message, 'error');
  }
});

function refreshPreview() {
  const frame = $('tplPreview');
  if (!frame) return;
  const name = 'Amit';
  const email = 'amit@example.com';
  const subject = ($('tplSubject').value || 'Subject').replace(/\{\{\s*name\s*\}\}/gi, name).replace(/\{\{\s*email\s*\}\}/gi, email);
  let html = ($('tplHtml').value || '<p style="color:#8a7763">Start typing the email on the left…</p>')
    .replace(/\{\{\s*name\s*\}\}/gi, name)
    .replace(/\{\{\s*email\s*\}\}/gi, email);
  const ctaText = $('tplCtaText').value;
  const ctaUrl = $('tplCtaUrl').value;
  if (ctaText && ctaUrl) {
    html += `<div style="text-align:center;margin:28px 0"><a href="${esc(ctaUrl)}" style="background:#c45c26;color:#fff8ee;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:600;display:inline-block">${esc(ctaText)}</a></div>`;
  }
  const image = resolveImageUrl($('tplImage').value.trim());
  const imgBlock = image ? `<img src="${esc(image)}" alt="" style="max-width:100%;border-radius:8px;margin:12px 0" />` : '';
  const doc = `<!doctype html><html><body style="font-family:Georgia,serif;padding:18px;color:#2b2118;background:#fffaf2;margin:0">
    ${imgBlock}${html}
  </body></html>`;
  const meta = $('tplPreviewMeta');
  if (meta) meta.textContent = `Subject: ${subject}`;
  frame.srcdoc = doc;
  try {
    const inner = frame.contentDocument;
    if (inner) {
      inner.open();
      inner.write(doc);
      inner.close();
    }
  } catch {
    // srcdoc is enough when the iframe document is not writable
  }
}

['tplName', 'tplSubject', 'tplHtml', 'tplImage', 'tplCtaText', 'tplCtaUrl'].forEach((id) => {
  const el = $(id);
  if (el) el.addEventListener('input', refreshPreview);
});

// ---------- Template image: attach file, drag & drop, paste ----------
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function resolveImageUrl(url) {
  const val = String(url || '').trim();
  if (!val) return '';
  if (/^https?:\/\//i.test(val) || /^data:image\//i.test(val)) return val;
  if (/^\/uploads\//i.test(val)) return `${window.location.origin}${val}`;
  return val;
}

function showImagePreview(url) {
  const wrap = $('imagePreviewWrap');
  const img = $('imagePreviewImg');
  if (!wrap || !img) return;
  const resolved = resolveImageUrl(url);
  if (resolved) {
    img.src = resolved;
    wrap.hidden = false;
  } else {
    img.src = '';
    wrap.hidden = true;
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

async function handleImageFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    toast('Please choose an image file (PNG, JPG, GIF or WEBP)', 'error');
    return;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    toast('Image is too large — max 8MB', 'error');
    return;
  }
  try {
    setLive('Uploading image…', 'busy');
    const dataUrl = await fileToDataUrl(file);
    const result = await api('/api/uploads/image', { method: 'POST', body: JSON.stringify({ dataUrl }) });
    $('tplImage').value = result.url;
    showImagePreview(result.url);
    refreshPreview();
    toast('Image attached');
    setLive('Ready', 'good');
  } catch (e) {
    toast(e.message, 'error');
    setLive('Ready');
  }
}

$('attachImageBtn')?.addEventListener('click', () => $('tplImageFile').click());
$('tplImageFile')?.addEventListener('change', (e) => {
  handleImageFile(e.target.files[0]);
  e.target.value = '';
});
$('removeImageBtn')?.addEventListener('click', () => {
  $('tplImage').value = '';
  showImagePreview(null);
  refreshPreview();
});
$('tplImage')?.addEventListener('input', (e) => {
  const val = e.target.value.trim();
  showImagePreview(/^https?:\/\//i.test(val) || /^\/uploads\//i.test(val) ? val : null);
});

const imageDropZone = $('imageDropZone');
if (imageDropZone) {
  ['dragover', 'dragenter'].forEach((evt) => imageDropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    imageDropZone.classList.add('drag-over');
  }));
  ['dragleave', 'drop'].forEach((evt) => imageDropZone.addEventListener(evt, () => {
    imageDropZone.classList.remove('drag-over');
  }));
  imageDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) handleImageFile(file);
  });
}

// Paste an image anywhere while the Write tab is open (Ctrl/Cmd+V) — a plain text/URL
// paste is left alone so it still works normally in every input.
document.addEventListener('paste', (e) => {
  if (!document.getElementById('tab-templates')?.classList.contains('active')) return;
  const item = [...(e.clipboardData?.items || [])].find((it) => it.type.startsWith('image/'));
  if (item) {
    e.preventDefault();
    handleImageFile(item.getAsFile());
  }
});

async function loadTemplates() {
  const templates = await api('/api/templates');
  $('templateList').innerHTML = templates.map((t) => `
    <div class="template-card" data-id="${esc(t.id)}">
      <div class="row1">
        <span><strong>${esc(t.name)}</strong> — <em>${esc(t.subject)}</em></span>
        <button data-id="${esc(t.id)}" class="deleteTemplate btn-ghost" type="button">Delete</button>
      </div>
      <div class="stats" id="stats-${esc(t.id)}">Loading stats…</div>
    </div>`).join('') || '<div class="list-row">No templates yet. Write one above and save it.</div>';

  const options = templates.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
  $('campaignTemplate').innerHTML = options;
  if ($('personalTemplate')) $('personalTemplate').innerHTML = options;

  document.querySelectorAll('.deleteTemplate').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await api(`/api/templates/${btn.dataset.id}`, { method: 'DELETE' });
      toast('Template deleted');
      loadTemplates();
      refreshJourney();
    });
  });

  templates.forEach(async (t) => {
    try {
      const stats = await api(`/api/templates/${t.id}/stats`);
      const el = document.getElementById(`stats-${t.id}`);
      if (el) el.textContent = `Sent ${stats.sent} · Clicked by ${stats.uniqueClickers} (${stats.ctr}% CTR) · Leads ${stats.leadsCount || 0}`;
    } catch {
      // ignore stat load failure for one template
    }
  });
  return templates;
}

$('checkWordsBtn').addEventListener('click', async () => {
  try {
    showOverlay('Checking wording', 'Scanning subject, body and button text', ['Read the email', 'Find risky phrases', 'Suggest safer wording']);
    overlayStep(0);
    const result = await api('/api/templates/check-words', {
      method: 'POST',
      body: JSON.stringify({ subject: $('tplSubject').value, html: `${$('tplHtml').value} ${$('tplCtaText').value}` })
    });
    overlayStep(2);
    hideOverlay();
    if (!result.matches.length) {
      $('spamWordsResult').innerHTML = '<p class="msg">No risky spam words found.</p>';
      toast('Wording looks clean');
      return;
    }
    $('spamWordsResult').innerHTML = `
      <div class="word-suggestions">
        ${result.matches.map((m) => `
          <div class="word-row">
            <span class="word-bad">"${esc(m.phrase)}"</span>
            <span class="word-arrow">→</span>
            <span class="word-good">${m.alternatives.map((a) => `"${esc(a)}"`).join(' or ')}</span>
          </div>
        `).join('')}
      </div>`;
    toast(`${result.matches.length} phrase(s) to soften`, 'error');
  } catch (e) {
    hideOverlay();
    $('spamWordsResult').innerHTML = `<p class="msg error">${esc(e.message)}</p>`;
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
    setMsg('templateMsg', 'Template saved.');
    toast('Template saved');
    $('tplName').value = '';
    $('tplSubject').value = '';
    $('tplHtml').value = '';
    $('tplImage').value = '';
    showImagePreview(null);
    $('tplCtaText').value = 'Check Your Eligibility';
    $('tplCtaUrl').value = 'https://neercred.com/apply';
    $('spamWordsResult').innerHTML = '';
    refreshPreview();
    loadTemplates();
    refreshJourney();
  } catch (e) {
    setMsg('templateMsg', e.message, true);
    toast(e.message, 'error');
  }
});

let contactCache = [];

function filteredContacts() {
  const q = ($('contactSearch')?.value || '').trim().toLowerCase();
  if (!q) return contactCache;
  return contactCache.filter((c) => {
    const hay = `${c.email} ${c.name || ''} ${(c.tags || []).join(' ')} ${c.status}`.toLowerCase();
    return hay.includes(q);
  });
}

function renderContactRows() {
  const contacts = filteredContacts();
  $('contactCount').textContent = contactCache.length;
  $('contactList').innerHTML = contacts.map((c) => `
    <div class="list-row">
      <span class="detected-row">
        <input type="checkbox" class="pick-contact" data-id="${esc(c.id)}" ${c.status === 'active' ? '' : 'disabled'} />
        <span>${esc(c.email)} ${c.name ? `(${esc(c.name)})` : ''} — <span class="status-${esc(c.status)}">${esc(c.status)}</span>
          <span class="tag-editor" data-id="${esc(c.id)}" title="Click to edit tags">${(c.tags || []).length ? esc((c.tags || []).join(', ')) : 'add tags'}</span>
        </span>
      </span>
      <span class="row-actions">
        <button data-id="${esc(c.id)}" class="sendOneContact btn-ghost" type="button" ${c.status === 'active' ? '' : 'disabled'}>Email this person</button>
        <button data-id="${esc(c.id)}" class="deleteContact btn-ghost" type="button">Remove</button>
      </span>
    </div>`).join('') || `<div class="list-row">${contactCache.length ? 'No match in the list.' : 'No contacts yet. Paste bulk data above and extract.'}</div>`;

  document.querySelectorAll('.deleteContact').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await api(`/api/contacts/${btn.dataset.id}`, { method: 'DELETE' });
      loadContacts();
      refreshJourney();
    });
  });

  document.querySelectorAll('.sendOneContact').forEach((btn) => {
    btn.addEventListener('click', () => startPersonalSend([btn.dataset.id]));
  });

  document.querySelectorAll('.tag-editor').forEach((el) => {
    el.addEventListener('click', async () => {
      const current = contactCache.find((c) => c.id === el.dataset.id)?.tags || [];
      const input = window.prompt('Tags (comma-separated):', current.join(', '));
      if (input === null) return;
      const tags = input.split(',').map((t) => t.trim()).filter(Boolean);
      await api(`/api/contacts/${el.dataset.id}/tags`, { method: 'PATCH', body: JSON.stringify({ tags }) });
      loadContacts();
      loadCampaignTags();
    });
  });
}

async function loadContacts() {
  contactCache = await api('/api/contacts');
  renderContactRows();
  return contactCache;
}

if ($('contactSearch')) {
  $('contactSearch').addEventListener('input', renderContactRows);
}

async function loadCampaignTags() {
  const tags = await api('/api/contacts/tags');
  const select = $('campaignTag');
  const current = select.value;
  select.innerHTML = '<option value="">All contacts</option>' + tags.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  if (tags.includes(current)) select.value = current;
  updateCampaignReady();
}

async function updateCampaignReady() {
  const el = $('campaignReadyCount');
  if (!el) return;
  try {
    const contacts = contactCache.length ? contactCache : await api('/api/contacts');
    const tag = $('campaignTag')?.value || '';
    const templateId = $('campaignTemplate')?.value || '';
    const ready = contacts.filter((c) => c.status === 'active' && (!tag || (c.tags || []).includes(tag)));
    if (!templateId) {
      el.textContent = `${ready.length} active people on the list — save/select a template to send.`;
      return;
    }
    el.textContent = tag
      ? `${ready.length} people with tag “${tag}” will get this email.`
      : `${ready.length} active people will get this email.`;
  } catch {
    el.textContent = 'Could not count recipients right now.';
  }
}

['campaignTemplate', 'campaignTag'].forEach((id) => {
  const el = $(id);
  if (el) el.addEventListener('change', updateCampaignReady);
});

function fileToText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsText(file);
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

let detectedCache = [];

function renderDetectedList(items, meta) {
  detectedCache = items || [];
  const box = $('detectedBox');
  if (!box) return;
  if (!detectedCache.length) {
    box.hidden = true;
    $('detectedList').innerHTML = '';
    return;
  }
  box.hidden = false;
  if ($('detectedMeta')) {
    $('detectedMeta').textContent = meta || `${detectedCache.length} found`;
  }
  $('detectedList').innerHTML = detectedCache.map((c, i) => `
    <label class="list-row detected-row">
      <span class="detected-num">${i + 1}.</span>
      <input type="checkbox" class="pick-detected" data-email="${esc(c.email)}" checked />
      <span><strong>${esc(c.email)}</strong> ${c.name ? `(${esc(c.name)})` : ''} <span class="soft-note">${esc(c.source || '')}</span></span>
    </label>
  `).join('');
}

async function handleContactsFile(file) {
  if (!file) return;
  const name = file.name || 'upload';
  const ok = /\.(xlsx|xlsm|xls|csv|txt)$/i.test(name) || file.type.startsWith('text/') || /spreadsheet|excel/i.test(file.type);
  if (!ok) {
    toast('Please attach Excel (.xlsx/.xls), CSV or TXT', 'error');
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    toast('File is too large — max 8MB', 'error');
    return;
  }
  try {
    setLive('Reading file…', 'busy');
    showOverlay('Reading your file', 'Finding every email address, row by row', ['Open the file', 'Scan every sheet / line', 'Show detected people']);
    overlayStep(0);
    const base64 = await fileToBase64(file);
    overlayStep(1);
    const result = await api('/api/contacts/preview-file', {
      method: 'POST',
      body: JSON.stringify({ filename: name, base64 })
    });
    overlayStep(2);
    hideOverlay();
    const sheets = (result.sheetNames || []).length ? ` · sheets: ${result.sheetNames.join(', ')}` : '';
    setMsg('contactsFileMsg', `Read ${result.filename} — ${result.rowCount} row(s), ${result.totalDetected} email(s) found${sheets}.`);
    renderDetectedList(result.detected, `${result.totalDetected} email(s)`);
    if (/\.(csv|txt)$/i.test(name)) {
      const text = await fileToText(file);
      const box = $('rawData');
      box.value = box.value ? `${box.value}\n${text}` : text;
    }
    toast(result.totalDetected ? `Found ${result.totalDetected} email(s)` : 'No emails in that file', result.totalDetected ? 'ok' : 'error');
    setLive(result.totalDetected ? 'Emails found' : 'Ready', result.totalDetected ? 'good' : '');
  } catch (e) {
    hideOverlay();
    toast(e.message, 'error');
    setLive('Ready');
  }
}

$('attachContactsFileBtn')?.addEventListener('click', () => $('rawDataFile').click());
$('rawDataFile')?.addEventListener('change', (e) => {
  handleContactsFile(e.target.files[0]);
  e.target.value = '';
});

function selectedDetectedContacts() {
  return [...document.querySelectorAll('.pick-detected:checked')].map((el) => {
    const email = el.dataset.email;
    const row = detectedCache.find((c) => c.email === email);
    return { email, name: row?.name || '' };
  });
}

async function importSelectedContacts() {
  const selected = selectedDetectedContacts();
  if (!selected.length) {
    toast('Tick at least one email', 'error');
    return null;
  }
  showOverlay('Adding people', 'Saving selected emails to your list', ['Check the list', 'Skip duplicates', 'Save contacts']);
  overlayStep(1);
  const result = await api('/api/contacts/import', { method: 'POST', body: JSON.stringify({ contacts: selected }) });
  hideOverlay();
  setMsg('extractMsg', `Added ${result.addedCount} new contact(s) of ${result.totalExtracted} selected.`);
  toast(`Added ${result.addedCount} contact(s)`);
  await loadContacts();
  loadHealth();
  refreshJourney();
  const emails = new Set(selected.map((c) => c.email));
  const ids = contactCache.filter((c) => emails.has(c.email) && c.status === 'active').map((c) => c.id);
  return { result, ids };
}

$('importDetectedBtn')?.addEventListener('click', async () => {
  try {
    await importSelectedContacts();
  } catch (e) {
    hideOverlay();
    toast(e.message, 'error');
  }
});

$('importAndSendBtn')?.addEventListener('click', async () => {
  try {
    const imported = await importSelectedContacts();
    if (!imported?.ids?.length) {
      if (imported) toast('Those people are already on the list but not active', 'error');
      return;
    }
    startPersonalSend(imported.ids);
  } catch (e) {
    hideOverlay();
    toast(e.message, 'error');
  }
});

$('clearDetectedBtn')?.addEventListener('click', () => {
  renderDetectedList([]);
  setMsg('contactsFileMsg', '');
});

async function startPersonalSend(contactIds) {
  const templateId = $('personalTemplate')?.value || $('campaignTemplate')?.value;
  if (!templateId) {
    toast('Save a template first', 'error');
    return;
  }
  if (!contactIds.length) {
    toast('Pick at least one person', 'error');
    return;
  }
  try {
    const campaign = await api('/api/campaign/start', {
      method: 'POST',
      body: JSON.stringify({ templateId, contactIds })
    });
    currentCampaignId = campaign.id;
    $('startCampaign').disabled = true;
    $('stopCampaign').disabled = false;
    setVisualizer('running', 'Sending personally', 'One by one');
    setLive('Sending emails…', 'busy');
    openTab('campaign');
    pollStatus();
    pollTimer = setInterval(pollStatus, 2500);
    toast(`Sending to ${campaign.total} person(s), one by one`);
  } catch (e) {
    toast(e.message, 'error');
  }
}

$('sendSelectedBtn')?.addEventListener('click', () => {
  const ids = [...document.querySelectorAll('.pick-contact:checked')].map((el) => el.dataset.id);
  startPersonalSend(ids);
});

$('selectAllContactsBtn')?.addEventListener('click', () => {
  document.querySelectorAll('.pick-contact:not(:disabled)').forEach((el) => { el.checked = true; });
});

const rawDataBox = $('rawData');
if (rawDataBox) {
  ['dragover', 'dragenter'].forEach((evt) => rawDataBox.addEventListener(evt, (e) => {
    e.preventDefault();
    rawDataBox.classList.add('drag-over');
  }));
  ['dragleave', 'drop'].forEach((evt) => rawDataBox.addEventListener(evt, () => {
    rawDataBox.classList.remove('drag-over');
  }));
  rawDataBox.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) handleContactsFile(file);
  });
}

$('extractBtn').addEventListener('click', async () => {
  const rawText = $('rawData').value.trim();
  if (!rawText) {
    toast('Paste some text first', 'error');
    return;
  }
  setMsg('extractMsg', 'Extracting emails…');
  setLive('Extracting…', 'busy');
  const mini = $('extractProcess');
  mini.hidden = false;
  mini.innerHTML = '<span>Reading text</span><span>Finding emails</span><span>Saving new people</span>';
  showOverlay('Extracting emails', 'Reading the pasted text and adding new contacts', ['Read pasted text', 'Find email addresses', 'Skip duplicates & unsubscribes']);
  overlayStep(1);
  try {
    const result = await api('/api/contacts/extract', { method: 'POST', body: JSON.stringify({ rawText }) });
    overlayStep(2);
    hideOverlay();
    setMsg('extractMsg', `Found ${result.totalExtracted} email(s), added ${result.addedCount} new contact(s).`);
    toast(`Added ${result.addedCount} contact(s)`);
    $('rawData').value = '';
    mini.hidden = true;
    mini.innerHTML = '';
    loadContacts();
    loadHealth();
    refreshJourney();
    setLive('Contacts updated', 'good');
  } catch (e) {
    hideOverlay();
    mini.hidden = true;
    setMsg('extractMsg', e.message, true);
    toast(e.message, 'error');
    setLive('Ready');
  }
});

async function loadHealth() {
  const h = await api('/api/contacts/health');
  const cards = [
    ['active', 'Active (sendable)'],
    ['invalid', 'Invalid'],
    ['bounced', 'Bounced'],
    ['suppressed', 'Suppressed']
  ];
  $('healthSummary').innerHTML = cards.map(([key, label]) => `
    <div class="health-card"><span class="num">${h[key]}</span><span class="label">${esc(label)}</span></div>
  `).join('');
}

$('healthCheckBtn').addEventListener('click', async () => {
  setMsg('healthMsg', 'Checking the list…');
  setLive('Health check…', 'busy');
  showOverlay('List health check', 'Validating format, disposable domains and duplicates', ['Scan addresses', 'Flag invalid / disposable', 'Update statuses']);
  overlayStep(0);
  try {
    const result = await api('/api/contacts/health-check', { method: 'POST' });
    overlayStep(2);
    hideOverlay();
    setMsg('healthMsg', `Checked ${result.checked} contact(s): ${result.invalidCount} invalid, ${result.duplicateCount} duplicate(s) flagged.`);
    toast('Health check finished');
    loadContacts();
    loadHealth();
    setLive('List checked', 'good');
  } catch (e) {
    hideOverlay();
    setMsg('healthMsg', e.message, true);
    toast(e.message, 'error');
    setLive('Ready');
  }
});

let currentCampaignId = null;
let pollTimer = null;

function setVisualizer(state, title, kicker) {
  const box = $('campaignVisualizer');
  box.className = `visualizer ${state}`;
  $('vizTitle').textContent = title;
  $('vizKicker').textContent = kicker;
}

function renderViz(campaign, logs) {
  const done = (campaign.sent || 0) + (campaign.failed || 0) + (campaign.skipped || 0);
  const pct = campaign.total ? Math.round((done / campaign.total) * 100) : 0;
  $('vizBarFill').style.width = `${pct}%`;
  $('vizCounts').innerHTML = `
    <span>Sent <b>${campaign.sent}</b></span>
    <span>Failed <b>${campaign.failed}</b></span>
    <span>Skipped <b>${campaign.skipped}</b></span>
    <span>Total <b>${campaign.total}</b></span>
  `;
  const recent = logs.slice(-6).reverse();
  $('vizLane').innerHTML = recent.map((l) => (
    `<span class="chip ${esc(l.status)}">${esc(l.email)} · ${esc(l.status)}</span>`
  )).join('');
}

$('scheduleToggle').addEventListener('change', (e) => {
  $('scheduleTimeRow').hidden = !e.target.checked;
});

$('startCampaign').addEventListener('click', async () => {
  try {
    const templateId = $('campaignTemplate').value;
    if (!templateId) {
      toast('Save a template first', 'error');
      return;
    }
    const body = { templateId, tag: $('campaignTag').value || undefined };
    if ($('scheduleToggle').checked) {
      if (!$('scheduleTime').value) {
        toast('Choose a schedule time', 'error');
        return;
      }
      body.scheduledAt = new Date($('scheduleTime').value).toISOString();
    }
    const campaign = await api('/api/campaign/start', { method: 'POST', body: JSON.stringify(body) });
    if (campaign.status === 'scheduled') {
      setMsg('campaignStatus', `Scheduled for ${new Date(campaign.scheduledAt).toLocaleString()} — ${campaign.total} contact(s).`);
      setVisualizer('idle', 'Scheduled', 'Waiting for send time');
      toast('Campaign scheduled');
      loadCampaignList();
      return;
    }
    currentCampaignId = campaign.id;
    $('startCampaign').disabled = true;
    $('stopCampaign').disabled = false;
    setVisualizer('running', 'Sending now', 'Live');
    setLive('Sending emails…', 'busy');
    pollStatus();
    pollTimer = setInterval(pollStatus, 2500);
  } catch (e) {
    setMsg('campaignStatus', e.message, true);
    toast(e.message, 'error');
  }
});

$('stopCampaign').addEventListener('click', async () => {
  if (!currentCampaignId) return;
  await api(`/api/campaign/${currentCampaignId}/stop`, { method: 'POST' });
  toast('Stop requested');
});

async function pollStatus() {
  if (!currentCampaignId) return;
  try {
    const { campaign, logs } = await api(`/api/campaign/${currentCampaignId}/status`);
    setMsg('campaignStatus', `Status: ${campaign.status} — sent ${campaign.sent} / failed ${campaign.failed} / skipped ${campaign.skipped} / total ${campaign.total}`);
    renderViz(campaign, logs);
    $('campaignLogs').innerHTML = logs.slice().reverse().map((l) => `
      <div class="list-row"><span>${esc(l.email)}</span><span class="status-${esc(l.status)}">${esc(l.status)}${l.error ? ` (${esc(l.error)})` : ''}</span></div>
    `).join('');

    if (campaign.status === 'completed' || campaign.status === 'stopped') {
      clearInterval(pollTimer);
      $('startCampaign').disabled = false;
      $('stopCampaign').disabled = true;
      setVisualizer('done', campaign.status === 'completed' ? 'Finished' : 'Stopped', campaign.status);
      setLive(campaign.status === 'completed' ? 'Campaign finished' : 'Campaign stopped', 'good');
      toast(campaign.status === 'completed' ? 'Campaign finished' : 'Campaign stopped');
      loadCampaignList();
    }
  } catch (e) {
    setMsg('campaignStatus', e.message, true);
  }
}

async function loadCampaignList() {
  const campaigns = await api('/api/campaigns');
  $('campaignList').innerHTML = campaigns.slice(0, 20).map((c) => `
    <div class="list-row">
      <span>${c.status === 'scheduled' ? `Scheduled for ${esc(new Date(c.scheduledAt).toLocaleString())}` : esc(new Date(c.createdAt).toLocaleString())}</span>
      <span>${esc(c.status)} — sent ${c.sent}/${c.total}</span>
    </div>`).join('') || '<div class="list-row">No campaigns yet.</div>';
}

let dashData = null;
let activeDashList = 'pending';

const STATUS_ICON = { good: 'OK', warn: '!', bad: 'X', neutral: 'i' };

function renderMeter(health) {
  $('healthMeterBox').innerHTML = `
    <div class="meter-wrap">
      <div class="meter-score-row">
        <div class="meter-score">${health.riskPercent}%<span style="font-size:16px;color:#8a7763"> spam risk</span></div>
        <div class="meter-rating ${esc(health.ratingColor)}">${esc(health.rating)}</div>
      </div>
      <div class="meter-bar-track"><div class="meter-bar-fill ${esc(health.ratingColor)}" style="width:${Number(health.riskPercent) || 0}%"></div></div>
      <p class="hint" style="margin-top:-8px;margin-bottom:14px">Safety score: ${health.score}/100 — lower risk is better.</p>
      <div class="meter-checks">
        ${health.checks.map((c) => `
          <div class="meter-check">
            <span class="icon">${STATUS_ICON[c.status] || ''}</span>
            <span class="txt"><b>${esc(c.label)}${c.weight ? ` <span class="risk-badge ${esc(c.status)}">+${c.riskPercent}% risk</span>` : ''}</b><span>${esc(c.message)}</span></span>
          </div>
        `).join('')}
      </div>
    </div>`;
}

function renderDashList() {
  const items = (dashData?.lists?.[activeDashList]) || [];
  if (!items.length) {
    $('dashListBox').innerHTML = '<div class="list-row">Nothing in this list yet.</div>';
    return;
  }
  $('dashListBox').innerHTML = items.map((c) => {
    let extra = '';
    if (activeDashList === 'sent') extra = c.lastSentAt ? `sent ${new Date(c.lastSentAt).toLocaleString()}` : '';
    if (activeDashList === 'bounced') extra = c.lastBounceReason || '';
    return `<div class="list-row"><span>${esc(c.email)} ${c.name ? `(${esc(c.name)})` : ''}</span><span style="color:#8a7763;font-size:12px">${esc(extra)}</span></div>`;
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

const ALERT_ICON = { critical: '!', warning: '!', info: 'i' };
let seenAlertIds = new Set();

function renderAlerts(alerts) {
  if (!alerts.length) {
    $('alertsBox').innerHTML = '';
    return;
  }
  $('alertsBox').innerHTML = alerts.map((a) => `
    <div class="alert-box ${esc(a.severity)}">
      <span class="icon">${ALERT_ICON[a.severity] || 'i'}</span>
      <div class="body">
        <b>${esc(a.title)}</b>
        <p class="msg-line">${esc(a.message)}</p>
        <p class="fix-line"><b>What to do:</b> ${esc(a.fix)}</p>
      </div>
    </div>
  `).join('');

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
        <span class="cost-amount">$${(Number(usage.spentUsd) || 0).toFixed(4)}</span>
        <span class="cost-limit">of $${usage.maxUsd} limit (${usage.percentUsed}%)</span>
      </div>
      <div class="meter-bar-track"><div class="meter-bar-fill ${color}" style="width:${Math.min(100, Number(usage.percentUsed) || 0)}%"></div></div>
    </div>`;
}

async function loadDashboard() {
  dashData = await api('/api/dashboard');
  const c = dashData.counts;
  animateNumber($('cardTotal'), c.total);
  animateNumber($('cardPending'), c.pending);
  animateNumber($('cardQueue'), c.inQueue);
  animateNumber($('cardSent'), c.sent);
  animateNumber($('cardSmsSent'), c.smsSent);
  animateNumber($('cardBounced'), c.bounced);
  animateNumber($('cardInvalid'), c.invalid);
  animateNumber($('cardSuppressed'), c.suppressed);
  renderMeter(dashData.health);
  renderDashList();
  renderAlerts(dashData.alerts || []);
  renderCostMeter(dashData.usage || { spentUsd: 0, maxUsd: 0, percentUsed: 0 });
}

setInterval(() => {
  if (document.getElementById('tab-dashboard').classList.contains('active')) loadDashboard();
}, 5000);

async function loadSmsDashboard() {
  const d = await api('/api/sms/dashboard');
  animateNumber($('smsCardTotal'), d.total);
  animateNumber($('smsCardSent'), d.sent);
  animateNumber($('smsCardFailed'), d.failed);
  animateNumber($('smsCardSuppressed'), d.suppressed);
}

async function loadSmsContacts() {
  const contacts = await api('/api/sms/contacts');
  $('smsContactList').innerHTML = contacts.map((c) => `
    <div class="list-row">
      <span>${esc(c.phone)} ${c.name ? `(${esc(c.name)})` : ''} — <span class="status-${esc(c.status)}">${esc(c.status)}</span></span>
      <button data-id="${esc(c.id)}" class="deleteSmsContact btn-ghost" type="button">Remove</button>
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
  if (!rawText) {
    toast('Paste numbers first', 'error');
    return;
  }
  setMsg('smsExtractMsg', 'Extracting numbers…');
  showOverlay('Extracting phones', 'Finding numbers in the pasted text', ['Read text', 'Normalize numbers', 'Save new contacts']);
  overlayStep(1);
  try {
    const result = await api('/api/sms/contacts/extract', { method: 'POST', body: JSON.stringify({ rawText }) });
    hideOverlay();
    setMsg('smsExtractMsg', `Found ${result.totalExtracted} number(s), added ${result.addedCount} new contact(s).`);
    toast(`Added ${result.addedCount} SMS contact(s)`);
    $('smsRawData').value = '';
    loadSmsContacts();
    loadSmsDashboard();
  } catch (e) {
    hideOverlay();
    setMsg('smsExtractMsg', e.message, true);
    toast(e.message, 'error');
  }
});

async function loadSmsTemplates() {
  const templates = await api('/api/sms/templates');
  $('smsTemplateList').innerHTML = templates.map((t) => `
    <div class="list-row">
      <span>${esc(t.name)} — <em>${esc(t.body.slice(0, 60))}${t.body.length > 60 ? '...' : ''}</em></span>
      <button data-id="${esc(t.id)}" class="deleteSmsTemplate btn-ghost" type="button">Delete</button>
    </div>`).join('') || '<div class="list-row">No SMS templates yet.</div>';

  $('smsCampaignTemplate').innerHTML = templates.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');

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
    setMsg('smsTemplateMsg', 'SMS template saved.');
    toast('SMS template saved');
    $('smsTplName').value = '';
    $('smsTplBody').value = '';
    loadSmsTemplates();
  } catch (e) {
    setMsg('smsTemplateMsg', e.message, true);
    toast(e.message, 'error');
  }
});

let currentSmsCampaignId = null;
let smsPollTimer = null;

$('smsStartCampaign').addEventListener('click', async () => {
  try {
    const templateId = $('smsCampaignTemplate').value;
    if (!templateId) {
      toast('Save an SMS template first', 'error');
      return;
    }
    const campaign = await api('/api/sms/campaign/start', { method: 'POST', body: JSON.stringify({ templateId }) });
    currentSmsCampaignId = campaign.id;
    $('smsStartCampaign').disabled = true;
    $('smsStopCampaign').disabled = false;
    $('smsVisualizer').className = 'visualizer running compact';
    $('smsVizKicker').textContent = 'Sending';
    setLive('Sending SMS…', 'busy');
    pollSmsStatus();
    smsPollTimer = setInterval(pollSmsStatus, 2500);
  } catch (e) {
    setMsg('smsCampaignStatus', e.message, true);
    toast(e.message, 'error');
  }
});

$('smsStopCampaign').addEventListener('click', async () => {
  if (!currentSmsCampaignId) return;
  await api(`/api/sms/campaign/${currentSmsCampaignId}/stop`, { method: 'POST' });
  toast('SMS stop requested');
});

async function pollSmsStatus() {
  if (!currentSmsCampaignId) return;
  try {
    const { campaign, logs } = await api(`/api/sms/campaign/${currentSmsCampaignId}/status`);
    setMsg('smsCampaignStatus', `Status: ${campaign.status} — sent ${campaign.sent} / failed ${campaign.failed} / skipped ${campaign.skipped} / total ${campaign.total}`);
    const done = (campaign.sent || 0) + (campaign.failed || 0) + (campaign.skipped || 0);
    const pct = campaign.total ? Math.round((done / campaign.total) * 100) : 0;
    $('smsVizBarFill').style.width = `${pct}%`;
    $('smsCampaignLogs').innerHTML = logs.slice().reverse().map((l) => `
      <div class="list-row"><span>${esc(l.phone)}</span><span class="status-${esc(l.status)}">${esc(l.status)}${l.error ? ` (${esc(l.error)})` : ''}</span></div>
    `).join('');

    if (campaign.status === 'completed' || campaign.status === 'stopped') {
      clearInterval(smsPollTimer);
      $('smsStartCampaign').disabled = false;
      $('smsStopCampaign').disabled = true;
      $('smsVisualizer').className = 'visualizer done compact';
      $('smsVizKicker').textContent = campaign.status;
      setLive('SMS campaign done', 'good');
      loadSmsDashboard();
    }
  } catch (e) {
    setMsg('smsCampaignStatus', e.message, true);
  }
}

async function refreshJourney() {
  try {
    const [settings, templates, contacts] = await Promise.all([
      api('/api/settings'),
      api('/api/templates'),
      api('/api/contacts')
    ]);
    const state = {
      hasSmtp: !!(settings.smtp?.host && settings.smtp?.user),
      hasTemplate: templates.length > 0,
      hasContacts: contacts.length > 0
    };
    updateJourneyDone(state);
    renderNextAction(state);
  } catch {
    // ignore
  }
}

async function boot() {
  try {
    setLive('Loading…', 'busy');
    await Promise.all([
      loadSettings(),
      loadTemplates(),
      loadContacts(),
      loadHealth(),
      loadDashboard(),
      loadCampaignTags(),
      loadCampaignList(),
      loadSmsDashboard(),
      loadSmsContacts(),
      loadSmsTemplates()
    ]);
    refreshPreview();
    await refreshJourney();
    setLive('Ready', 'good');
  } catch (e) {
    setLive('Server not ready');
    toast(e.message || 'Could not load the app', 'error');
  }
}

boot();
