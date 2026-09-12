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

## Important — deliverability & compliance

This tool is built to follow legitimate email marketing practice, not to evade spam filters:

- **Only email people who have a real relationship with neercred.com or opted in.** Sending to a purchased/scraped list is a fast way to get your domain blacklisted and can carry legal risk for loan/finance marketing specifically.
- Every send includes a working unsubscribe link; anyone who clicks it is added to a permanent suppression list and will never be emailed again by this tool.
- Set up **SPF, DKIM and DMARC** on your sending domain (neercred.com) — this is what actually keeps you out of spam folders, far more than any app-level trick.
- Gmail/Outlook accounts have low daily bulk-sending limits and will throttle or block you fast. For real bulk volume, use SMTP credentials from a transactional ESP (Amazon SES, SendGrid, Mailgun, Brevo) instead — set them in the Settings tab, same as any SMTP.
- Keep the per-run limit and delay conservative, especially when warming up a new sending domain/IP.

## Data storage

All settings, templates, contacts, and logs are stored locally in `data/db.json` (gitignored). Nothing is sent anywhere except: your configured SMTP server (to send mail) and, only if you set an Anthropic API key, the Anthropic API (to extract emails from text you paste).
