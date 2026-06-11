import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { campaigns, recipients } from "@/db/schema";
import { tzDateKey } from "./timezone";

// Statuses that have consumed a send slot for the day (already sent or still
// queued to send). Pending/suppressed/failed have not.
const COMMITTED_STATUSES = [
  "scheduled",
  "sent",
  "delivered",
  "opened",
  "clicked",
  "replied",
  "bounced",
  "complained",
] as const;

export type SenderCommitments = {
  /** Calendar day ("YYYY-MM-DD" in the given timezone) -> sends already committed. */
  byDay: Map<string, number>;
  /** Earliest send this sender has ever made, for the warm-up ramp start. */
  firstSendAt: Date | null;
};

/**
 * Counts how many emails a given From address has already sent or scheduled,
 * bucketed by calendar day, across ALL of the user's campaigns. This is what
 * makes the daily cap per sender rather than per campaign: two campaigns from
 * the same mailbox draw from the same daily budget.
 *
 * `sender` must be the effective From address (campaign.fromAddress, or the
 * RESEND_FROM fallback when a campaign has none).
 */
export async function getSenderCommitments(
  userId: string,
  sender: string,
  timeZone: string
): Promise<SenderCommitments> {
  const rows = await db
    .select({
      lastEmailAt: recipients.lastEmailAt,
      fromAddress: campaigns.fromAddress,
    })
    .from(recipients)
    .innerJoin(campaigns, eq(recipients.campaignId, campaigns.id))
    .where(
      and(
        eq(campaigns.userId, userId),
        inArray(recipients.status, [...COMMITTED_STATUSES]),
        isNotNull(recipients.lastEmailAt)
      )
    );

  const fallback = process.env.RESEND_FROM ?? "";
  const byDay = new Map<string, number>();
  let firstSendAt: Date | null = null;

  for (const r of rows) {
    const effFrom = r.fromAddress ?? fallback;
    if (effFrom !== sender) continue;
    const at = r.lastEmailAt!;
    const key = tzDateKey(at, timeZone);
    byDay.set(key, (byDay.get(key) ?? 0) + 1);
    if (!firstSendAt || at < firstSendAt) firstSendAt = at;
  }

  return { byDay, firstSendAt };
}
