import { desc, inArray } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { campaigns, users } from "@/db/schema";
import { isAdminEmail } from "@/lib/admin";
import { getSender } from "@/lib/senders";
import { visibleCampaignsWhere } from "@/lib/visibility";
import AnalyticsClient, { type CampaignListItem } from "./AnalyticsClient";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const session = await auth();
  const userId = session!.user.id;
  const admin = isAdminEmail(session!.user.email);

  const rows = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      status: campaigns.status,
      total: campaigns.total,
      sentCount: campaigns.sentCount,
      createdAt: campaigns.createdAt,
      userId: campaigns.userId,
    })
    .from(campaigns)
    .where(await visibleCampaignsWhere(userId, session!.user.email))
    .orderBy(desc(campaigns.createdAt));

  // Manager view: label each campaign with who created it.
  const ownerById = new Map<string, string>();
  if (admin && rows.length > 0) {
    const ownerIds = [...new Set(rows.map((r) => r.userId))];
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

  const list: CampaignListItem[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    total: r.total,
    sentCount: r.sentCount,
    createdAt: r.createdAt.toISOString(),
    owner: admin ? ownerById.get(r.userId) ?? null : null,
  }));

  return <AnalyticsClient campaigns={list} />;
}
