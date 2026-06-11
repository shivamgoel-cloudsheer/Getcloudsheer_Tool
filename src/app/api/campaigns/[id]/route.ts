import { after } from "next/server";
import { and, eq, isNotNull } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { campaigns, recipients } from "@/db/schema";
import { getResend } from "@/lib/resend";

export const maxDuration = 300;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await params;

  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, id), eq(campaigns.userId, session.user.id)));

  if (!campaign) {
    return Response.json({ error: "Campaign not found" }, { status: 404 });
  }

  // Find the still-queued emails for this campaign.
  const queued = await db
    .select({ resendEmailId: recipients.resendEmailId })
    .from(recipients)
    .where(
      and(
        eq(recipients.campaignId, id),
        eq(recipients.status, "scheduled"),
        isNotNull(recipients.resendEmailId)
      )
    );

  // Nothing queued: delete straight away.
  if (queued.length === 0) {
    await db.delete(campaigns).where(eq(campaigns.id, id));
    return Response.json({ deleted: true, cancelledScheduled: 0 });
  }

  // Otherwise cancel the queued sends FIRST, then delete. Deleting first would
  // remove the recipient rows while some emails are still in Resend's queue;
  // any cancel that fails would then deliver an email whose unsubscribe link
  // 404s and whose webhook events loop against svix forever.
  after(async () => {
    for (let i = 0; i < queued.length; i++) {
      try {
        await getResend().emails.cancel(queued[i].resendEmailId!);
      } catch (e) {
        console.error("Cancel during delete failed", e);
      }
      if (i < queued.length - 1) await sleep(600);
    }
    await db.delete(campaigns).where(eq(campaigns.id, id));
  });

  return Response.json({ deleting: true, cancelledScheduled: queued.length });
}
