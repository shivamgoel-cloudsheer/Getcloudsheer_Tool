import { after } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/db";
import {
  campaigns,
  recipients,
  unsubscribes,
  type StoredStaggerConfig,
} from "@/db/schema";
import { getResend } from "@/lib/resend";
import { buildEmailBodies, renderTemplate } from "@/lib/template";
import { isValidTimeZone, tzDateKey } from "@/lib/timezone";
import { computeStaggeredTimes, type StaggerConfig } from "@/lib/stagger";
import { getSenderCommitments } from "@/lib/senderBudget";
import { capForDayFn, WARMUP_WINDOW_DAYS } from "@/lib/warmup";
import { mailingAddressFor, replyToFor, signatureFor } from "@/lib/senders";

export const maxDuration = 300;

// Hard ceiling on the per-sender daily cap. Drip-only sending means every
// campaign goes out spread over time within this limit.
export const MAX_DAILY_CAP = 100;

const DELAY_BETWEEN_SINGLE_SENDS_MS = 600;
const MAX_RETRIES = 3;

const MIN_SCHEDULE_AHEAD_MS = 2 * 60 * 1000;
const MAX_SCHEDULE_AHEAD_MS = 30 * 24 * 60 * 60 * 1000;

// Applied when a send request arrives without explicit drip settings, so
// nothing ever goes out as an immediate burst.
const DEFAULT_STAGGER: StaggerConfig = {
  gapMinutes: 3,
  dailyCap: 40,
  windowStart: "09:00",
  windowEnd: "17:00",
  skipWeekends: true,
  timeZone: "UTC",
  warmup: true,
};

const bodySchema = z.object({
  // Optional drip start time. It becomes the BASE of the stagger, not a single
  // instant everyone is sent at - so the per-sender cap always applies.
  scheduledAt: z.string().datetime({ offset: true }).optional(),
  // Drip settings: spread sends out instead of one burst (the only send mode)
  stagger: z
    .object({
      gapMinutes: z.number().min(1).max(240),
      dailyCap: z.number().int().min(1).max(MAX_DAILY_CAP),
      windowStart: z.string().regex(/^\d{2}:\d{2}$/),
      windowEnd: z.string().regex(/^\d{2}:\d{2}$/),
      skipWeekends: z.boolean(),
      timeZone: z.string(),
      warmup: z.boolean().optional(),
    })
    .optional(),
});

function toStored(cfg: StaggerConfig): StoredStaggerConfig {
  return {
    gapMinutes: cfg.gapMinutes,
    dailyCap: cfg.dailyCap,
    windowStart: cfg.windowStart,
    windowEnd: cfg.windowEnd,
    skipWeekends: cfg.skipWeekends,
    timeZone: cfg.timeZone,
    warmup: cfg.warmup ?? true,
  };
}

// Every send is a drip. The only choice is when it starts and on what terms.
type ScheduleConfig = { base: Date; cfg: StaggerConfig };

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

  // Refuse to send while the footer still has an unfilled placeholder address
  // (CAN-SPAM needs a real one). Read-only check; the atomic guard below still
  // enforces ownership and state.
  const [existing] = await db
    .select({ fromAddress: campaigns.fromAddress })
    .from(campaigns)
    .where(and(eq(campaigns.id, id), eq(campaigns.userId, session.user.id)));
  if (existing && /\[.+\]/.test(mailingAddressFor(existing.fromAddress))) {
    return Response.json(
      {
        error:
          "Add a real postal address before sending - the footer still contains a [PLACEHOLDER]. Edit src/lib/senders.ts or set MAILING_ADDRESS.",
      },
      { status: 400 }
    );
  }

  const raw = await request.text();
  const parsed = bodySchema.safeParse(raw ? JSON.parse(raw) : {});
  if (!parsed.success) {
    return Response.json({ error: "Invalid schedule input" }, { status: 400 });
  }

  // Every path resolves to a drip: only the base time and the config differ.
  let base = new Date();
  let cfg: StaggerConfig = DEFAULT_STAGGER;

  if (parsed.data.stagger) {
    cfg = parsed.data.stagger;
    if (!isValidTimeZone(cfg.timeZone)) {
      return Response.json({ error: "Invalid timezone" }, { status: 400 });
    }
    if (cfg.windowStart >= cfg.windowEnd) {
      return Response.json(
        { error: "Send window start must be before its end" },
        { status: 400 }
      );
    }
    if (parsed.data.scheduledAt) base = new Date(parsed.data.scheduledAt);
  } else if (parsed.data.scheduledAt) {
    // A bare scheduledAt is the drip's start time, not everyone's send time.
    const at = new Date(parsed.data.scheduledAt);
    const ahead = at.getTime() - Date.now();
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
    base = at;
  }

  const schedule: ScheduleConfig = { base, cfg };
  const displayTime = base;
  // Persisted so background follow-ups drip on the same terms as the send.
  const storedConfig: StoredStaggerConfig = toStored(cfg);

  // Atomic guard: only a draft or previously failed campaign can start.
  const [campaign] = await db
    .update(campaigns)
    .set({
      status: "sending",
      scheduledAt: displayTime,
      staggerConfig: storedConfig,
      lastProgressAt: new Date(),
    })
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

  // Respond immediately; the drip scheduling continues after the response.
  after(() => runSend(campaign.id, schedule));

  return Response.json({ status: "scheduling" }, { status: 202 });
}

type Recipient = typeof recipients.$inferSelect;
type Campaign = typeof campaigns.$inferSelect;

function templatesFor(campaign: Campaign, r: Recipient) {
  if (r.variant === "B") {
    return {
      subject: campaign.subjectTemplateB || campaign.subjectTemplate,
      body: campaign.bodyTemplateB || campaign.bodyTemplate,
    };
  }
  return { subject: campaign.subjectTemplate, body: campaign.bodyTemplate };
}

function buildPayload(
  campaign: Campaign,
  r: Recipient,
  scheduledAt: Date | null
) {
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const from = campaign.fromAddress ?? process.env.RESEND_FROM!;
  // Replies go back to the address the email was sent from.
  const replyTo = replyToFor(campaign.fromAddress);
  const unsubscribeUrl = `${appUrl}/u/${r.unsubscribeToken}`;
  const templates = templatesFor(campaign, r);
  const subject = renderTemplate(templates.subject, r.rowData);
  const renderedBody = renderTemplate(templates.body, r.rowData);
  // Plain-text only and no List-Unsubscribe headers: cold 1:1 mail lands in
  // Primary, not Promotions. The opt-out is the plain footer link (still
  // automated via the suppression list); the postal address stays for CAN-SPAM.
  const { text } = buildEmailBodies(
    renderedBody,
    unsubscribeUrl,
    mailingAddressFor(campaign.fromAddress),
    campaign.signature ?? signatureFor(campaign.fromAddress)
  );

  return {
    from,
    to: [r.email],
    replyTo,
    subject,
    text,
    ...(scheduledAt ? { scheduledAt: scheduledAt.toISOString() } : {}),
    tags: [
      { name: "recipient_id", value: r.id },
      { name: "campaign_id", value: campaign.id },
      { name: "variant", value: r.variant },
      { name: "step", value: "0" },
    ],
  };
}

async function runSend(campaignId: string, schedule: ScheduleConfig) {
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

    const outcome = await sendIndividually(campaign, toSend, schedule, runId);

    const finalStatus = outcome.anyFailed && !outcome.anySucceeded
      ? "failed"
      : "scheduled";

    await db
      .update(campaigns)
      .set({ status: finalStatus })
      .where(eq(campaigns.id, campaign.id));
  } catch (error) {
    console.error("Campaign send failed", error);
    await db
      .update(campaigns)
      .set({ status: "failed" })
      .where(eq(campaigns.id, campaignId));
  }
}

// Every send is staggered and goes through Resend's scheduled_at one email at
// a time (the batch endpoint does not support scheduled_at). Rate-limited to
// stay under 2 requests/second.
async function sendIndividually(
  campaign: Campaign,
  toSend: Recipient[],
  schedule: ScheduleConfig,
  runId: string
) {
  let scheduledCount = 0;
  let anyFailed = false;

  const MAX_HORIZON_MS = 29 * 24 * 60 * 60 * 1000;
  const cfg = schedule.cfg;

  // Per-sender daily budget: count what this mailbox has already committed
  // across all campaigns so two campaigns can't double its daily volume.
  const sender = campaign.fromAddress ?? process.env.RESEND_FROM ?? "";
  const { byDay, firstSendAt } = await getSenderCommitments(
    campaign.userId,
    sender,
    cfg.timeZone
  );
  const startDayKey = tzDateKey(firstSendAt ?? new Date(), cfg.timeZone);
  const warm =
    firstSendAt != null &&
    Date.now() - firstSendAt.getTime() >
      WARMUP_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const capForDay = capForDayFn(
    cfg.dailyCap,
    cfg.warmup ?? false,
    startDayKey,
    warm
  );
  const staggerTimes = computeStaggeredTimes(toSend.length, schedule.base, cfg, {
    committedByDay: byDay,
    capForDay,
  });

  // Running per-day tally (seeded from existing commitments) so the cap is
  // hard-enforced right before each send, not only inside the allocator.
  const committed = new Map(byDay);

  // Show the real first send time, not the requested base time - the
  // send window may have rolled it forward
  if (staggerTimes.length > 0) {
    await db
      .update(campaigns)
      .set({ scheduledAt: staggerTimes[0] })
      .where(eq(campaigns.id, campaign.id));
  }

  for (let i = 0; i < toSend.length; i++) {
    const r = toSend[i];
    // Heartbeat so the cron reconciler can tell a live run from a dead one.
    if (i % 15 === 0) {
      await db
        .update(campaigns)
        .set({ lastProgressAt: new Date() })
        .where(eq(campaigns.id, campaign.id));
    }
    const at = staggerTimes[i];

    if (at.getTime() > Date.now() + MAX_HORIZON_MS) {
      anyFailed = true;
      await db
        .update(recipients)
        .set({
          status: "failed",
          error:
            "Beyond Resend's 30-day scheduling window. Raise the daily cap or shorten the gap.",
        })
        .where(eq(recipients.id, r.id));
      continue;
    }

    // Hard cap guard: never exceed the sender's daily budget for this day,
    // even if a concurrent campaign filled it after times were computed.
    const dayKey = tzDateKey(at, cfg.timeZone);
    if ((committed.get(dayKey) ?? 0) >= capForDay(dayKey)) {
      anyFailed = true;
      await db
        .update(recipients)
        .set({
          status: "failed",
          error: `Daily cap for this sender reached on ${dayKey}. Lower volume, widen the window, or split senders.`,
        })
        .where(eq(recipients.id, r.id));
      continue;
    }

    const payload = buildPayload(campaign, r, at);

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
      committed.set(dayKey, (committed.get(dayKey) ?? 0) + 1);
      await db
        .update(recipients)
        .set({ status: "scheduled", resendEmailId: emailId, lastEmailAt: at })
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
