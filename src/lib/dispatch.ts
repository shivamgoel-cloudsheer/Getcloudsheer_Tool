import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { campaigns, recipients, sequenceSteps, unsubscribes } from "@/db/schema";
import {
  sendGmail,
  newRfcMessageId,
  GmailSendError,
} from "@/lib/gmailSend";
import {
  getAccessTokenForSender,
  getValidAccessToken,
  getSenderAccount,
} from "@/lib/google";
import {
  buildEmailBodies,
  renderTemplate,
  templatesFor,
} from "@/lib/template";
import {
  DEFAULT_FROM_ADDRESS,
  emailFromAddress,
  nameFromAddress,
  getSender,
  signatureFor,
} from "@/lib/senders";

export type DispatchResult = {
  claimed: number;
  sent: number;
  failed: number;
  suppressed: number;
  errors: string[];
};

type Recipient = typeof recipients.$inferSelect;

/** Small human-ish pause between sends from the same mailbox. */
function jitter(): Promise<void> {
  return new Promise((r) => setTimeout(r, 1000 + Math.random() * 2000));
}

/**
 * Sends every claimed-and-due recipient through its sender's own Gmail.
 *
 * Rows are claimed with a single-statement UPDATE (one transaction on
 * neon-http) so overlapping cron pings can't double-send; a claim older than
 * 15 minutes is reclaimable since the function maxDuration is 300s.
 */
export async function dispatchDue(limit = 50): Promise<DispatchResult> {
  const result: DispatchResult = {
    claimed: 0,
    sent: 0,
    failed: 0,
    suppressed: 0,
    errors: [],
  };

  const claimedRows = await db.execute<{ id: string }>(sql`
    UPDATE recipient SET dispatch_claimed_at = now()
    WHERE id IN (
      SELECT id FROM recipient
      WHERE status = 'scheduled'
        AND scheduled_for IS NOT NULL
        AND scheduled_for <= now()
        AND (dispatch_claimed_at IS NULL
             OR dispatch_claimed_at < now() - interval '15 minutes')
      ORDER BY scheduled_for
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    AND status = 'scheduled'
    AND (dispatch_claimed_at IS NULL
         OR dispatch_claimed_at < now() - interval '15 minutes')
    RETURNING id
  `);

  const claimedIds = claimedRows.rows.map((r) => r.id);
  result.claimed = claimedIds.length;
  if (claimedIds.length === 0) return result;

  const rows = await db
    .select()
    .from(recipients)
    .where(inArray(recipients.id, claimedIds));

  const campaignIds = [...new Set(rows.map((r) => r.campaignId))];
  const campaignRows = await db
    .select()
    .from(campaigns)
    .where(inArray(campaigns.id, campaignIds));
  const campaignById = new Map(campaignRows.map((c) => [c.id, c]));

  // Last-moment suppression check: an unsubscribe/bounce may have landed
  // after this row was scheduled.
  const suppressedSet = new Set(
    (
      await db
        .select({ email: unsubscribes.email })
        .from(unsubscribes)
        .where(
          inArray(unsubscribes.email, [
            ...new Set(rows.map((r) => r.email.toLowerCase())),
          ])
        )
    ).map((u) => u.email)
  );

  const sendable: Recipient[] = [];
  for (const r of rows) {
    if (suppressedSet.has(r.email.toLowerCase())) {
      await db
        .update(recipients)
        .set({ status: "suppressed", scheduledFor: null, dispatchClaimedAt: null })
        .where(eq(recipients.id, r.id));
      result.suppressed++;
    } else {
      sendable.push(r);
    }
  }

  // Group by sender mailbox; the token belongs to the mailbox, not the
  // campaign owner.
  const bySender = new Map<string, Recipient[]>();
  for (const r of sendable) {
    const campaign = campaignById.get(r.campaignId);
    const sender = emailFromAddress(
      campaign?.fromAddress ?? DEFAULT_FROM_ADDRESS
    );
    (bySender.get(sender) ?? bySender.set(sender, []).get(sender)!).push(r);
  }

  // Preload follow-up step templates for any follow-up rows in this batch
  const followupCampaignIds = [
    ...new Set(
      sendable.filter((r) => r.sequenceStep > 0).map((r) => r.campaignId)
    ),
  ];
  const stepRows = followupCampaignIds.length
    ? await db
        .select()
        .from(sequenceSteps)
        .where(inArray(sequenceSteps.campaignId, followupCampaignIds))
    : [];
  const stepByKey = new Map(
    stepRows.map((s) => [`${s.campaignId}:${s.stepNumber}`, s])
  );

  const touchedCampaigns = new Set<string>();

  for (const [sender, group] of bySender) {
    let accessToken: string;
    try {
      accessToken = await getAccessTokenForSender(sender);
    } catch (err) {
      // Sender not linked / scope missing / refresh failed: release the
      // claims so the rows retry after the human fixes the link.
      await releaseClaims(group.map((r) => r.id));
      result.errors.push(err instanceof Error ? err.message : String(err));
      continue;
    }

    let tokenRetried = false;

    for (let i = 0; i < group.length; i++) {
      const r = group[i];
      const campaign = campaignById.get(r.campaignId)!;
      touchedCampaigns.add(campaign.id);

      // Resolve the template for this row: initial send vs follow-up step
      let subjectTpl: string;
      let bodyTpl: string;
      if (r.sequenceStep === 0) {
        const t = templatesFor(campaign, r);
        subjectTpl = t.subject;
        bodyTpl = t.body;
      } else {
        const step = stepByKey.get(`${r.campaignId}:${r.sequenceStep}`);
        if (!step) {
          await db
            .update(recipients)
            .set({
              status: "failed",
              error: `Follow-up step ${r.sequenceStep} was deleted before it could send.`,
              dispatchClaimedAt: null,
            })
            .where(eq(recipients.id, r.id));
          result.failed++;
          continue;
        }
        subjectTpl = step.subjectTemplate;
        bodyTpl = step.bodyTemplate;
      }

      const subject = renderTemplate(subjectTpl, r.rowData);
      const { text } = buildEmailBodies(
        renderTemplate(bodyTpl, r.rowData),
        campaign.signature ?? signatureFor(campaign.fromAddress)
      );

      const fromAddress = campaign.fromAddress ?? DEFAULT_FROM_ADDRESS;
      const fromName =
        nameFromAddress(fromAddress) || getSender(fromAddress)?.name || null;

      const isFollowup = r.sequenceStep > 0;
      const rfcId = isFollowup ? undefined : newRfcMessageId(r.id, 0);

      try {
        const sent = await sendGmail({
          accessToken,
          fromName,
          fromEmail: sender,
          to: r.email,
          subject,
          text,
          messageId: rfcId,
          // Resend-era originals have neither -> clean standalone send
          threadId: isFollowup ? r.gmailThreadId : null,
          inReplyTo: isFollowup ? r.gmailRfcMessageId : null,
        });

        // Guarded by status: if an unsubscribe flipped this row mid-flight,
        // don't resurrect it - the send went out this once, future sends stay
        // suppressed.
        const updated = await db
          .update(recipients)
          .set({
            status: "sent",
            lastEmailAt: new Date(),
            scheduledFor: null,
            dispatchClaimedAt: null,
            gmailMessageId: sent.id,
            gmailThreadId: sent.threadId,
            ...(isFollowup ? {} : { gmailRfcMessageId: sent.rfcMessageId }),
            error: null,
          })
          .where(
            and(eq(recipients.id, r.id), eq(recipients.status, "scheduled"))
          )
          .returning({ id: recipients.id });

        if (updated.length > 0) {
          await db
            .update(campaigns)
            .set({ sentCount: sql`${campaigns.sentCount} + 1` })
            .where(eq(campaigns.id, campaign.id));
        }
        result.sent++;
      } catch (err) {
        if (err instanceof GmailSendError && err.tokenProblem && !tokenRetried) {
          // One forced refresh, then retry this recipient from the top
          tokenRetried = true;
          try {
            const acct = await getSenderAccount(sender);
            if (acct) {
              accessToken = await getValidAccessToken(acct.userId);
              i--;
              continue;
            }
          } catch {
            // fall through to abort below
          }
        }

        if (err instanceof GmailSendError && !err.retryable && !err.tokenProblem && err.status < 500) {
          // Recipient-level rejection (bad address etc.)
          await db
            .update(recipients)
            .set({
              status: "failed",
              error: err.message,
              dispatchClaimedAt: null,
            })
            .where(eq(recipients.id, r.id));
          result.failed++;
          continue;
        }

        // Token dead, rate limited, or persistent server error: stop this
        // sender's batch, release remaining claims, retry on a later ping.
        const remaining = group.slice(i).map((x) => x.id);
        await releaseClaims(remaining);
        result.errors.push(
          `${sender}: ${err instanceof Error ? err.message : err}`
        );
        break;
      }

      if (i < group.length - 1) await jitter();
    }
  }

  // Campaign completion: when nothing is left pending/scheduled, a
  // "scheduled" campaign becomes "sent" (this transition used to live in the
  // Resend webhook handler).
  for (const campaignId of touchedCampaigns) {
    const [{ open }] = (
      await db.execute<{ open: string }>(sql`
        SELECT count(*)::text AS open FROM recipient
        WHERE campaign_id = ${campaignId}
          AND status IN ('pending', 'scheduled')
      `)
    ).rows;
    if (open === "0") {
      await db
        .update(campaigns)
        .set({ status: "sent", sentAt: new Date() })
        .where(
          and(eq(campaigns.id, campaignId), eq(campaigns.status, "scheduled"))
        );
    }
  }

  return result;
}

async function releaseClaims(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(recipients)
    .set({ dispatchClaimedAt: null })
    .where(
      and(inArray(recipients.id, ids), eq(recipients.status, "scheduled"))
    );
}
