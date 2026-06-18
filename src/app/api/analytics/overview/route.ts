import { desc, eq, inArray, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { campaigns, recipients, users } from "@/db/schema";
import { isAdminEmail } from "@/lib/admin";
import { computeMetrics, type Metrics } from "@/lib/analytics";
import {
  DEFAULT_FROM_ADDRESS,
  emailFromAddress,
  getSender,
} from "@/lib/senders";

export const dynamic = "force-dynamic";

type Buckets = {
  recipients: number;
  byStatus: Record<string, number>;
  byCategory: Record<string, number>;
};

function emptyBuckets(): Buckets {
  return { recipients: 0, byStatus: {}, byCategory: {} };
}

function add(b: Buckets, status: string, category: string | null, n: number) {
  b.recipients += n;
  b.byStatus[status] = (b.byStatus[status] ?? 0) + n;
  if (category) b.byCategory[category] = (b.byCategory[category] ?? 0) + n;
}

// Cross-campaign analytics home: totals, a campaign leaderboard ranked by
// positive-reply rate, and per-mailbox (sender) health. Managers see every
// campaign; everyone else sees only their own.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }
  const userId = session.user.id;
  const admin = isAdminEmail(session.user.email);

  const camps = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      status: campaigns.status,
      fromAddress: campaigns.fromAddress,
      createdAt: campaigns.createdAt,
      userId: campaigns.userId,
    })
    .from(campaigns)
    .where(admin ? undefined : eq(campaigns.userId, userId))
    .orderBy(desc(campaigns.createdAt));

  if (camps.length === 0) {
    return Response.json({
      totals: computeMetrics(emptyBuckets()),
      campaignCount: 0,
      campaigns: [],
      senders: [],
    });
  }

  const campaignIds = camps.map((c) => c.id);
  const grouped = await db
    .select({
      campaignId: recipients.campaignId,
      status: recipients.status,
      replyCategory: recipients.replyCategory,
      n: sql<number>`count(*)::int`,
    })
    .from(recipients)
    .where(inArray(recipients.campaignId, campaignIds))
    .groupBy(
      recipients.campaignId,
      recipients.status,
      recipients.replyCategory
    );

  // Per-campaign, per-sender, and grand-total buckets in one pass.
  const perCampaign = new Map<string, Buckets>();
  const perSender = new Map<string, Buckets>();
  const totals = emptyBuckets();
  const senderOf = (c: (typeof camps)[number]) =>
    emailFromAddress(c.fromAddress ?? DEFAULT_FROM_ADDRESS);
  const senderByCampaign = new Map(camps.map((c) => [c.id, senderOf(c)]));

  for (const row of grouped) {
    const n = Number(row.n) || 0;
    const cb = perCampaign.get(row.campaignId) ?? emptyBuckets();
    add(cb, row.status, row.replyCategory, n);
    perCampaign.set(row.campaignId, cb);

    const sender = senderByCampaign.get(row.campaignId);
    if (sender) {
      const sb = perSender.get(sender) ?? emptyBuckets();
      add(sb, row.status, row.replyCategory, n);
      perSender.set(sender, sb);
    }
    add(totals, row.status, row.replyCategory, n);
  }

  // Owner labels for the manager view.
  const ownerById = new Map<string, string>();
  if (admin) {
    const ownerIds = [...new Set(camps.map((c) => c.userId))];
    const owners = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(inArray(users.id, ownerIds));
    for (const o of owners) {
      ownerById.set(
        o.id,
        (o.email ? getSender(o.email)?.name : null) ?? o.name ?? o.email ?? ""
      );
    }
  }

  const campaignRows = camps.map((c) => {
    const m: Metrics = computeMetrics(perCampaign.get(c.id) ?? emptyBuckets());
    return {
      id: c.id,
      name: c.name,
      status: c.status,
      owner: admin ? ownerById.get(c.userId) ?? null : null,
      sender: senderByCampaign.get(c.id) ?? null,
      metrics: m,
    };
  });

  // Leaderboard: positive-reply rate first, then raw positives, then replies.
  const leaderboard = [...campaignRows].sort(
    (a, b) =>
      b.metrics.positiveRate - a.metrics.positiveRate ||
      b.metrics.positive - a.metrics.positive ||
      b.metrics.replied - a.metrics.replied
  );

  const senders = [...perSender.entries()]
    .map(([email, b]) => ({
      email,
      name: getSender(email)?.name ?? null,
      metrics: computeMetrics(b),
    }))
    .sort((a, b) => b.metrics.reached - a.metrics.reached);

  return Response.json({
    totals: computeMetrics(totals),
    campaignCount: camps.length,
    campaigns: leaderboard,
    senders,
  });
}
