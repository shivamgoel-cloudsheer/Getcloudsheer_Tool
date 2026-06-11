import { and, eq, gt, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { recipients } from "@/db/schema";
import { getResend } from "@/lib/resend";

/**
 * When an address lands on the suppression list (unsubscribe, bounce, or
 * complaint), any emails we already handed to Resend with a future
 * scheduled_at are still queued to go out. This finds every such pending send
 * for the address - across all campaigns - and cancels it via Resend, then
 * marks the recipient suppressed so it won't be retried.
 *
 * A pending scheduled send is identified by a future lastEmailAt (the
 * scheduled time) plus a stored Resend email ID. Already-delivered sends have
 * a past lastEmailAt and are left untouched.
 */
export async function cancelScheduledForEmail(email: string): Promise<number> {
  const normalized = email.trim().toLowerCase();

  const pending = await db
    .select()
    .from(recipients)
    .where(
      and(
        eq(recipients.email, normalized),
        isNotNull(recipients.resendEmailId),
        gt(recipients.lastEmailAt, new Date())
      )
    );

  let cancelled = 0;
  for (const r of pending) {
    try {
      const { error } = await getResend().emails.cancel(r.resendEmailId!);
      if (error) {
        // Likely already released for delivery; still suppress so we don't
        // schedule anything further for this address.
        console.error(`Cancel failed for ${r.resendEmailId}:`, error.message);
      } else {
        cancelled++;
      }
    } catch (e) {
      console.error("Cancel threw", e);
    }

    await db
      .update(recipients)
      .set({ status: "suppressed", resendEmailId: null })
      .where(eq(recipients.id, r.id));
  }

  return cancelled;
}
