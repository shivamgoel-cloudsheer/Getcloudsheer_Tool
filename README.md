# CloudSheer Outreach

Send personalized email campaigns straight from a Google Sheet — **through each sender's own Gmail mailbox**, so emails go out from Google's servers, sit in the sender's Sent folder, and look exactly like hand-written 1:1 mail.

- Sign in with Google (one grant covers Sheets read/write, Gmail send, and Gmail read for reply/bounce detection)
- Paste a sheet URL, preview the rows, compose with `{{Column}}` placeholders
- Every campaign is **dripped**: emails go out one at a time with a jittered gap, only inside a business-hours window, capped per day **per sender** across all campaigns, weekends optional
- New sender mailboxes **warm up** automatically (10/day, +25% every 3 days up to the cap)
- **Follow-ups thread under the original email** (In-Reply-To/References + Gmail thread id); the dashboard headline is **reply rate**
- **Plain-text sends, no `List-Unsubscribe` headers, no tracking** — cold 1:1 mail built to land in Primary, not Promotions
- Replies and bounces are detected from **each sender's own inbox**; both cancel any still-queued sends to that address
- A content linter flags spammy subjects/bodies before you send

## Stack

Next.js 16 (App Router) · Auth.js v5 · Neon Postgres + Drizzle ORM · Gmail API (per-sender OAuth) · Tailwind 4

## Sheet format

Row 1 must be headers. An **Email** column is required (also matched: "Mail ID", "Email Address", etc.). Every other column becomes a placeholder, for example:

| Name | Email | Subject | Email Content |
|------|-------|---------|---------------|
| Sara | sara@acme.com | Quick intro | Hi Sara, ... |

In the composer you can then write `{{Name}}`, `{{Subject}}`, `{{Email Content}}`, or any other column header.

## Setup

### 1. Database (Neon)

1. Create a free project at [neon.tech](https://neon.tech) (or install the Neon integration from the Vercel Marketplace).
2. Copy the connection string into `DATABASE_URL` in `.env.local`.
3. Push the schema: `npm run db:push`

### 2. Google Cloud (sign-in + Sheets + Gmail)

1. Create a project at [console.cloud.google.com](https://console.cloud.google.com) and enable the **Google Sheets API** and the **Gmail API**.
2. Configure the OAuth consent screen. Because the app requests the restricted `gmail.send`/`gmail.readonly` scopes, set the user type to **Internal** (all senders are in the cloudsheer.com Workspace) — Internal apps need no Google verification and tokens don't expire weekly.
3. Create an OAuth Client ID (type: Web application) with these redirect URIs:
   - `http://localhost:3000/api/auth/callback/google`
   - `https://YOUR-APP.vercel.app/api/auth/callback/google`
4. Copy the client ID and secret into `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`.

### 3. Link every sender

Each sending mailbox (shubham@/bharat@/tushar@) must **sign in to the dashboard with Google once** to grant send access. The campaign form shows which senders are ready; a banner prompts anyone whose grant predates the send scope to re-connect. There is nothing else to configure — no ESP, no DNS records, no webhook.

### 4. Environment variables

Copy `.env.example` to `.env.local` and fill in every value. Generate `AUTH_SECRET` with `npx auth secret`. Set the same variables in your Vercel project settings, with `APP_URL` pointing at the deployed URL.

### 5. Run

```bash
npm install
npm run db:push    # creates the tables in Neon
npm run dev        # http://localhost:3000
```

### 6. Dispatch trigger (production)

Gmail has no server-side scheduling, so due emails are sent by `GET /api/dispatch` (auth: `Authorization: Bearer CRON_SECRET`). Ping it every ~10 minutes:

- **cron-job.org** (free): create a job hitting `https://YOUR-APP.vercel.app/api/dispatch` with the bearer header every 10 minutes, or
- **Vercel Pro**: add `{ "path": "/api/dispatch", "schedule": "*/10 * * * *" }` to `vercel.json` crons.

The daily `/api/process` cron and the dashboard's manual "Check replies + sync" also dispatch as a backstop, so nothing is ever stuck for long.

## How sending works

1. Creating a campaign snapshots the sheet rows into the database. Invalid emails are skipped, and duplicate emails are deduped (first row wins); the response reports both counts plus any content-linter warnings.
2. Sending is **drip only** — there is no immediate-burst path. The stagger allocator assigns each recipient a send time (jittered gaps, business-hours window, per-sender daily cap spanning every campaign that mailbox sends, weekends optional, warm-up ramp) and stores it as `scheduledFor` in the database. No email API is called at schedule time, so scheduling is instant.
3. The **dispatcher** (`/api/dispatch`) claims due rows with a race-safe single-statement update, renders each email, and sends it through the **sender's own Gmail** via the Gmail API — plain text, no footer, no tracking. The Gmail message id, thread id, and RFC Message-ID are stored per recipient.
4. **Follow-ups** are queued by the background processor on the same drip rules and per-sender budget, and the dispatcher sends them **in the same Gmail thread** as the original (start follow-up subjects with `Re:` so they thread on the recipient's side too). A detected reply, unsubscribe, or bounce cancels a recipient's queued follow-up — cancellation is just a database flip, it can never race a remote queue.
5. **Replies** are detected by polling each sender's own inbox (not just the campaign owner's). **Bounces** are detected from mailer-daemon delivery reports in the sender's inbox; the address is suppressed everywhere.
6. The campaign page polls every 5 seconds while you watch results come in.

## Senders and addresses

The three preset sending mailboxes and their default signatures live in [`src/lib/senders.ts`](src/lib/senders.ts). A campaign with no explicit sender uses `DEFAULT_FROM_ADDRESS` (the first entry).

In the composer you can also pick **Custom address…** to send from any name/email — but the mailbox owner must have signed in to the dashboard with Google once, because the send goes out through *their* Gmail. The **signature** appended to every email (initial and follow-ups) defaults to the selected sender's sign-off and is editable per campaign.

## Things to know

- **Gmail limits**: Google Workspace allows ~2,000 recipients/day/mailbox — far above the tool's cap ceiling (100/day/sender, default 40). The constraint that matters is reputation, not quota: keep daily caps low (5–15/day for cold outreach to a single receiving domain) and warm-up on.
- **Reply rate is the metric**: there is no open/click tracking at all (plain text has no pixel, links aren't rewritten). Replies and bounces are the two signals, both read from the sender's own inbox.
- **Statuses**: pending → scheduled → sent → replied / bounced / failed (plus suppressed). `delivered`/`opened`/`clicked` only exist on historical Resend-era rows.
- **Keep lists clean**: a high bounce rate into one receiving domain is the fastest way to damage a mailbox's reputation. Scrub and verify lists before sending; detected bounces auto-suppress.
- **Primary vs Promotions**: sending through the actual Workspace mailbox via the Gmail API is the strongest infrastructure signal there is — the same mechanism as typing the email in Gmail. Keep the From name consistent with the signature, keep subjects clean (the linter helps), and keep volume human-scale.
- Everything works on localhost — there are no webhooks. Run `curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/dispatch` to trigger a dispatch manually.

## Deploy to Vercel

```bash
npx vercel
```

Then set the environment variables in the Vercel dashboard, update the Google OAuth redirect URI to the production domain, set up the 10-minute dispatch ping (see Setup §6), and redeploy.
