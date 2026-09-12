// Computes a simple, plain-language "is my sending safe right now" score.
// This does not read real Gmail/ESP reputation data (not exposed by SMTP) — it is a
// rules-of-thumb meter based on your own settings and this tool's own send history.

function isGmailHost(host) {
  return /gmail\.com|googlemail\.com/i.test(host || '');
}

function computeSendingHealth({ settings, sentToday, totalAttempted, bouncedCount, suppressedCount, totalContacts, invalidCount }) {
  const checks = [];
  let score = 100;

  const smtp = settings.smtp || {};
  const smtpConfigured = !!(smtp.host && smtp.user && smtp.pass && smtp.fromEmail);
  checks.push({
    key: 'smtp',
    label: 'Email account connected',
    status: smtpConfigured ? 'good' : 'bad',
    message: smtpConfigured
      ? `Sending as ${smtp.fromEmail}`
      : 'Go to Settings and add your email + password to send mail.'
  });

  const gmail = isGmailHost(smtp.host);
  const dailySafeLimit = gmail ? 500 : Math.min(Number(settings.dailyLimit) || 300, 2000);
  const volumeRatio = dailySafeLimit ? sentToday / dailySafeLimit : 0;
  let volumeStatus = 'good';
  if (volumeRatio >= 1) volumeStatus = 'bad';
  else if (volumeRatio >= 0.7) volumeStatus = 'warn';
  if (volumeStatus === 'bad') score -= 30;
  else if (volumeStatus === 'warn') score -= 10;
  checks.push({
    key: 'volume',
    label: gmail ? 'Gmail daily sending limit' : 'Daily sending limit',
    status: volumeStatus,
    message: gmail
      ? `Gmail personal accounts safely allow about 500 emails/day. You sent ${sentToday} today.`
      : `You sent ${sentToday} today (your set limit is ${settings.dailyLimit || 300}/run).`
  });

  const delayMin = Number(settings.delayMinSec) || 0;
  let delayStatus = 'good';
  if (delayMin < 3) delayStatus = 'bad';
  else if (delayMin < 6) delayStatus = 'warn';
  if (delayStatus === 'bad') score -= 20;
  else if (delayStatus === 'warn') score -= 8;
  checks.push({
    key: 'pace',
    label: 'Sending speed (gap between emails)',
    status: delayStatus,
    message: delayMin < 6
      ? `Only ${delayMin}s between emails is fast and looks like spam to Gmail/Outlook. Use 8-20s.`
      : `Good pace: ${delayMin}-${settings.delayMaxSec || delayMin}s between each email.`
  });

  const bounceRate = totalAttempted ? bouncedCount / totalAttempted : 0;
  let bounceStatus = 'good';
  if (bounceRate > 0.05) bounceStatus = 'bad';
  else if (bounceRate > 0.02) bounceStatus = 'warn';
  if (bounceStatus === 'bad') score -= 25;
  else if (bounceStatus === 'warn') score -= 10;
  checks.push({
    key: 'bounce',
    label: 'Bounce rate',
    status: totalAttempted ? bounceStatus : 'neutral',
    message: totalAttempted
      ? `${(bounceRate * 100).toFixed(1)}% of emails sent so far bounced. Keep this under 2%.`
      : 'No emails sent yet, nothing to measure.'
  });

  const unsubRate = totalContacts ? suppressedCount / totalContacts : 0;
  let unsubStatus = 'good';
  if (unsubRate > 0.03) unsubStatus = 'bad';
  else if (unsubRate > 0.01) unsubStatus = 'warn';
  if (unsubStatus === 'bad') score -= 15;
  else if (unsubStatus === 'warn') score -= 5;
  checks.push({
    key: 'unsub',
    label: 'Unsubscribe rate',
    status: totalContacts ? unsubStatus : 'neutral',
    message: totalContacts
      ? `${(unsubRate * 100).toFixed(1)}% of your list has unsubscribed. Keep this under 1%.`
      : 'No contacts yet.'
  });

  const invalidRate = totalContacts ? invalidCount / totalContacts : 0;
  let listStatus = 'good';
  if (invalidRate > 0.15) listStatus = 'bad';
  else if (invalidRate > 0.05) listStatus = 'warn';
  if (listStatus === 'bad') score -= 10;
  else if (listStatus === 'warn') score -= 4;
  checks.push({
    key: 'list',
    label: 'List quality',
    status: totalContacts ? listStatus : 'neutral',
    message: totalContacts
      ? `${(invalidRate * 100).toFixed(1)}% of your list is invalid/disposable emails.`
      : 'No contacts yet.'
  });

  score = Math.max(0, Math.min(100, Math.round(score)));

  let rating = 'Safe';
  let ratingColor = 'good';
  if (score < 50) { rating = 'Danger — stop and fix issues below'; ratingColor = 'bad'; }
  else if (score < 80) { rating = 'Risky — be careful'; ratingColor = 'warn'; }

  return { score, rating, ratingColor, checks };
}

module.exports = { computeSendingHealth, isGmailHost };
