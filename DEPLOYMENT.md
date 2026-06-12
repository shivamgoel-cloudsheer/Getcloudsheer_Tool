# Deployment checklist — fresh setup under tools@cloudsheer.com

This repo is the Gmail-transport version of CloudSheer Outreach: emails send
through each sender's own Gmail mailbox via the Gmail API (no Resend, no
webhooks, no ESP). This checklist stands up the whole stack from scratch
under the **tools@cloudsheer.com** identity so all infrastructure lives in
one shared account instead of personal ones.

Work through it top to bottom; each section notes where the value ends up.

## 1. Google Cloud project (owner: tools@cloudsheer.com)

1. Sign in to [console.cloud.google.com](https://console.cloud.google.com) as
   **tools@cloudsheer.com** and create project `cloudsheer-outreach`.
   - In the creation dialog, confirm **Organization: cloudsheer.com**. If it
     says "No organization", the account isn't a Workspace account — stop and
     fix that first, because the Internal consent screen (next step) requires
     the project to live inside the org.
2. APIs & Services → Library: enable **Gmail API** and **Google Sheets API**.
3. APIs & Services → OAuth consent screen:
   - User type: **Internal** (critical — the restricted `gmail.send` scope
     then needs no Google verification, tokens never expire weekly, and only
     @cloudsheer.com accounts can sign in).
   - App name `CloudSheer Outreach`, support email tools@cloudsheer.com.
4. APIs & Services → Credentials → Create credentials → **OAuth client ID**:
   - Type: Web application
   - Authorized redirect URIs (both):
     - `http://localhost:3000/api/auth/callback/google`
     - `https://YOUR-APP.vercel.app/api/auth/callback/google` (fill in after
       step 3 below when the production URL exists, then save again)
   - Copy the Client ID → `AUTH_GOOGLE_ID`, secret → `AUTH_GOOGLE_SECRET`.

## 2. Database (Neon)

1. Create a project at [neon.tech](https://neon.tech) under
   tools@cloudsheer.com (or use the Vercel Marketplace integration in step 3).
2. Connection string → `DATABASE_URL`.
3. From a checkout with `.env.local` filled in: `npm run db:push`
   (creates all tables; idempotent).

## 3. Vercel

1. Import this GitHub repo into a Vercel project (under the team/account you
   want it to live in — tools@cloudsheer.com can own a Vercel account too).
2. Environment variables (see `.env.example` for the full list):
   - `AUTH_SECRET` — generate with `npx auth secret`
   - `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` — from §1.4
   - `DATABASE_URL` — from §2
   - `CRON_SECRET` — any long random string (used by §5)
   - `ACCESS_PASSWORD` — the gate-screen password
   - `APP_URL` — the production URL
3. Deploy, note the production URL, and go back to §1.4 to add the production
   redirect URI to the OAuth client.

## 4. Link the sender mailboxes (after deploy)

Each sending mailbox must sign in to the deployed dashboard with Google
**once**: shubham@, bharat@, tushar@cloudsheer.com. The consent screen asks
for Sheets + read Gmail + **send Gmail**; accepting links the mailbox. The
new-campaign form shows each sender as ready/not-ready, and a banner prompts
anyone whose grant is missing the send scope.

(Any time the OAuth client ID changes, all stored tokens die and everyone
must sign in again — the app updates stored tokens on every login, so a
plain re-login is enough.)

## 5. Dispatch trigger (every ~10 minutes)

Gmail has no server-side scheduling; due emails are sent by
`GET /api/dispatch` (auth: `Authorization: Bearer CRON_SECRET`).

- [cron-job.org](https://cron-job.org) (free): job → URL
  `https://YOUR-APP.vercel.app/api/dispatch`, every 10 minutes, with the
  bearer header. Use the tools@cloudsheer.com login for the account.
- Or Vercel Pro: add `{ "path": "/api/dispatch", "schedule": "*/10 * * * *" }`
  to `vercel.json` crons.

The existing daily `/api/process` cron (already in `vercel.json`) and the
dashboard's "Check replies + sync" button also dispatch as backstops.

## 6. Verify end-to-end (15 minutes, do not skip)

1. **Smoke**: campaign with 2 recipients you control (one Gmail, one other),
   drip gap 1 min, warm-up off. After dispatch (curl it or wait for the
   ping): both arrive in **Primary**, appear in the sender's **Sent folder**,
   rows show `sent` with `gmailMessageId`/`gmailThreadId` set.
2. **Threading**: add a follow-up step (subject starting `Re:`), backdate the
   recipient's `last_email_at` by a day (db studio), run "Check replies +
   sync" twice (queue, then dispatch) — the follow-up must appear **in the
   same thread** on both sides.
3. **Reply**: reply from a recipient mailbox, run "Check replies + sync" —
   row flips to `replied` and any queued follow-up is cancelled.
4. **Bounce**: send to a nonexistent address at a real domain, wait for the
   mailer-daemon report, run the check — row flips to `bounced` and the
   address lands in the suppression list.

## 7. Production sending policy (agreed)

- Salesforce AE batch (~250, already scrubbed): **daily cap 5 per sender**,
  warm-up ON, spread across all three senders (~15/day total into
  salesforce.com — it must look like three people prospecting by hand).
- Template body ends with a one-line opt-out, e.g.
  `P.S. Not relevant? Just reply "no" and I won't follow up.`
  (There is no footer; reply detection handles the rest.)
- Watch bounces daily for the first week — anything over ~5% means the list
  needs re-verification. Google Postmaster Tools (postmaster.google.com,
  verify cloudsheer.com) starts showing data after a week or two of volume.
