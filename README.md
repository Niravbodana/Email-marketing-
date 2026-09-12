# Neercred Email Marketing

Self-hosted (localhost) email marketing sender for neercred.com — SMTP-based, one-at-a-time sending with configurable delays, HTML templates with images, an unsubscribe/suppression list, and optional Anthropic-powered email extraction from pasted bulk data.

## Setup

```bash
npm install
npm start
```

Open http://localhost:4000

## Using it

1. **Settings tab** — enter your SMTP credentials (host/port/user/app-password), from name/email, optional Anthropic API key, and sending pace (delay between emails, max emails per run).
2. **Templates tab** — create a subject + HTML body. Use `{{name}}` and `{{email}}` as placeholders. Reference an image by URL (host it on neercred.com or any CDN — don't inline huge base64 images, that hurts deliverability).
3. **Contacts tab** — paste your raw bulk data (CSV, copy-pasted text, anything). It extracts email addresses (using Claude if an API key is set, otherwise a regex fallback) and adds them to your contact list, skipping anyone already unsubscribed.
4. **Send Campaign tab** — pick a template and start. Emails go out one at a time with a random delay (configured in Settings) to avoid burst-sending. Every email includes a working unsubscribe link and a `List-Unsubscribe` header.

## Spam-word checker (Templates tab)

Before saving a template, click "Check for Spam Words" — it scans your subject/body for phrases known to trigger spam filters (especially loan/finance wording like "guaranteed approval", "no credit check", "click here") and shows a safer alternative phrase for each one.

## Mail connection & API keys (Settings tab)

- **✉️ Mail Connection** — enter SMTP details and click "🔌 Test Connection". It does a real SMTP handshake (no email sent) and shows a green dot ("connected") or red dot ("not connected", with the actual error) — no more guessing if your email is wired up correctly.
- **🔑 API Keys** — a list of keys instead of a single field. "Anthropic" is there by default (used for email extraction and AI personalization); click "+ Add API Key" to store more for future use. Each row has its own "Test" button and green/red status dot. Only the "Anthropic" one is actively used by the app right now — others are stored for when you wire up more providers.

## Multiple templates + which one gets clicks (Templates tab)

Create as many templates as you want ("+ Save as New Template"), delete old ones any time. Each saved template shows **📧 Sent** and **🖱️ Clicked by / CTR** counts. Every link inside a sent email is automatically routed through this app first (`/api/track/click`) before redirecting to the real URL, so a click is recorded against that exact template and contact — this is the closest signal we can get, from inside this tool, to "which template is actually driving people to the website," since real lead conversion happens on neercred.com itself.

## AI personalization (Settings tab)

Turn on "AI se har email ko individually rewrite karke bhejo" and add your Anthropic API key. When enabled, each email is sent one at a time as before, but Claude lightly rewrites the wording/sentence structure for that one recipient before it goes out — same offer, same image, same links, same unsubscribe footer, just not word-for-word identical to every other recipient. This is what actually makes a "bulk" send read as individual mail instead of a template blast, and it reduces (not eliminates) the pattern-matching signals spam filters look for. If the AI call fails for a given contact (bad key, rate limit, etc.), that email still sends using the plain `{{name}}`-filled template as a fallback — nothing is skipped.

## Important — deliverability & compliance

This tool is built to follow legitimate email marketing practice, not to evade spam filters:

- **Only email people who have a real relationship with neercred.com or opted in.** Sending to a purchased/scraped list is a fast way to get your domain blacklisted and can carry legal risk for loan/finance marketing specifically.
- Every send includes a working unsubscribe link; anyone who clicks it is added to a permanent suppression list and will never be emailed again by this tool.
- Set up **SPF, DKIM and DMARC** on your sending domain (neercred.com) — this is what actually keeps you out of spam folders, far more than any app-level trick.
- Gmail/Outlook accounts have low daily bulk-sending limits and will throttle or block you fast. For real bulk volume, use SMTP credentials from a transactional ESP (Amazon SES, SendGrid, Mailgun, Brevo) instead — set them in the Settings tab, same as any SMTP.
- Keep the per-run limit and delay conservative, especially when warming up a new sending domain/IP.

## Contact tags + CSV export

Click a contact's 🏷️ tags area in the Contacts tab to set comma-separated tags (e.g. "personal-loan", "business-loan"). In Send Campaign, filter by tag to target just that group instead of everyone. "⬇️ Export CSV" links in Contacts and Send Campaign download your contacts and send logs as CSV for backup or analysis.

## Campaign scheduling

In Send Campaign, tick "⏰ Abhi nahi, baad me bhejo (schedule)" and pick a date/time — the campaign is saved as "scheduled" and a background check (every 30s) starts it automatically once that time arrives, re-checking suppression/active status at that moment so nothing stale gets sent.

## Lead-conversion webhook

Settings shows a Webhook URL + Secret. Give these to whoever maintains neercred.com's Apply form: have their backend POST `{ "secret": "...", "email": "...", "name": "..." }` to that URL whenever someone actually submits the form. This records a real lead (not just a click) and — if that email previously clicked a tracked link — attributes the lead back to the template that drove it, shown as "leadsCount" in that template's stats via `/api/templates/:id/stats`.

## SMS marketing (separate channel)

A parallel "📱 SMS Marketing" tab: paste raw text to extract phone numbers, create SMS templates (with an optional Apply link appended), and send one-by-one through Twilio (configure Account SID / Auth Token / From Number in Settings). Opt-outs are handled two ways: a manual `/api/sms/opt-out?phone=...` link, and an inbound-webhook endpoint (`/api/sms/webhook/inbound`) you can point a provider's inbound-SMS webhook at — a reply of STOP/UNSUBSCRIBE permanently suppresses that number.

**Important honest limitation**: there is no free public API to check India's National DND (NDNC) registry, so this app cannot verify DND status itself. Real Indian promotional SMS requires a **DLT (Distributed Ledger Technology)-registered** provider and template (e.g. MSG91, Kaleyra, Gupshup) — DND-registered numbers are then blocked automatically at the telecom operator level. Twilio (wired up by default here) is not DLT-registered for India, so it's suitable for testing / non-Indian numbers only. For real India-wide loan SMS marketing, swap the provider call in `lib/smsSender.js` for a DLT-compliant provider's API.

## API cost tracking & budget limit

Every Anthropic API call (email extraction, AI personalization) is logged with its real token usage and cost (Claude Sonnet 5 pricing: $2/million input tokens, $10/million output tokens). Settings has an **API Cost & Budget** section — set a max $ limit and a warn-at percentage. The Dashboard shows a live spend meter; once spend reaches the limit, AI extraction and personalization automatically stop being used (falling back to plain regex extraction / template-only sending) so the bill can't run away — nothing gets blocked, it just stops calling the paid API until you raise the limit.

## Combined Dashboard + alerts

The Dashboard now shows email sent/pending/in-queue counts alongside SMS sent, in one place, plus an **Alerts** panel at the top that turns backend problems into plain-language "what's wrong + what to do" cards — SMTP disconnected, an invalid API key, budget almost/fully used, high spam risk, or a campaign with a lot of failures. If your browser grants notification permission, a new critical alert also fires a browser notification (best-effort, browser-tab-based — not a phone push notification).

## Data storage

All settings, templates, contacts, and logs are stored locally in `data/db.json` (gitignored). Nothing is sent anywhere except: your configured SMTP server (to send mail) and, only if you set an Anthropic API key, the Anthropic API (to extract emails from text you paste).
