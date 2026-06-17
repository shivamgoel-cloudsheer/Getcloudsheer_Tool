import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/db";
import { campaigns, recipients } from "@/db/schema";
import { isAdminEmail } from "@/lib/admin";
import { suppressEmail } from "@/lib/suppress";

const schema = z.object({
  recipientIds: z.array(z.string().uuid()).min(1).max(5000),
  // "pending"  -> unschedule (won't send; can be re-scheduled later)
  // "delete"   -> remove the recipient from the campaign entirely
  // "category" -> manually set the reply segmentation tag
  action: z.enum(["pending", "delete", "category"]),
  category: z
    .enum([
      "interested",
      "meeting",
      "later",
      "not_interested",
      "unsubscribe",
      "wrong_person",
      "out_of_office",
      "neutral",
    ])
    .optional(),
});

// Per-recipient actions on SCHEDULED emails: pull a queued send back to
// pending, or delete it. Managers can act on any campaign; others only theirs.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await params;
  const admin = isAdminEmail(session.user.email);
  const [campaign] = await db
    .select({ id: campaigns.id, userId: campaigns.userId })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.id, id),
        ...(admin ? [] : [eq(campaigns.userId, session.user.id)])
      )
    );
  if (!campaign) {
    return Response.json({ error: "Campaign not found" }, { status: 404 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const { recipientIds, action, category } = parsed.data;

  // Manual re-tag of the reply segmentation (any status, this campaign).
  if (action === "category") {
    if (!category) {
      return Response.json({ error: "category required" }, { status: 400 });
    }
    const updated = await db
      .update(recipients)
      .set({ replyCategory: category })
      .where(
        and(
          eq(recipients.campaignId, id),
          inArray(recipients.id, recipientIds)
        )
      )
      .returning({ id: recipients.id, email: recipients.email });
    // Tagging a reply do-not-contact suppresses the address everywhere.
    if (category === "unsubscribe") {
      for (const r of updated) {
        await suppressEmail(r.email, campaign.userId, "reply");
      }
    }
    return Response.json({ updated: updated.length });
  }

  // Only act on rows that are actually scheduled in this campaign.
  const scope = and(
    eq(recipients.campaignId, id),
    inArray(recipients.id, recipientIds),
    eq(recipients.status, "scheduled")
  );

  if (action === "pending") {
    const reverted = await db
      .update(recipients)
      .set({
        status: "pending",
        scheduledFor: null,
        dispatchClaimedAt: null,
        lastEmailAt: null,
      })
      .where(scope)
      .returning({ id: recipients.id });
    return Response.json({ updated: reverted.length });
  }

  // delete
  const deleted = await db
    .delete(recipients)
    .where(scope)
    .returning({ id: recipients.id });
  if (deleted.length > 0) {
    await db
      .update(campaigns)
      .set({ total: sql`GREATEST(${campaigns.total} - ${deleted.length}, 0)` })
      .where(eq(campaigns.id, id));
  }
  return Response.json({ deleted: deleted.length });
}
