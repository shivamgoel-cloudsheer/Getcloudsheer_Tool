import { after } from "next/server";
import { and, eq, isNotNull } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { campaigns, recipients } from "@/db/schema";
import { getResend } from "@/lib/resend";

export const maxDuration = 300;

const DELAY_BETWEEN_CANCELS_MS = 600;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await params;

  // Atomic guard: only a scheduled campaign can be cancelled
  const [campaign] = await db
    .update(campaigns)
    .set({ status: "sending" }) // transient state while cancelling
    .where(
      and(
        eq(campaigns.id, id),
        eq(campaigns.userId, session.user.id),
        eq(campaigns.status, "scheduled")
      )
    )
    .returning();

  if (!campaign) {
    return Response.json(
      { error: "Campaign not found or not scheduled" },
      { status: 409 }
    );
  }

  after(() => runCancel(campaign.id));

  return Response.json({ status: "cancelling" }, { status: 202 });
}

async function runCancel(campaignId: string) {
  try {
    const scheduled = await db
      .select()
      .from(recipients)
      .where(
        and(
          eq(recipients.campaignId, campaignId),
          eq(recipients.status, "scheduled"),
          isNotNull(recipients.resendEmailId)
        )
      );

    for (let i = 0; i < scheduled.length; i++) {
      const r = scheduled[i];
      const { error } = await getResend().emails.cancel(r.resendEmailId!);

      if (!error) {
        // Cleared so the dead email ID can't shadow a future send;
        // webhooks still resolve via the recipient_id tag if needed.
        await db
          .update(recipients)
          .set({ status: "pending", resendEmailId: null })
          .where(eq(recipients.id, r.id));
      } else {
        // Likely already released for delivery; leave it as scheduled
        // and let the webhook events advance it normally.
        console.error(`Failed to cancel ${r.resendEmailId}:`, error.message);
      }

      if (i < scheduled.length - 1) {
        await sleep(DELAY_BETWEEN_CANCELS_MS);
      }
    }

    await db
      .update(campaigns)
      .set({ status: "draft", scheduledAt: null, sentCount: 0 })
      .where(eq(campaigns.id, campaignId));
  } catch (error) {
    console.error("Cancel schedule failed", error);
    await db
      .update(campaigns)
      .set({ status: "failed" })
      .where(eq(campaigns.id, campaignId));
  }
}
