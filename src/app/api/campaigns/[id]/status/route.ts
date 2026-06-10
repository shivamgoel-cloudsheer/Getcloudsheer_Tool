import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { campaigns, recipients } from "@/db/schema";

export async function GET(
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

  const rows = await db
    .select({
      id: recipients.id,
      email: recipients.email,
      name: recipients.name,
      status: recipients.status,
      openedAt: recipients.openedAt,
      clickedAt: recipients.clickedAt,
      error: recipients.error,
    })
    .from(recipients)
    .where(eq(recipients.campaignId, id))
    .orderBy(recipients.email)
    .limit(2000);

  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
  }

  return Response.json({
    campaign: {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      total: campaign.total,
      sentCount: campaign.sentCount,
      subjectTemplate: campaign.subjectTemplate,
      createdAt: campaign.createdAt,
      sentAt: campaign.sentAt,
      scheduledAt: campaign.scheduledAt,
    },
    counts,
    recipients: rows,
  });
}
