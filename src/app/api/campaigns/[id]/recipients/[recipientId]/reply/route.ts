import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { campaigns, recipients } from "@/db/schema";
import { isAdminEmail } from "@/lib/admin";
import { getAccessTokenForSender } from "@/lib/google";
import { fetchMessageBody } from "@/lib/gmail";
import { DEFAULT_FROM_ADDRESS, emailFromAddress } from "@/lib/senders";

// Loads the full body of a recipient's latest reply, on demand. The reply
// lives in the SENDER's mailbox, so we read it with the sender's token.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; recipientId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id, recipientId } = await params;
  const admin = isAdminEmail(session.user.email);

  const [campaign] = await db
    .select({ id: campaigns.id, fromAddress: campaigns.fromAddress })
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

  const [recipient] = await db
    .select({ replyMessageId: recipients.replyMessageId })
    .from(recipients)
    .where(
      and(eq(recipients.id, recipientId), eq(recipients.campaignId, id))
    );
  if (!recipient?.replyMessageId) {
    return Response.json({ error: "No reply on file" }, { status: 404 });
  }

  const sender = emailFromAddress(campaign.fromAddress ?? DEFAULT_FROM_ADDRESS);
  try {
    const token = await getAccessTokenForSender(sender);
    const message = await fetchMessageBody(token, recipient.replyMessageId);
    return Response.json(message);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to load reply" },
      { status: 502 }
    );
  }
}
