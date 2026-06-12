import { after } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/db";
import {
  campaigns,
  recipients,
  unsubscribes,
  type StoredStaggerConfig,
} from "@/db/schema";
import { isValidTimeZone, tzDateKey, tzOffsetMinutes } from "@/lib/timezone";
import {
  computeStaggeredTimes,
  computeStaggeredTimesByZone,
  type StaggerConfig,
} from "@/lib/stagger";
import { resolveRecipientZone } from "@/lib/geo";
import { getSenderCommitments } from "@/lib/senderBudget";
import { capForDayFn, WARMUP_WINDOW_DAYS } from "@/lib/warmup";
import { DEFAULT_FROM_ADDRESS, emailFromAddress } from "@/lib/senders";
import {
  getSenderAccount,
  hasSendScope,
} from "@/lib/google";
import { dispatchDue } from "@/lib/dispatch";

export const maxDuration = 300;

// Hard ceiling on the per-sender daily cap. Drip-only sending means every
// campaign goes out spread over time within this limit.
export const MAX_DAILY_CAP = 100;

const MIN_SCHEDULE_AHEAD_MS = 2 * 60 * 1000;

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
      perRecipientTimeZone: z.boolean().optional(),
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
    perRecipientTimeZone: cfg.perRecipientTimeZone ?? false,
  };
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
    if (at.getTime() - Date.now() < MIN_SCHEDULE_AHEAD_MS) {
      return Response.json(
        { error: "Schedule at least 2 minutes in the future" },
        { status: 400 }
      );
    }
    base = at;
  }

  // Sends go out through the sender's own Gmail, so the sender mailbox must
  // be linked with send permission before anything is scheduled.
  const [precheck] = await db
    .select({ fromAddress: campaigns.fromAddress })
    .from(campaigns)
    .where(and(eq(campaigns.id, id), eq(campaigns.userId, session.user.id)));
  if (!precheck) {
    return Response.json({ error: "Campaign not found" }, { status: 404 });
  }
  const senderEmail = emailFromAddress(
    precheck.fromAddress ?? DEFAULT_FROM_ADDRESS
  );
  const senderAccount = await getSenderAccount(senderEmail);
  if (!senderAccount) {
    return Response.json(
      {
        error: `${senderEmail} hasn't connected Google yet — have them sign in to the dashboard once.`,
      },
      { status: 400 }
    );
  }
  if (!hasSendScope(senderAccount.scope)) {
    return Response.json(
      {
        error: `${senderEmail} needs to re-connect Google to grant send permission (sign out and sign in again).`,
      },
      { status: 400 }
    );
  }

  const storedConfig: StoredStaggerConfig = toStored(cfg);

  // Atomic guard: only a draft or previously failed campaign can start.
  const [campaign] = await db
    .update(campaigns)
    .set({
      status: "sending",
      scheduledAt: base,
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

  // Scheduling is now a pure DB write (no per-email API calls), so it runs
  // inline and the response reports the real outcome.
  try {
    const outcome = await scheduleSend(campaign.id, { base, cfg });

    const finalStatus =
      outcome.scheduled === 0 && outcome.failed > 0 ? "failed" : "scheduled";
    await db
      .update(campaigns)
      .set({ status: finalStatus })
      .where(eq(campaigns.id, campaign.id));

    // Pick up any immediately-due rows without waiting for the next cron ping
    if (outcome.scheduled > 0) {
      after(() => dispatchDue());
    }

    return Response.json(
      { status: finalStatus, ...outcome },
      { status: finalStatus === "failed" ? 422 : 200 }
    );
  } catch (error) {
    console.error("Campaign scheduling failed", error);
    await db
      .update(campaigns)
      .set({ status: "failed" })
      .where(eq(campaigns.id, campaign.id));
    return Response.json({ error: "Scheduling failed" }, { status: 500 });
  }
}

type ScheduleConfig = { base: Date; cfg: StaggerConfig };

async function scheduleSend(campaignId: string, schedule: ScheduleConfig) {
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, campaignId));
  if (!campaign) return { scheduled: 0, suppressed: 0, failed: 0 };

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
  if (toSend.length === 0) {
    return { scheduled: 0, suppressed: toSuppress.length, failed: 0 };
  }

  const cfg = schedule.cfg;

  // Per-sender daily budget: count what this mailbox has already committed
  // across all campaigns so two campaigns can't double its daily volume.
  const sender = campaign.fromAddress ?? DEFAULT_FROM_ADDRESS;
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

  // Send order + per-recipient times. With per-recipient timezones we sort
  // east-to-west so each lands in their local morning and the clock advances
  // monotonically; otherwise keep the original order.
  let order = toSend;
  let staggerTimes: Date[];
  if (cfg.perRecipientTimeZone) {
    const withTz = toSend.map((r) => ({
      r,
      tz: resolveRecipientZone(r.rowData, cfg.timeZone),
    }));
    withTz.sort((a, b) => tzOffsetMinutes(b.tz) - tzOffsetMinutes(a.tz));
    order = withTz.map((x) => x.r);
    staggerTimes = computeStaggeredTimesByZone(
      withTz.map((x) => x.tz),
      schedule.base,
      cfg,
      { committedByDay: byDay, capForDay }
    );
  } else {
    staggerTimes = computeStaggeredTimes(toSend.length, schedule.base, cfg, {
      committedByDay: byDay,
      capForDay,
    });
  }

  // Hard cap guard: re-tally per day (seeded from existing commitments) so a
  // concurrent campaign can't overfill a day after times were computed.
  const committed = new Map(byDay);
  const okIds: string[] = [];
  const okTimes: string[] = [];
  const cappedIds: string[] = [];

  for (let i = 0; i < order.length; i++) {
    const at = staggerTimes[i];
    const dayKey = tzDateKey(at, cfg.timeZone);
    if ((committed.get(dayKey) ?? 0) >= capForDay(dayKey)) {
      cappedIds.push(order[i].id);
      continue;
    }
    committed.set(dayKey, (committed.get(dayKey) ?? 0) + 1);
    okIds.push(order[i].id);
    okTimes.push(at.toISOString());
  }

  if (cappedIds.length > 0) {
    await db
      .update(recipients)
      .set({
        status: "failed",
        error:
          "Daily cap for this sender reached. Lower volume, widen the window, or split senders.",
      })
      .where(inArray(recipients.id, cappedIds));
  }

  if (okIds.length > 0) {
    // lastEmailAt = scheduled time mirrors the previous behavior so the
    // senderBudget day-bucketing keeps working; the dispatcher overwrites it
    // with the actual send time.
    await db.execute(sql`
      UPDATE recipient AS r
      SET status = 'scheduled',
          scheduled_for = v.at,
          last_email_at = v.at
      FROM (
        SELECT unnest(${okIds}::uuid[]) AS id,
               unnest(${okTimes}::timestamptz[]) AS at
      ) v
      WHERE r.id = v.id
    `);

    // Show the real first send time - the window may have rolled it forward
    await db
      .update(campaigns)
      .set({ scheduledAt: new Date(okTimes[0]) })
      .where(eq(campaigns.id, campaign.id));
  }

  return {
    scheduled: okIds.length,
    suppressed: toSuppress.length,
    failed: cappedIds.length,
  };
}
