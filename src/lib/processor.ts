import { and, asc, eq, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import { db } from "@/db";
import {
  campaigns,
  recipients,
  sequenceSteps,
  unsubscribes,
  users,
  type StoredStaggerConfig,
} from "@/db/schema";
import { findRepliesFrom } from "@/lib/gmail";
import { getValidAccessToken } from "@/lib/google";
import { getResend } from "@/lib/resend";
import { writeStatusColumn } from "@/lib/sheets";
import { buildEmailBodies, renderTemplate } from "@/lib/template";
import { computeStaggeredTimes, type StaggerConfig } from "@/lib/stagger";
import { getSenderCommitments } from "@/lib/senderBudget";
import { capForDayFn, WARMUP_WINDOW_DAYS } from "@/lib/warmup";
import { tzDateKey } from "@/lib/timezone";
import { mailingAddressFor, replyToFor, signatureFor } from "@/lib/senders";

const ACTIVE_STATUSES = ["sent", "delivered", "opened", "clicked"] as const;
const DELAY_BETWEEN_SENDS_MS = 600;
const MAX_HORIZON_MS = 29 * 24 * 60 * 60 * 1000;

// Follow-up drip defaults, used when a campaign has no stored stagger config.
const DEFAULT_STAGGER: StaggerConfig = {
  gapMinutes: 3,
  dailyCap: 40,
  windowStart: "09:00",
  windowEnd: "17:00",
  skipWeekends: true,
  timeZone: "UTC",
  warmup: true,
};

function staggerFrom(stored: StoredStaggerConfig | null): StaggerConfig {
  return stored ? { ...stored } : DEFAULT_STAGGER;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Recipient = typeof recipients.$inferSelect;
type Campaign = typeof campaigns.$inferSelect;
type SequenceStep = typeof sequenceSteps.$inferSelect;

export type ProcessResult = {
  repliesFound: number;
  followUpsSent: number;
  sheetsSynced: number;
  errors: string[];
};

/**
 * One pass of background work for a user:
 * 1. Detect replies in Gmail; mark recipients replied and cancel any
 *    still-scheduled follow-up to them.
 * 2. Schedule any due follow-up steps through the same drip rules (window,
 *    gap, per-sender daily cap, weekends, warm-up).
 * 3. Sync recipient statuses back into each campaign's Google Sheet.
 */
export async function processUser(userId: string): Promise<ProcessResult> {
  const result: ProcessResult = {
    repliesFound: 0,
    followUpsSent: 0,
    sheetsSynced: 0,
    errors: [],
  };

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(userId);
  } catch (e) {
    result.errors.push(e instanceof Error ? e.message : "Google auth failed");
    return result;
  }

  // Reconcile stuck sends: a "sending" campaign whose heartbeat has gone stale
  // means its background job was killed mid-run (typically a function timeout
  // on a large drip). Flip it to "failed" so the Retry button works again -
  // per-recipient state is tracked, so retrying resumes safely.
  const STALE_SENDING_MS = 10 * 60 * 1000;
  await db
    .update(campaigns)
    .set({ status: "failed" })
    .where(
      and(
        eq(campaigns.userId, userId),
        eq(campaigns.status, "sending"),
        or(
          isNull(campaigns.lastProgressAt),
          lt(campaigns.lastProgressAt, new Date(Date.now() - STALE_SENDING_MS))
        )
      )
    );

  const userCampaigns = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.userId, userId));
  const campaignIds = userCampaigns.map((c) => c.id);
  if (campaignIds.length === 0) return result;

  // --- 1. Reply detection -------------------------------------------------
  try {
    // Includes "scheduled" recipients (a queued follow-up) so a reply can
    // cancel that follow-up before it goes out.
    const active = await db
      .select()
      .from(recipients)
      .where(
        and(
          inArray(recipients.campaignId, campaignIds),
          inArray(recipients.status, [...ACTIVE_STATUSES, "scheduled"]),
          isNull(recipients.repliedAt),
          isNotNull(recipients.lastEmailAt)
        )
      );

    const uniqueEmails = [...new Set(active.map((r) => r.email))];
    if (uniqueEmails.length > 0) {
      const replies = await findRepliesFrom(accessToken, uniqueEmails);
      for (const r of active) {
        const repliedAt = replies.get(r.email.toLowerCase());
        if (!repliedAt) continue;
        // A queued follow-up (scheduled with a prior step already sent): any
        // reply seen now is new - earlier replies would have been caught while
        // the recipient was still in a sent/delivered state - so cancel it.
        const isQueuedFollowup = r.status === "scheduled" && r.sequenceStep > 0;
        // An initial scheduled send hasn't actually emailed them yet; don't
        // act on pre-existing inbox mail.
        if (r.status === "scheduled" && !isQueuedFollowup) continue;
        // For already-sent mail, only count replies that arrived after we
        // emailed them.
        if (!isQueuedFollowup && !(r.lastEmailAt && repliedAt > r.lastEmailAt)) {
          continue;
        }
        if (isQueuedFollowup && r.resendEmailId) {
          try {
            await getResend().emails.cancel(r.resendEmailId);
          } catch (e) {
            console.error("Failed to cancel follow-up on reply", e);
          }
        }
        await db
          .update(recipients)
          .set({
            repliedAt,
            status: "replied",
            ...(isQueuedFollowup ? { resendEmailId: null } : {}),
          })
          .where(eq(recipients.id, r.id));
        result.repliesFound++;
      }
    }
    await db
      .update(users)
      .set({ lastReplyCheckAt: new Date() })
      .where(eq(users.id, userId));
  } catch (e) {
    result.errors.push(e instanceof Error ? e.message : "Reply check failed");
  }

  // --- 2. Due follow-ups, scheduled via the drip rules --------------------
  try {
    const suppressedEmails = new Set(
      (await db.select({ email: unsubscribes.email }).from(unsubscribes)).map(
        (u) => u.email
      )
    );

    // Collect every due follow-up across the user's active campaigns.
    type Due = { campaign: Campaign; step: SequenceStep; recipient: Recipient };
    const due: Due[] = [];
    const now = Date.now();

    for (const campaign of userCampaigns) {
      if (campaign.status !== "sent" && campaign.status !== "scheduled") {
        continue;
      }

      const steps = await db
        .select()
        .from(sequenceSteps)
        .where(eq(sequenceSteps.campaignId, campaign.id))
        .orderBy(asc(sequenceSteps.stepNumber));
      if (steps.length === 0) continue;

      const candidates = await db
        .select()
        .from(recipients)
        .where(
          and(
            eq(recipients.campaignId, campaign.id),
            inArray(recipients.status, [...ACTIVE_STATUSES]),
            isNull(recipients.repliedAt),
            isNotNull(recipients.lastEmailAt)
          )
        );

      for (const r of candidates) {
        if (suppressedEmails.has(r.email.toLowerCase())) continue;
        const nextStep = steps.find((s) => s.stepNumber === r.sequenceStep + 1);
        if (!nextStep) continue;
        const dueAt =
          r.lastEmailAt!.getTime() + nextStep.delayDays * 24 * 60 * 60 * 1000;
        if (dueAt > now) continue;
        due.push({ campaign, step: nextStep, recipient: r });
      }
    }

    if (due.length > 0) {
      // Group by effective sender so the daily cap spans campaigns per mailbox.
      const fallbackFrom = process.env.RESEND_FROM ?? "";
      const bySender = new Map<string, Due[]>();
      for (const d of due) {
        const sender = d.campaign.fromAddress ?? fallbackFrom;
        const list = bySender.get(sender);
        if (list) list.push(d);
        else bySender.set(sender, [d]);
      }

      const appUrl = process.env.APP_URL ?? "http://localhost:3000";

      for (const [sender, items] of bySender) {
        // Oldest-due first.
        items.sort(
          (a, b) =>
            a.recipient.lastEmailAt!.getTime() -
            b.recipient.lastEmailAt!.getTime()
        );

        // Reuse the drip config the campaign was sent with (sender's first
        // item), so follow-ups match the original cadence.
        const cfg = staggerFrom(items[0].campaign.staggerConfig);
        const { byDay, firstSendAt } = await getSenderCommitments(
          userId,
          sender,
          cfg.timeZone
        );
        const startDayKey = tzDateKey(firstSendAt ?? new Date(), cfg.timeZone);
        const warm =
          firstSendAt != null &&
          now - firstSendAt.getTime() >
            WARMUP_WINDOW_DAYS * 24 * 60 * 60 * 1000;
        const capForDay = capForDayFn(
          cfg.dailyCap,
          cfg.warmup ?? false,
          startDayKey,
          warm
        );
        const times = computeStaggeredTimes(items.length, new Date(), cfg, {
          committedByDay: byDay,
          capForDay,
        });

        for (let i = 0; i < items.length; i++) {
          const { campaign, step, recipient: r } = items[i];
          const at = times[i];
          // Past Resend's 30-day window: leave it for a future run.
          if (at.getTime() > now + MAX_HORIZON_MS) continue;

          const unsubscribeUrl = `${appUrl}/u/${r.unsubscribeToken}`;
          const subject = renderTemplate(step.subjectTemplate, r.rowData);
          const body = renderTemplate(step.bodyTemplate, r.rowData);
          // Plain-text, no List-Unsubscribe header (see send route) so
          // follow-ups land in Primary too.
          const { text } = buildEmailBodies(
            body,
            unsubscribeUrl,
            mailingAddressFor(campaign.fromAddress),
            campaign.signature ?? signatureFor(campaign.fromAddress)
          );

          const { data, error } = await getResend().emails.send(
            {
              from: campaign.fromAddress ?? process.env.RESEND_FROM!,
              to: [r.email],
              replyTo: replyToFor(campaign.fromAddress),
              subject,
              text,
              scheduledAt: at.toISOString(),
              tags: [
                { name: "recipient_id", value: r.id },
                { name: "campaign_id", value: campaign.id },
                { name: "variant", value: r.variant },
                { name: "step", value: String(step.stepNumber) },
              ],
            },
            {
              // Stable per (campaign, step, recipient): if the dashboard poll
              // and the cron overlap, Resend collapses them into one send.
              idempotencyKey: `followup-${campaign.id}-s${step.stepNumber}-r${r.id}`,
            }
          );

          if (!error && data) {
            await db
              .update(recipients)
              .set({
                sequenceStep: step.stepNumber,
                lastEmailAt: at,
                status: "scheduled",
                resendEmailId: data.id,
              })
              .where(eq(recipients.id, r.id));
            result.followUpsSent++;
          } else {
            result.errors.push(
              `Follow-up step ${step.stepNumber} failed for "${campaign.name}": ${error?.message ?? "unknown"}`
            );
          }

          await sleep(DELAY_BETWEEN_SENDS_MS);
        }
      }
    }
  } catch (e) {
    result.errors.push(e instanceof Error ? e.message : "Follow-ups failed");
  }

  // --- 3. Sheet write-back ------------------------------------------------
  try {
    for (const campaign of userCampaigns) {
      if (campaign.status === "draft") continue;

      const rows = await db
        .select({
          sheetRow: recipients.sheetRow,
          status: recipients.status,
          sequenceStep: recipients.sequenceStep,
        })
        .from(recipients)
        .where(
          and(
            eq(recipients.campaignId, campaign.id),
            isNotNull(recipients.sheetRow)
          )
        );
      if (rows.length === 0) continue;

      await writeStatusColumn(
        accessToken,
        campaign.sheetId,
        rows.map((r) => ({
          row: r.sheetRow!,
          status:
            r.sequenceStep > 0
              ? `${r.status} (step ${r.sequenceStep})`
              : r.status,
        }))
      );
      result.sheetsSynced++;
    }
  } catch (e) {
    result.errors.push(e instanceof Error ? e.message : "Sheet sync failed");
  }

  return result;
}
