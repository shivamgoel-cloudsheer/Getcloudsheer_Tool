import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  campaigns,
  recipients,
  sequenceSteps,
  unsubscribes,
  users,
} from "@/db/schema";
import { findRepliesFrom } from "@/lib/gmail";
import { getValidAccessToken } from "@/lib/google";
import { getResend } from "@/lib/resend";
import { writeStatusColumn } from "@/lib/sheets";
import { buildEmailBodies, renderTemplate } from "@/lib/template";

const ACTIVE_STATUSES = ["sent", "delivered", "opened", "clicked"] as const;
const BATCH_SIZE = 100;
const DELAY_BETWEEN_BATCHES_MS = 600;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type ProcessResult = {
  repliesFound: number;
  followUpsSent: number;
  sheetsSynced: number;
  errors: string[];
};

/**
 * One pass of background work for a user:
 * 1. Detect replies in Gmail and mark recipients as replied.
 * 2. Send any follow-up steps that are due (skipping replied/suppressed).
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

  const userCampaigns = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.userId, userId));
  const campaignIds = userCampaigns.map((c) => c.id);
  if (campaignIds.length === 0) return result;

  // --- 1. Reply detection -------------------------------------------------
  try {
    const active = await db
      .select()
      .from(recipients)
      .where(
        and(
          inArray(recipients.campaignId, campaignIds),
          inArray(recipients.status, [...ACTIVE_STATUSES]),
          isNull(recipients.repliedAt),
          isNotNull(recipients.lastEmailAt)
        )
      );

    const uniqueEmails = [...new Set(active.map((r) => r.email))];
    if (uniqueEmails.length > 0) {
      const replies = await findRepliesFrom(accessToken, uniqueEmails);
      for (const r of active) {
        const repliedAt = replies.get(r.email.toLowerCase());
        // Only count replies that arrived after we emailed them
        if (repliedAt && r.lastEmailAt && repliedAt > r.lastEmailAt) {
          await db
            .update(recipients)
            .set({ repliedAt, status: "replied" })
            .where(eq(recipients.id, r.id));
          result.repliesFound++;
        }
      }
    }
    await db
      .update(users)
      .set({ lastReplyCheckAt: new Date() })
      .where(eq(users.id, userId));
  } catch (e) {
    result.errors.push(e instanceof Error ? e.message : "Reply check failed");
  }

  // --- 2. Due follow-ups --------------------------------------------------
  try {
    const suppressedEmails = new Set(
      (await db.select({ email: unsubscribes.email }).from(unsubscribes)).map(
        (u) => u.email
      )
    );

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

      // Group due recipients by the step they're due for
      const dueByStep = new Map<number, typeof candidates>();
      const now = Date.now();
      for (const r of candidates) {
        if (suppressedEmails.has(r.email.toLowerCase())) continue;
        const nextStep = steps.find((s) => s.stepNumber === r.sequenceStep + 1);
        if (!nextStep) continue;
        const dueAt =
          r.lastEmailAt!.getTime() + nextStep.delayDays * 24 * 60 * 60 * 1000;
        if (dueAt > now) continue;
        const list = dueByStep.get(nextStep.stepNumber) ?? [];
        list.push(r);
        dueByStep.set(nextStep.stepNumber, list);
      }

      const runId = Date.now().toString(36);
      const appUrl = process.env.APP_URL ?? "http://localhost:3000";
      const replyTo = process.env.RESEND_REPLY_TO;

      for (const [stepNumber, due] of dueByStep) {
        const step = steps.find((s) => s.stepNumber === stepNumber)!;

        for (let i = 0; i < due.length; i += BATCH_SIZE) {
          const chunk = due.slice(i, i + BATCH_SIZE);
          const payload = chunk.map((r) => {
            const unsubscribeUrl = `${appUrl}/u/${r.unsubscribeToken}`;
            const subject = renderTemplate(step.subjectTemplate, r.rowData);
            const body = renderTemplate(step.bodyTemplate, r.rowData);
            const { html, text } = buildEmailBodies(body, unsubscribeUrl);
            return {
              from: process.env.RESEND_FROM!,
              to: [r.email],
              ...(replyTo ? { replyTo } : {}),
              subject,
              html,
              text,
              headers: {
                "List-Unsubscribe": `<${unsubscribeUrl}>`,
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
              },
              tags: [
                { name: "recipient_id", value: r.id },
                { name: "campaign_id", value: campaign.id },
                { name: "variant", value: r.variant },
                { name: "step", value: String(stepNumber) },
              ],
            };
          });

          const { data, error } = await getResend().batch.send(payload, {
            idempotencyKey: `followup-${campaign.id}-s${stepNumber}-${runId}-c${i}`,
          });

          if (!error && data) {
            for (let j = 0; j < chunk.length; j++) {
              await db
                .update(recipients)
                .set({
                  sequenceStep: stepNumber,
                  lastEmailAt: new Date(),
                  resendEmailId: data.data[j]?.id ?? chunk[j].resendEmailId,
                })
                .where(eq(recipients.id, chunk[j].id));
              result.followUpsSent++;
            }
          } else {
            result.errors.push(
              `Follow-up step ${stepNumber} failed for "${campaign.name}": ${error?.message ?? "unknown"}`
            );
          }

          await sleep(DELAY_BETWEEN_BATCHES_MS);
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
