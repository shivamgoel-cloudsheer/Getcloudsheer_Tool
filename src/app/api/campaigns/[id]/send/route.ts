import { after } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/db";
import { campaigns, recipients, unsubscribes } from "@/db/schema";
import { getResend } from "@/lib/resend";
import { buildEmailBodies, renderTemplate } from "@/lib/template";

export const maxDuration = 300;

const BATCH_SIZE = 100;
const DELAY_BETWEEN_BATCHES_MS = 600;
const DELAY_BETWEEN_SINGLE_SENDS_MS = 600;
const MAX_RETRIES = 3;

const MIN_SCHEDULE_AHEAD_MS = 2 * 60 * 1000;
const MAX_SCHEDULE_AHEAD_MS = 30 * 24 * 60 * 60 * 1000;

const bodySchema = z.object({
  scheduledAt: z.string().datetime({ offset: true }).optional(),
});

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await params;

  const raw = await request.text();
  const parsed = bodySchema.safeParse(raw ? JSON.parse(raw) : {});
  if (!parsed.success) {
    return Response.json({ error: "Invalid scheduledAt" }, { status: 400 });
  }

  let scheduledAt: Date | null = null;
  if (parsed.data.scheduledAt) {
    scheduledAt = new Date(parsed.data.scheduledAt);
    const ahead = scheduledAt.getTime() - Date.now();
    if (ahead < MIN_SCHEDULE_AHEAD_MS) {
      return Response.json(
        { error: "Schedule at least 2 minutes in the future" },
        { status: 400 }
      );
    }
    if (ahead > MAX_SCHEDULE_AHEAD_MS) {
      return Response.json(
        { error: "Resend supports scheduling at most 30 days ahead" },
        { status: 400 }
      );
    }
  }

  // Atomic guard: only a draft or previously failed campaign can start.
  const [campaign] = await db
    .update(campaigns)
    .set({ status: "sending", scheduledAt })
    .where(
      and(
        eq(campaigns.id, id),
        eq(campaigns.userId, session.user.id),
        inArray(campaigns.status, ["draft", "failed"])
      )
    )
    .returning();

  if (!campaign) {
    return Response.json(
      { error: "Campaign not found or already sending/sent" },
      { status: 409 }
    );
  }

  // Respond immediately; the send loop continues after the response.
  after(() => runSend(campaign.id, scheduledAt));

  return Response.json(
    { status: scheduledAt ? "scheduling" : "sending" },
    { status: 202 }
  );
}

type Recipient = typeof recipients.$inferSelect;
type Campaign = typeof campaigns.$inferSelect;

function buildPayload(
  campaign: Campaign,
  r: Recipient,
  scheduledAt: Date | null
) {
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const replyTo = process.env.RESEND_REPLY_TO;
  const unsubscribeUrl = `${appUrl}/u/${r.unsubscribeToken}`;
  const subject = renderTemplate(campaign.subjectTemplate, r.rowData);
  const renderedBody = renderTemplate(campaign.bodyTemplate, r.rowData);
  const { html, text } = buildEmailBodies(renderedBody, unsubscribeUrl);

  return {
    from: process.env.RESEND_FROM!,
    to: [r.email],
    ...(replyTo ? { replyTo } : {}),
    subject,
    html,
    text,
    ...(scheduledAt ? { scheduledAt: scheduledAt.toISOString() } : {}),
    headers: {
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    tags: [
      { name: "recipient_id", value: r.id },
      { name: "campaign_id", value: campaign.id },
    ],
  };
}

async function runSend(campaignId: string, scheduledAt: Date | null) {
  try {
    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaignId));
    if (!campaign) return;

    // A retry should re-attempt previously failed recipients
    await db
      .update(recipients)
      .set({ status: "pending", error: null })
      .where(
        and(
          eq(recipients.campaignId, campaignId),
          eq(recipients.status, "failed")
        )
      );

    const pending = await db
      .select()
      .from(recipients)
      .where(
        and(
          eq(recipients.campaignId, campaignId),
          eq(recipients.status, "pending")
        )
      );

    // Suppression list: anyone who unsubscribed, bounced, or complained before
    const suppressedEmails = new Set(
      (await db.select({ email: unsubscribes.email }).from(unsubscribes)).map(
        (u) => u.email
      )
    );

    const toSuppress = pending.filter((r) =>
      suppressedEmails.has(r.email.toLowerCase())
    );
    if (toSuppress.length > 0) {
      await db
        .update(recipients)
        .set({ status: "suppressed" })
        .where(
          inArray(
            recipients.id,
            toSuppress.map((r) => r.id)
          )
        );
    }

    const toSend = pending.filter(
      (r) => !suppressedEmails.has(r.email.toLowerCase())
    );

    // Distinguishes deliberate re-runs (retry button) from crash-retries of
    // the same run, so Resend's idempotency cache doesn't replay old results
    const runId = Date.now().toString(36);

    const outcome = scheduledAt
      ? await sendIndividually(campaign, toSend, scheduledAt, runId)
      : await sendBatched(campaign, toSend, runId);

    const finalStatus = outcome.anySucceeded
      ? scheduledAt
        ? "scheduled"
        : "sent"
      : outcome.anyFailed
        ? "failed"
        : scheduledAt
          ? "scheduled"
          : "sent";

    await db
      .update(campaigns)
      .set({
        status: finalStatus,
        ...(scheduledAt ? {} : { sentAt: new Date() }),
      })
      .where(eq(campaigns.id, campaign.id));
  } catch (error) {
    console.error("Campaign send failed", error);
    await db
      .update(campaigns)
      .set({ status: "failed" })
      .where(eq(campaigns.id, campaignId));
  }
}

// Immediate sends use the batch endpoint: 100 emails per request.
async function sendBatched(
  campaign: Campaign,
  toSend: Recipient[],
  runId: string
) {
  let sentCount = campaign.sentCount;
  let anySucceeded = sentCount > 0;
  let anyFailed = false;

  for (let i = 0; i < toSend.length; i += BATCH_SIZE) {
    const chunk = toSend.slice(i, i + BATCH_SIZE);
    const payload = chunk.map((r) => buildPayload(campaign, r, null));
    const chunkIndex = Math.floor(i / BATCH_SIZE);

    let lastError: string | null = null;
    let results: { id: string }[] | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const { data, error } = await getResend().batch.send(payload, {
        idempotencyKey: `campaign-${campaign.id}-${runId}-chunk-${chunkIndex}`,
      });

      if (!error && data) {
        results = data.data;
        break;
      }

      lastError = error?.message ?? "Unknown Resend error";
      await sleep(1000 * 2 ** attempt);
    }

    if (results) {
      // The batch response returns email IDs in request order
      for (let j = 0; j < chunk.length; j++) {
        await db
          .update(recipients)
          .set({ status: "sent", resendEmailId: results[j]?.id ?? null })
          .where(eq(recipients.id, chunk[j].id));
      }
      sentCount += chunk.length;
      anySucceeded = true;
      await db
        .update(campaigns)
        .set({ sentCount })
        .where(eq(campaigns.id, campaign.id));
    } else {
      anyFailed = true;
      await db
        .update(recipients)
        .set({ status: "failed", error: lastError })
        .where(
          inArray(
            recipients.id,
            chunk.map((r) => r.id)
          )
        );
    }

    if (i + BATCH_SIZE < toSend.length) {
      await sleep(DELAY_BETWEEN_BATCHES_MS);
    }
  }

  return { anySucceeded, anyFailed };
}

// Scheduled sends go one at a time: Resend's batch endpoint does not
// support scheduled_at. Rate-limited to stay under 2 requests/second.
async function sendIndividually(
  campaign: Campaign,
  toSend: Recipient[],
  scheduledAt: Date,
  runId: string
) {
  let scheduledCount = 0;
  let anyFailed = false;

  for (let i = 0; i < toSend.length; i++) {
    const r = toSend[i];
    const payload = buildPayload(campaign, r, scheduledAt);

    let lastError: string | null = null;
    let emailId: string | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const { data, error } = await getResend().emails.send(payload, {
        idempotencyKey: `campaign-${campaign.id}-${runId}-r-${r.id}`,
      });

      if (!error && data) {
        emailId = data.id;
        break;
      }

      lastError = error?.message ?? "Unknown Resend error";
      await sleep(1000 * 2 ** attempt);
    }

    if (emailId) {
      scheduledCount++;
      await db
        .update(recipients)
        .set({ status: "scheduled", resendEmailId: emailId })
        .where(eq(recipients.id, r.id));
      await db
        .update(campaigns)
        .set({ sentCount: campaign.sentCount + scheduledCount })
        .where(eq(campaigns.id, campaign.id));
    } else {
      anyFailed = true;
      await db
        .update(recipients)
        .set({ status: "failed", error: lastError })
        .where(eq(recipients.id, r.id));
    }

    if (i < toSend.length - 1) {
      await sleep(DELAY_BETWEEN_SINGLE_SENDS_MS);
    }
  }

  return { anySucceeded: scheduledCount > 0, anyFailed };
}
