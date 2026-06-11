# CloudSheer Outreach

Send personalized email campaigns straight from a Google Sheet, with per-recipient delivery, open, and click tracking.

- Sign in with Google (the same grant gives read access to your Sheets)
- Paste a sheet URL, preview the rows, compose with `{{Column}}` placeholders
- Every campaign is **dripped**: emails go out one at a time with a jittered gap, only inside a business-hours window, capped per day **per sender** across all campaigns, weekends optional
- New sender mailboxes **warm up** automatically (10/day, +25% every 3 days up to the cap)
- Resend webhooks update each recipient: sent, delivered, opened, bounced; the dashboard headline is **reply rate**
- **Plain-text sends, no `List-Unsubscribe` headers** - cold 1:1 mail is built to land in Primary, not Promotions. Opt-out is a plain footer link (still automated via the suppression list) plus the postal address for CAN-SPAM
- A content linter flags spammy subjects/bodies before you send
- Unsubscribes, bounces, complaints, and detected replies **cancel** any still-queued sends to that address

## Stack

Next.js 16 (App Router) · Auth.js v5 · Neon Postgres + Drizzle ORM · Resend · Tailwind 4

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

### 2. Google Cloud (sign-in + Sheets access)

1. Create a project at [console.cloud.google.com](https://console.cloud.google.com) and enable the **Google Sheets API**.
2. Configure the OAuth consent screen: External, Testing mode, and add your own Google account as a test user.
3. Create an OAuth Client ID (type: Web application) with these redirect URIs:
   - `http://localhost:3000/api/auth/callback/google`
   - `https://YOUR-APP.vercel.app/api/auth/callback/google`
4. Copy the client ID and secret into `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`.

Note: in Testing mode, Google expires refresh tokens after 7 days, so you must sign in again weekly. To avoid that, set the consent screen's publishing status to "In production". You'll see an unverified app warning once, which is fine for a personal tool.

### 3. Resend (sending + tracking)

1. At [resend.com](https://resend.com), add the domain **mail.cloudsheer.com** (a subdomain protects the reputation of your root domain) and add the DNS records it gives you.
2. In the domain settings, **leave Click Tracking off** for cold campaigns - rewritten links are a strong spam signal and the reply rate, not the click rate, is what matters here. Open Tracking is optional; enable it only if you want directional open numbers (Apple Mail and image blockers make it unreliable). Tracking is configured per domain.
3. Create an API key and put it in `RESEND_API_KEY`.
4. After your first deploy, add a webhook pointing to `https://YOUR-APP.vercel.app/api/webhooks/resend` and subscribe to all `email.*` events. Copy the signing secret (`whsec_...`) into `RESEND_WEBHOOK_SECRET`.

### 4. Environment variables

Copy `.env.example` to `.env.local` and fill in every value. Generate `AUTH_SECRET` with `npx auth secret`. Set the same variables in your Vercel project settings, with `APP_URL` pointing at the deployed URL.

### 5. Run

```bash
npm install
npm run db:push    # creates the tables in Neon
npm run dev        # http://localhost:3000
```

## How sending works

1. Creating a campaign snapshots the sheet rows into the database. Invalid emails are skipped, and duplicate emails are deduped (first row wins); the response reports both counts plus any content-linter warnings.
2. Sending is **drip only** - there is no immediate-burst path. Each recipient is assigned a send time through Resend's `scheduled_at`: jittered gaps, clamped to a business-hours window, capped per day **per sender** (the cap spans every campaign that mailbox sends), weekends optional, and ramped while a new sender warms up. The cap ceiling is 100/day.
3. Each email is **plain text** with its Reply-To set to its own From address, so replies land in that sender's mailbox. There are no `List-Unsubscribe` headers (the strongest "this is bulk" signal); the opt-out is a plain footer link to `/u/[token]` that still feeds the suppression list, alongside the sender's physical postal address. Each email carries a `recipient_id` tag, and returned Resend email IDs are stored per recipient.
4. The webhook handler verifies signatures (svix), logs every event, and moves each recipient forward through: scheduled, sent, delivered, opened. Bounces and complaints are terminal: the address is suppressed and any still-queued sends to it are cancelled.
5. Follow-up steps are scheduled by the background processor on the **same** drip rules and per-sender daily budget. A detected reply (or unsubscribe/bounce/complaint) cancels a recipient's queued follow-up.
6. The campaign page polls every 5 seconds while you watch results come in.

## Senders and addresses

The three preset sending mailboxes, their reply-to behavior, CAN-SPAM postal addresses, and default signatures live in [`src/lib/senders.ts`](src/lib/senders.ts). **Fill in each `mailingAddress` with the real street address before sending** - the bracketed placeholders are intentionally obvious. The default `RESEND_FROM` sender falls back to the `MAILING_ADDRESS` env var.

In the composer you can also pick **Custom address…** to send from any name/email (the domain must be verified in Resend, or delivery fails), and edit the **signature** that's appended to every email - initial and follow-ups - above the unsubscribe footer. The signature defaults to the selected sender's sign-off and is editable per campaign.

Because Reply-To is now the sending address, reply detection (which polls the signed-in Google account's Gmail inbox) only sees replies that reach that inbox. Make sure each sender mailbox (shubham@/bharat@/tushar@) either **is** the polled account or **forwards** into it, or replies to the other senders won't be detected.

## Things to know

- **Resend free tier**: 100 emails/day and 3,000/month. Larger campaigns need the Pro plan. The per-sender daily cap (default 40, ceiling 100) keeps you inside this.
- **Reply rate is the metric**: the dashboard headline is reply rate. Open rate is directional only (Apple Mail fires false opens, image blockers fire none) and click tracking is off by design.
- **Warm up the domain and senders**: a fresh subdomain or mailbox has no reputation. Warm-up mode ramps a new sender from 10/day up to the cap automatically; keep it on for new addresses.
- **Primary vs Promotions**: plain text, no list headers, a clean subject (the linter flags "free", ALL-CAPS, etc.), and low per-sender volume all push toward Primary. The deepest lever is *infrastructure*: sending through an ESP (Resend) on a `mail.` subdomain still looks like bulk to Gmail. Tools that reliably hit Primary send through the actual Google Workspace mailbox (SMTP/Gmail API). Moving to mailbox-based sending is the next step if Promotions placement persists after these changes. Also keep the From name consistent with the email's signature.
- **Keep lists clean**: high bounce or complaint rates can get a Resend account suspended. The suppression list is enforced on every send.
- Webhooks can't reach localhost. To test tracking locally, use a tunnel (for example `npx untun@latest tunnel http://localhost:3000`) or test on the deployed app.

## Deploy to Vercel

```bash
npx vercel
```

Then set the environment variables in the Vercel dashboard, update the Google OAuth redirect URI and the Resend webhook URL to the production domain, and redeploy.
