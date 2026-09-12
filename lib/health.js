// Computes a plain-language "how likely is this to land in spam / get flagged" risk meter.
// Real spam-filter logic (Gmail/Outlook reputation, ML content scoring) is not exposed to us —
// this checks the concrete, well-known signals that filters actually look at.

const dns = require('dns').promises;

const FREE_WEBMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com',
  'live.com', 'rediffmail.com', 'aol.com', 'icloud.com', 'protonmail.com'
]);

// Each trigger phrase maps to a couple of safer ways to say the same thing.
const SPAM_TRIGGER_ALTERNATIVES = {
  'guaranteed approval': ['quick eligibility check', 'see if you pre-qualify'],
  'instant approval': ['fast eligibility check', 'quick decision in minutes'],
  '100% approved': ['high approval chance for eligible applicants', 'most eligible applicants qualify'],
  'no credit check': ['flexible eligibility criteria', 'simple eligibility requirements'],
  'act now': ['take a look when convenient', 'check your options today'],
  'click here': ['view your options', 'see the details', 'check eligibility'],
  'buy now': ['get started', 'explore your options'],
  'call now': ['reach out anytime', 'contact our team'],
  'urgent': ['time-sensitive', 'worth a quick look'],
  'congratulations': ['good news', 'an update for you'],
  'risk-free': ['no-obligation', 'transparent terms'],
  'risk free': ['no-obligation', 'transparent terms'],
  'winner': ['selected', 'eligible applicant'],
  'free money': ['no processing fee (as applicable)', 'clear, upfront costs'],
  'cash bonus': ['added benefit', 'special offer'],
  'double your': ['increase your', 'grow your'],
  'limited time': ['available this month', 'current offer'],
  'lowest rate': ['competitive rate', 'attractive interest rate'],
  'lowest interest': ['competitive interest rate', 'attractive rate options'],
  'pre-approved': ['pre-qualified', 'likely eligible based on your profile'],
  'earn money': ['grow your savings', 'benefit from this offer'],
  'work from home': ['flexible application process', 'apply online from anywhere'],
  'no cost': ['no hidden charges', 'transparent pricing'],
  'no fees': ['no hidden charges', 'transparent pricing'],
  'eliminate debt': ['manage your repayments better', 'consolidate your loans'],
  'unsecured credit': ['collateral-free loan option', 'flexible loan option'],
  '100% free': ['no hidden charges', 'transparent, no-surprise pricing'],
  'once in a lifetime': ['a good opportunity', 'worth considering'],
  'apply now': ['check your eligibility', 'start your application'],
  'get rich': ['grow your finances', 'improve your financial options'],
  'miracle': ['helpful solution', 'useful option']
};

const SPAM_TRIGGER_PHRASES = Object.keys(SPAM_TRIGGER_ALTERNATIVES);

function isGmailHost(host) {
  return /gmail\.com|googlemail\.com/i.test(host || '');
}

function getDomain(email) {
  return (email || '').split('@')[1]?.toLowerCase() || '';
}

async function checkSpf(domain) {
  try {
    const records = await dns.resolveTxt(domain);
    const flat = records.map((r) => r.join(''));
    return flat.some((r) => r.toLowerCase().startsWith('v=spf1'));
  } catch {
    return null; // couldn't verify (DNS blocked/no record/timeout)
  }
}

async function checkDmarc(domain) {
  try {
    const records = await dns.resolveTxt(`_dmarc.${domain}`);
    const flat = records.map((r) => r.join(''));
    return flat.some((r) => r.toLowerCase().startsWith('v=dmarc1'));
  } catch {
    return null;
  }
}

function findSpamWordsInText(text) {
  const lower = (text || '').toLowerCase();
  return SPAM_TRIGGER_PHRASES
    .filter((phrase) => lower.includes(phrase))
    .map((phrase) => ({ phrase, alternatives: SPAM_TRIGGER_ALTERNATIVES[phrase] }));
}

function scanSpamWords(templates) {
  const hits = new Map();
  templates.forEach((t) => {
    findSpamWordsInText(`${t.subject || ''} ${t.html || ''}`).forEach((h) => hits.set(h.phrase, h));
  });
  return [...hits.values()];
}

function usesPersonalization(templates) {
  if (!templates.length) return null;
  return templates.some((t) => /\{\{\s*name\s*\}\}/i.test(`${t.subject} ${t.html}`));
}

// severity: 0 = no risk, 0.5 = some risk, 1 = high risk. weight = max points this factor
// can add to the overall spam-risk percentage (weights sum to 100).
function buildCheck({ key, label, weight, severity, status, message }) {
  return { key, label, weight, riskPercent: Math.round(weight * severity), status, message };
}

async function computeSendingHealth({ settings, sentToday, totalAttempted, bouncedCount, suppressedCount, totalContacts, invalidCount, templates = [] }) {
  const smtp = settings.smtp || {};
  const checks = [];

  const smtpConfigured = !!(smtp.host && smtp.user && smtp.pass && smtp.fromEmail);
  checks.push(buildCheck({
    key: 'smtp', label: '🔌 Email account connected', weight: 0, severity: smtpConfigured ? 0 : 1,
    status: smtpConfigured ? 'good' : 'bad',
    message: smtpConfigured ? `Sending as ${smtp.fromEmail}` : 'Settings me jaake apna email + password add karo pehle.'
  }));

  // 1. Sender domain — free webmail used for bulk commercial mail is a major spam signal.
  const domain = getDomain(smtp.fromEmail);
  const isFreeWebmail = domain && FREE_WEBMAIL_DOMAINS.has(domain);
  checks.push(buildCheck({
    key: 'sender_domain', label: '🏢 Sender domain reputation', weight: 18,
    severity: !domain ? 0.5 : isFreeWebmail ? 1 : 0,
    status: !domain ? 'neutral' : isFreeWebmail ? 'bad' : 'good',
    message: !domain
      ? 'Pehle apna sending email set karo.'
      : isFreeWebmail
        ? `${domain} se bulk promotional mail bhejna high-risk hai. Apne khud ke domain se bhejo, jaise you@neercred.com.`
        : `${domain} apna custom domain hai — achha signal, bashart SPF/DKIM/DMARC set ho.`
  }));

  // 2 & 3. SPF / DMARC DNS records for the sending domain.
  let spfResult = null;
  let dmarcResult = null;
  if (domain && !isFreeWebmail) {
    [spfResult, dmarcResult] = await Promise.all([checkSpf(domain), checkDmarc(domain)]);
  }
  checks.push(buildCheck({
    key: 'spf', label: '🔐 SPF record', weight: 16,
    severity: !domain || isFreeWebmail ? 0.5 : spfResult === true ? 0 : spfResult === false ? 1 : 0.5,
    status: !domain || isFreeWebmail ? 'neutral' : spfResult === true ? 'good' : spfResult === false ? 'bad' : 'warn',
    message: isFreeWebmail
      ? 'Free webmail par apna SPF record set nahi kar sakte — custom domain pe move karo.'
      : spfResult === true
        ? `${domain} ka SPF record mila — good.`
        : spfResult === false
          ? `${domain} pe SPF record nahi mila. Yeh domain ke DNS me ek "v=spf1 ..." TXT record add karke fix hota hai (apne ESP/hosting provider se karwao).`
          : 'SPF verify nahi ho paya (DNS check fail) — manually confirm karo apne domain registrar me.'
  }));
  checks.push(buildCheck({
    key: 'dmarc', label: '🛡️ DMARC record', weight: 10,
    severity: !domain || isFreeWebmail ? 0.5 : dmarcResult === true ? 0 : dmarcResult === false ? 1 : 0.5,
    status: !domain || isFreeWebmail ? 'neutral' : dmarcResult === true ? 'good' : dmarcResult === false ? 'bad' : 'warn',
    message: isFreeWebmail
      ? 'Free webmail par DMARC apply nahi hota.'
      : dmarcResult === true
        ? `${domain} ka DMARC record mila — good.`
        : dmarcResult === false
          ? `${domain} pe DMARC record nahi mila. "_dmarc.${domain}" par ek TXT record ("v=DMARC1; p=none; ...") add karo.`
          : 'DMARC verify nahi ho paya — manually confirm karo.'
  }));

  // 4. Sending pace.
  const delayMin = Number(settings.delayMinSec) || 0;
  const paceSeverity = delayMin < 3 ? 1 : delayMin < 6 ? 0.5 : 0;
  checks.push(buildCheck({
    key: 'pace', label: '⏱️ Sending speed', weight: 10, severity: paceSeverity,
    status: paceSeverity === 1 ? 'bad' : paceSeverity === 0.5 ? 'warn' : 'good',
    message: delayMin < 6
      ? `Sirf ${delayMin}s ka gap fast/burst sending jaisa lagta hai. 8-20s use karo.`
      : `Achhi pace hai: ${delayMin}-${settings.delayMaxSec || delayMin}s gap.`
  }));

  // 5. Daily volume vs safe limit for this kind of account.
  const gmail = isGmailHost(smtp.host);
  const dailySafeLimit = gmail ? 500 : Math.min(Number(settings.dailyLimit) || 300, 2000);
  const volumeRatio = dailySafeLimit ? sentToday / dailySafeLimit : 0;
  const volumeSeverity = volumeRatio >= 1 ? 1 : volumeRatio >= 0.7 ? 0.5 : 0;
  checks.push(buildCheck({
    key: 'volume', label: gmail ? '📦 Gmail daily limit' : '📦 Daily sending volume', weight: 10, severity: volumeSeverity,
    status: volumeSeverity === 1 ? 'bad' : volumeSeverity === 0.5 ? 'warn' : 'good',
    message: gmail
      ? `Gmail personal account ~500 emails/din tak safe hai. Aaj ${sentToday} bheji hain.`
      : `Aaj ${sentToday} bheji hain (limit ${settings.dailyLimit || 300}/run).`
  }));

  // 6. Bounce rate.
  const bounceRate = totalAttempted ? bouncedCount / totalAttempted : 0;
  const bounceSeverity = bounceRate > 0.05 ? 1 : bounceRate > 0.02 ? 0.5 : 0;
  checks.push(buildCheck({
    key: 'bounce', label: '📭 Bounce rate', weight: 9, severity: totalAttempted ? bounceSeverity : 0,
    status: !totalAttempted ? 'neutral' : bounceSeverity === 1 ? 'bad' : bounceSeverity === 0.5 ? 'warn' : 'good',
    message: totalAttempted
      ? `${(bounceRate * 100).toFixed(1)}% bounce hui hain. 2% se kam rakho.`
      : 'Abhi tak koi mail nahi bheji.'
  }));

  // 7. Unsubscribe / complaint proxy rate.
  const unsubRate = totalContacts ? suppressedCount / totalContacts : 0;
  const unsubSeverity = unsubRate > 0.03 ? 1 : unsubRate > 0.01 ? 0.5 : 0;
  checks.push(buildCheck({
    key: 'unsub', label: '🚫 Unsubscribe rate', weight: 7, severity: totalContacts ? unsubSeverity : 0,
    status: !totalContacts ? 'neutral' : unsubSeverity === 1 ? 'bad' : unsubSeverity === 0.5 ? 'warn' : 'good',
    message: totalContacts
      ? `${(unsubRate * 100).toFixed(1)}% list unsubscribe kar chuki hai. 1% se kam rakho.`
      : 'Abhi contacts nahi hain.'
  }));

  // 8. List quality (invalid / disposable emails).
  const invalidRate = totalContacts ? invalidCount / totalContacts : 0;
  const listSeverity = invalidRate > 0.15 ? 1 : invalidRate > 0.05 ? 0.5 : 0;
  checks.push(buildCheck({
    key: 'list', label: '📋 List quality', weight: 6, severity: totalContacts ? listSeverity : 0,
    status: !totalContacts ? 'neutral' : listSeverity === 1 ? 'bad' : listSeverity === 0.5 ? 'warn' : 'good',
    message: totalContacts
      ? `${(invalidRate * 100).toFixed(1)}% list invalid/disposable hai.`
      : 'Abhi contacts nahi hain.'
  }));

  // 9. Spam-trigger wording in subject/body — very relevant for loan/finance content.
  const spamWords = scanSpamWords(templates);
  const wordsSeverity = spamWords.length >= 3 ? 1 : spamWords.length >= 1 ? 0.5 : 0;
  checks.push(buildCheck({
    key: 'spam_words', label: '🗣️ Spam-trigger wording', weight: 10, severity: templates.length ? wordsSeverity : 0,
    status: !templates.length ? 'neutral' : wordsSeverity === 1 ? 'bad' : wordsSeverity === 0.5 ? 'warn' : 'good',
    message: !templates.length
      ? 'Abhi koi template nahi bana.'
      : spamWords.length
        ? `Risky words mile: ${spamWords.slice(0, 4).map((w) => `"${w.phrase}" → try "${w.alternatives[0]}"`).join('; ')}${spamWords.length > 4 ? '...' : ''}`
        : 'Koi common spam-trigger phrase nahi mila — good.'
  }));

  // 10. Personalization (fully identical mass content looks more like spam).
  const personalized = usesPersonalization(templates);
  checks.push(buildCheck({
    key: 'personalization', label: '👤 Personalization', weight: 4, severity: personalized === null ? 0 : personalized ? 0 : 0.5,
    status: personalized === null ? 'neutral' : personalized ? 'good' : 'warn',
    message: personalized === null
      ? 'Abhi koi template nahi bana.'
      : personalized
        ? '{{name}} jaisa personalization use ho raha hai — good.'
        : 'Template me {{name}} placeholder use nahi ho raha — thoda personalize karne se better lagta hai.'
  }));

  const riskWeightTotal = checks.reduce((sum, c) => sum + c.weight, 0) || 1;
  const riskPercent = Math.round(checks.reduce((sum, c) => sum + c.riskPercent, 0) * (100 / riskWeightTotal));
  const safetyScore = Math.max(0, 100 - riskPercent);

  let rating = 'Safe — Low Risk';
  let ratingColor = 'good';
  if (riskPercent >= 45) { rating = 'Danger — High Risk'; ratingColor = 'bad'; }
  else if (riskPercent >= 20) { rating = 'Risky — Medium Risk'; ratingColor = 'warn'; }

  return { score: safetyScore, riskPercent, rating, ratingColor, checks };
}

module.exports = { computeSendingHealth, isGmailHost, findSpamWordsInText };
