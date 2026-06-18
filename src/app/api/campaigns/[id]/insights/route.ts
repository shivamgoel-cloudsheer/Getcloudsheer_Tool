import { and, eq, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { campaigns, recipients, sequenceSteps } from "@/db/schema";
import { isAdminEmail } from "@/lib/admin";
import { computeMetrics } from "@/lib/analytics";
import { generateInsights } from "@/lib/insights";

// AI performance read for one campaign. Lazy (called from a button) so we only
// spend a Haiku call when the operator actually wants insights.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await params;
  const admin = isAdminEmail(session.user.email);

  const [campaign] = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      status: campaigns.status,
    })
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

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({
      insight: null,
      reason: "AI key not configured",
    });
  }

  const [grouped, stepRows] = await Promise.all([
    db
      .select({
        status: recipients.status,
        replyCategory: recipients.replyCategory,
        n: sql<number>`count(*)::int`,
      })
      .from(recipients)
      .where(eq(recipients.campaignId, id))
      .groupBy(recipients.status, recipients.replyCategory),
    db
      .select({ id: sequenceSteps.id })
      .from(sequenceSteps)
      .where(eq(sequenceSteps.campaignId, id)),
  ]);

  const byStatus: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  let recipientsTotal = 0;
  for (const row of grouped) {
    const n = Number(row.n) || 0;
    recipientsTotal += n;
    byStatus[row.status] = (byStatus[row.status] ?? 0) + n;
    if (row.replyCategory) {
      byCategory[row.replyCategory] = (byCategory[row.replyCategory] ?? 0) + n;
    }
  }

  const metrics = computeMetrics({
    recipients: recipientsTotal,
    byStatus,
    byCategory,
  });

  const insight = await generateInsights(
    campaign.name,
    campaign.status,
    stepRows.length,
    metrics
  );

  return Response.json({ insight });
}
