import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { recipients } from "@/db/schema";

/**
 * When an address lands on the suppression list (unsubscribe, bounce, or
 * complaint), any still-queued sends for it - across all campaigns - are
 * flipped to suppressed so the dispatcher never picks them up. Scheduling is
 * DB-backed now, so nothing remote needs cancelling; a row that is mid-send
 * keeps its 'sent' outcome (the dispatcher's success update is guarded on
 * status='scheduled') while all future sends stay suppressed.
 */
export async function cancelScheduledForEmail(email: string): Promise<number> {
  const normalized = email.trim().toLowerCase();

  const res = await db
    .update(recipients)
    .set({ status: "suppressed", scheduledFor: null, dispatchClaimedAt: null })
    .where(
      and(eq(recipients.email, normalized), eq(recipients.status, "scheduled"))
    )
    .returning({ id: recipients.id });

  return res.length;
}
