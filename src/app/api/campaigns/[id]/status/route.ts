import { after } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { campaigns, recipients, sequenceSteps, users } from "@/db/schema";
import { processUser } from "@/lib/processor";
import { isAdminEmail } from "@/lib/admin";

// While the dashboard is open, opportunistically run the background
// processor (replies, follow-ups, sheet sync) at most every 10 minutes.
const AUTO_PROCESS_INTERVAL_MS = 10 * 60 * 1000;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }
  const userId = session.user.id;
  const admin = isAdminEmail(session.user.email);

  const { id } = await params;

  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(
      admin
        ? eq(campaigns.id, id)
        : and(eq(campaigns.id, id), eq(campaigns.userId, userId))
    );

  if (!campaign) {
    return Response.json({ error: "Campaign not found" }, { status: 404 });
  }

  const [rows, steps, [user]] = await Promise.all([
    db
      .select({
        id: recipients.id,
        email: recipients.email,
        name: recipients.name,
        status: recipients.status,
        variant: recipients.variant,
        sequenceStep: recipients.sequenceStep,
        openedAt: recipients.openedAt,
        clickedAt: recipients.clickedAt,
        repliedAt: recipients.repliedAt,
        replySnippet: recipients.replySnippet,
        replySubject: recipients.replySubject,
        error: recipients.error,
      })
      .from(recipients)
      .where(eq(recipients.campaignId, id))
      .orderBy(recipients.email)
      .limit(2000),
    db
      .select()
      .from(sequenceSteps)
      .where(eq(sequenceSteps.campaignId, id))
      .orderBy(asc(sequenceSteps.stepNumber)),
    db.select().from(users).where(eq(users.id, userId)),
  ]);

  const lastCheck = user?.lastReplyCheckAt?.getTime() ?? 0;
  if (
    campaign.status !== "draft" &&
    Date.now() - lastCheck > AUTO_PROCESS_INTERVAL_MS
  ) {
    after(async () => {
      try {
        await processUser(userId);
      } catch (e) {
        console.error("Auto-process failed", e);
      }
    });
  }

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
      hasVariantB: !!(campaign.subjectTemplateB || campaign.bodyTemplateB),
      createdAt: campaign.createdAt,
      sentAt: campaign.sentAt,
      scheduledAt: campaign.scheduledAt,
      staggerConfig: campaign.staggerConfig,
      fromAddress: campaign.fromAddress,
    },
    steps,
    counts,
    recipients: rows,
    lastReplyCheckAt: user?.lastReplyCheckAt ?? null,
  });
}
