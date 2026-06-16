import { and, asc, eq, gt, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
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
import { findBouncedAddresses } from "@/lib/gmailBounce";
import {
  getAccessTokenForSender,
  getSenderAccount,
  getValidAccessToken,
  hasSendScope,
} from "@/lib/google";
import { writeStatusColumn } from "@/lib/sheets";
import {
  computeStaggeredTimes,
  computeStaggeredTimesByZone,
  type StaggerConfig,
} from "@/lib/stagger";
import { getSenderCommitments } from "@/lib/senderBudget";
import { capForDayFn, WARMUP_WINDOW_DAYS } from "@/lib/warmup";
import { tzDateKey, tzOffsetMinutes } from "@/lib/timezone";
import { resolveRecipientZone } from "@/lib/geo";
import { DEFAULT_FROM_ADDRESS, emailFromAddress } from "@/lib/senders";
import { cancelScheduledForEmail } from "@/lib/suppress";

// "delivered"/"opened"/"clicked" are Resend-era statuses kept so historical
// recipients still get follow-ups and reply detection.
const ACTIVE_STATUSES = ["sent", "delivered", "opened", "clicked"] as const;

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

type Recipient = typeof recipients.$inferSelect;
type Campaign = typeof campaigns.$inferSelect;
type SequenceStep = typeof sequenceSteps.$inferSelect;

export type ProcessResult = {
  repliesFound: number;
  bouncesFound: number;
  followUpsSent: number;
  sheetsSynced: number;
  errors: string[];
};

/** Effective sender mailbox for a campaign. */
function senderOf(campaign: Campaign): string {
  return emailFromAddress(campaign.fromAddress ?? DEFAULT_FROM_ADDRESS);
}

/**
 * One pass of background work for a user:
 * 1. Detect replies in each SENDER's own Gmail inbox (not just the campaign
 *    owner's); mark recipients replied and cancel queued follow-ups to them.
 * 2. Detect bounces from mailer-daemon reports in each sender's inbox;
 *    suppress the addresses.
 * 3. Schedule any due follow-up steps through the same drip rules (window,
 *    gap, per-sender daily cap, weekends, warm-up). Actual sending happens
 *    in the dispatcher.
 * 4. Sync recipient statuses back into each campaign's Google Sheet.
 */
export async function processUser(userId: string): Promise<ProcessResult> {
  const result: ProcessResult = {
    repliesFound: 0,
    bouncesFound: 0,
    followUpsSent: 0,
    sheetsSynced: 0,
    errors: [],
  };

  // Owner token: used for sheet write-back and as a degraded fallback for
  // reply detection when a sender's own token is unavailable.
  let ownerToken: string;
  try {
    ownerToken = await getValidAccessToken(userId);
  } catch (e) {
    result.errors.push(e instanceof Error ? e.message : "Google auth failed");
    return result;
  }

  // Reconcile stuck sends: a "sending" campaign whose heartbeat has gone
  // stale means scheduling died mid-run. Flip it to "failed" so the Retry
  // button works again - per-recipient state is tracked, so retrying resumes
  // safely.
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

  const campaignById = new Map(userCampaigns.map((c) => [c.id, c]));

  // Cache of sender mailbox -> access token (or null when unavailable)
  const senderTokens = new Map<string, string | null>();
  async function tokenForSender(sender: string): Promise<string | null> {
    if (senderTokens.has(sender)) return senderTokens.get(sender)!;
    try {
      const token = await getAccessTokenForSender(sender);
      senderTokens.set(sender, token);
      return token;
    } catch (e) {
      result.errors.push(e instanceof Error ? e.message : String(e));
      senderTokens.set(sender, null);
      return null;
    }
  }

  // --- 1. Reply detection, per sender inbox -------------------------------
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

    // Replies land in the inbox of the mailbox the email was sent from, so
    // group recipients by sender and check each sender's own inbox.
    const bySender = new Map<string, Recipient[]>();
    for (const r of active) {
      const campaign = campaignById.get(r.campaignId);
      if (!campaign) continue;
      const sender = senderOf(campaign);
      const list = bySender.get(sender);
      if (list) list.push(r);
      else bySender.set(sender, [r]);
    }

    for (const [sender, group] of bySender) {
      // Degrade to the owner's inbox if the sender's token is unavailable -
      // catches nothing for other mailboxes but is better than skipping.
      const token = (await tokenForSender(sender)) ?? ownerToken;

      const uniqueEmails = [...new Set(group.map((r) => r.email))];
      if (uniqueEmails.length === 0) continue;
      const replies = await findRepliesFrom(token, uniqueEmails);

      for (const r of group) {
        const reply = replies.get(r.email.toLowerCase());
        if (!reply) continue;
        const repliedAt = reply.at;
        // A queued follow-up (scheduled with a prior step already sent): any
        // reply seen now is new - earlier replies would have been caught
        // while the recipient was still in a sent state - so cancel it.
        const isQueuedFollowup = r.status === "scheduled" && r.sequenceStep > 0;
        // An initial scheduled send hasn't actually emailed them yet; don't
        // act on pre-existing inbox mail.
        if (r.status === "scheduled" && !isQueuedFollowup) continue;
        // For already-sent mail, only count replies that arrived after we
        // emailed them.
        if (!isQueuedFollowup && !(r.lastEmailAt && repliedAt > r.lastEmailAt)) {
          continue;
        }
        // Scheduling is DB-backed: clearing scheduledFor IS the cancellation.
        // Capture the reply content so it can be read in-app.
        await db
          .update(recipients)
          .set({
            repliedAt,
            status: "replied",
            scheduledFor: null,
            dispatchClaimedAt: null,
            replySnippet: reply.snippet || null,
            replySubject: reply.subject || null,
            replyMessageId: reply.messageId || null,
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

  // --- 2. Bounce detection from mailer-daemon reports ----------------------
  try {
    const recentCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentlySent = await db
      .select()
      .from(recipients)
      .where(
        and(
          inArray(recipients.campaignId, campaignIds),
          eq(recipients.status, "sent"),
          gt(recipients.lastEmailAt, recentCutoff)
        )
      );

    const bySender = new Map<string, Recipient[]>();
    for (const r of recentlySent) {
      const campaign = campaignById.get(r.campaignId);
      if (!campaign) continue;
      const sender = senderOf(campaign);
      const list = bySender.get(sender);
      if (list) list.push(r);
      else bySender.set(sender, [r]);
    }

    for (const [sender, group] of bySender) {
      const token = await tokenForSender(sender);
      if (!token) continue; // bounce reports only exist in the sender's inbox

      const bounces = await findBouncedAddresses(token);
      if (bounces.size === 0) continue;

      for (const r of group) {
        if (!bounces.has(r.email.toLowerCase())) continue;
        await db
          .update(recipients)
          .set({ status: "bounced" })
          .where(and(eq(recipients.id, r.id), eq(recipients.status, "sent")));
        await db
          .insert(unsubscribes)
          .values({
            email: r.email.toLowerCase(),
            userId,
            source: "bounce",
          })
          .onConflictDoNothing();
        await cancelScheduledForEmail(r.email);
        result.bouncesFound++;
      }
    }
  } catch (e) {
    result.errors.push(e instanceof Error ? e.message : "Bounce check failed");
  }

  // --- 3. Due follow-ups, queued via the drip rules ------------------------
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
        // Absolute schedule (same instant for everyone) overrides the relative
        // "N days after the previous email" delay.
        const dueAt = nextStep.scheduledAt
          ? nextStep.scheduledAt.getTime()
          : r.lastEmailAt!.getTime() + nextStep.delayDays * 24 * 60 * 60 * 1000;
        if (dueAt > now) continue;
        due.push({ campaign, step: nextStep, recipient: r });
      }
    }

    if (due.length > 0) {
      // Group by effective sender so the daily cap spans campaigns per mailbox.
      const bySender = new Map<string, Due[]>();
      for (const d of due) {
        const sender = senderOf(d.campaign);
        const list = bySender.get(sender);
        if (list) list.push(d);
        else bySender.set(sender, [d]);
      }

      for (const [sender, items] of bySender) {
        // The dispatcher will need this sender's token; surface the problem
        // now instead of queueing follow-ups that can never send.
        const acct = await getSenderAccount(sender);
        if (!acct || !hasSendScope(acct.scope)) {
          result.errors.push(
            `Follow-ups for ${sender} paused — Google not connected with send access.`
          );
          continue;
        }

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
        // Recipient-local scheduling sorts east-to-west and places each in its
        // own timezone window; otherwise a single window in cfg.timeZone.
        let order = items;
        let times: Date[];
        if (cfg.perRecipientTimeZone) {
          const withTz = items.map((it) => ({
            it,
            tz: resolveRecipientZone(it.recipient.rowData, cfg.timeZone),
          }));
          withTz.sort((a, b) => tzOffsetMinutes(b.tz) - tzOffsetMinutes(a.tz));
          order = withTz.map((x) => x.it);
          times = computeStaggeredTimesByZone(
            withTz.map((x) => x.tz),
            new Date(),
            cfg,
            { committedByDay: byDay, capForDay }
          );
        } else {
          times = computeStaggeredTimes(items.length, new Date(), cfg, {
            committedByDay: byDay,
            capForDay,
          });
        }
        // Running tally so the per-sender cap is hard-enforced at queue time.
        const committed = new Map(byDay);

        for (let i = 0; i < order.length; i++) {
          const { step, recipient: r } = order[i];
          const at = times[i];

          // Cap guard: if this day is already full (e.g. a concurrent send
          // filled it), leave the follow-up for the next run.
          const dayKey = tzDateKey(at, cfg.timeZone);
          if ((committed.get(dayKey) ?? 0) >= capForDay(dayKey)) continue;

          // Queue it; the dispatcher renders and sends when the time comes.
          // Once status is "scheduled" the row no longer matches the
          // candidate query, so overlapping processor runs can't double-queue.
          committed.set(dayKey, (committed.get(dayKey) ?? 0) + 1);
          await db
            .update(recipients)
            .set({
              sequenceStep: step.stepNumber,
              lastEmailAt: at,
              scheduledFor: at,
              status: "scheduled",
            })
            .where(eq(recipients.id, r.id));
          result.followUpsSent++;
        }
      }
    }
  } catch (e) {
    result.errors.push(e instanceof Error ? e.message : "Follow-ups failed");
  }

  // --- 4. Sheet write-back ------------------------------------------------
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
        ownerToken,
        campaign.sheetId,
        rows.map((r) => ({
          row: r.sheetRow!,
          status:
            r.sequenceStep > 0
              ? `${r.status} (step ${r.sequenceStep})`
              : r.status,
        })),
        campaign.sheetTab
      );
      result.sheetsSynced++;
    }
  } catch (e) {
    result.errors.push(e instanceof Error ? e.message : "Sheet sync failed");
  }

  return result;
}
