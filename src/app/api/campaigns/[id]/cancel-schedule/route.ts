import { and, eq, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { campaigns, recipients } from "@/db/schema";

/**
 * Cancelling a scheduled campaign is now a pure DB operation: undispatched
 * rows go back to pending and the campaign returns to draft. Anything the
 * dispatcher already sent stays sent.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await params;

  // Guard: only the owner's scheduled campaign can be cancelled
  const [campaign] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.id, id),
        eq(campaigns.userId, session.user.id),
        eq(campaigns.status, "scheduled")
      )
    );

  if (!campaign) {
    return Response.json(
      { error: "Campaign not found or not scheduled" },
      { status: 409 }
    );
  }

  const reverted = await db
    .update(recipients)
    .set({
      status: "pending",
      scheduledFor: null,
      dispatchClaimedAt: null,
      lastEmailAt: null,
    })
    .where(
      and(eq(recipients.campaignId, id), eq(recipients.status, "scheduled"))
    )
    .returning({ id: recipients.id });

  await db
    .update(campaigns)
    .set({
      status: "draft",
      scheduledAt: null,
      // Keep the truthful count of what actually went out before the cancel
      sentCount: sql`(SELECT count(*) FROM recipient
                      WHERE campaign_id = ${id}
                        AND status NOT IN ('pending', 'scheduled', 'suppressed', 'failed'))`,
    })
    .where(eq(campaigns.id, id));

  return Response.json({ cancelled: reverted.length });
}
