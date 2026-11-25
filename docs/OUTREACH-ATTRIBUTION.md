# Outreach attribution (ScribeAI backend)

Reports signups and the first activation of people who arrived through an outreach email link to the shared outreach metrics layer
(Calldesk `docs/OUTREACH-METRICS.md`, `POST /api/outreach/event`). Code: `ai-notetaker-backend/src/utils/outreachEvents.js`,
`src/services/outreachAttribution.js`, hooks in `src/routes/auth.js`, `src/routes/ai.js` and `src/routes/recordings.js`.

## What is reported, and the one gap
- ScribeAI had no attribution storage and no request that carries a utm today (web and Android sign-up bodies are email/password/name or a
  Google ID token). The backend therefore ACCEPTS an optional `signup_source` object in `POST /api/auth/register` and `POST /api/auth/google`
  (`{ utm_source, utm_campaign, utm_content }`, same shape VibeBuild already uses). No client sends it yet: until the web sign-up sends it,
  nothing is attributed and nothing is reported. Android and iOS clients are untouched.
- When it is sent with `utm_source=outreach` and a valid `utm_campaign`: the first touch is stored on the new account in
  `auth.users.app_metadata.outreach = { campaign, code }` (admin-only storage, no migration, no table) and a `signup` event is reported.
- `activated`: first successful `POST /api/ai/summary` or `POST /api/recordings/transcribe` by a user whose `app_metadata.outreach` exists.
  At most one lookup per user per process; the layer keeps one `activated` row per user and campaign.
- The email goes only in the signed body; the layer hashes it with its pepper and never stores it. Logs carry event, campaign and status.

## Off by default
Nothing is sent unless `OUTREACH_EVENTS_URL` (https) and a secret (`OUTREACH_EVENT_SECRET_SCRIBEAI`, else `OUTREACH_EVENT_SECRET`) are set.
Fire and forget, 2 s timeout, one background retry on network error / 5xx / 429, all errors swallowed.

## Enable (after the Calldesk layer is verified live)
```
flyctl secrets set -a ai-notetaker-backend OUTREACH_EVENT_SECRET=<same value as calldesk-tech> OUTREACH_EVENTS_URL=https://calldesk.tech/api/outreach/event
```
Plus a small web-app change: capture `utm_source/utm_campaign/utm_content` on first landing (the layer's `/o/<campaign>/<code>` redirect
adds them) and send them as `signup_source` with the sign-up call.

## Without link attribution
`docs/outreach-baseline.sql`: signups in the 14 days after a send vs the 14 days before (the 2026-11-04 "now free" announcement).
