import Link from "next/link";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { campaigns, recipients } from "@/db/schema";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-neutral-700/50 text-neutral-300",
  sending: "bg-amber-500/15 text-amber-400",
  scheduled: "bg-amber-500/15 text-amber-400",
  sent: "bg-emerald-500/15 text-emerald-400",
  failed: "bg-red-500/15 text-red-400",
};

export default async function DashboardPage() {
  const session = await auth();
  const userId = session!.user.id;

  const list = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.userId, userId))
    .orderBy(desc(campaigns.createdAt));

  const statsByCampaign = new Map<
    string,
    { delivered: number; opened: number; clicked: number; bounced: number }
  >();

  if (list.length > 0) {
    const counts = await db
      .select({
        campaignId: recipients.campaignId,
        status: recipients.status,
        count: sql<number>`count(*)::int`,
      })
      .from(recipients)
      .where(
        inArray(
          recipients.campaignId,
          list.map((c) => c.id)
        )
      )
      .groupBy(recipients.campaignId, recipients.status);

    for (const row of counts) {
      const stats = statsByCampaign.get(row.campaignId) ?? {
        delivered: 0,
        opened: 0,
        clicked: 0,
        bounced: 0,
      };
      // Higher statuses imply the lower ones (clicked implies opened, etc.)
      if (["delivered", "opened", "clicked"].includes(row.status)) {
        stats.delivered += row.count;
      }
      if (["opened", "clicked"].includes(row.status)) {
        stats.opened += row.count;
      }
      if (row.status === "clicked") stats.clicked += row.count;
      if (row.status === "bounced") stats.bounced += row.count;
      statsByCampaign.set(row.campaignId, stats);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Campaigns</h1>
        <Link
          href="/dashboard/new"
          className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-400"
        >
          New campaign
        </Link>
      </div>

      {list.length === 0 ? (
        <div className="mt-16 rounded-2xl border border-dashed border-neutral-800 p-16 text-center">
          <p className="text-neutral-400">No campaigns yet.</p>
          <p className="mt-2 text-sm text-neutral-500">
            Create one from a Google Sheet with Name, Email, and content
            columns.
          </p>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {list.map((campaign) => {
            const stats = statsByCampaign.get(campaign.id);
            return (
              <li key={campaign.id}>
                <Link
                  href={`/dashboard/campaigns/${campaign.id}`}
                  className="block rounded-xl border border-neutral-800 bg-neutral-900 p-5 transition hover:border-neutral-700"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{campaign.name}</p>
                      <p className="mt-1 text-xs text-neutral-500">
                        {campaign.total} recipients ·{" "}
                        {campaign.status === "scheduled" && campaign.scheduledAt
                          ? `scheduled for ${campaign.scheduledAt.toLocaleString()}`
                          : campaign.createdAt.toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-6">
                      {stats && campaign.status !== "draft" && (
                        <div className="hidden gap-5 text-center text-xs sm:flex">
                          <div>
                            <p className="font-semibold text-neutral-200">
                              {stats.delivered}
                            </p>
                            <p className="text-neutral-500">delivered</p>
                          </div>
                          <div>
                            <p className="font-semibold text-neutral-200">
                              {stats.opened}
                            </p>
                            <p className="text-neutral-500">opened</p>
                          </div>
                          <div>
                            <p className="font-semibold text-neutral-200">
                              {stats.clicked}
                            </p>
                            <p className="text-neutral-500">clicked</p>
                          </div>
                        </div>
                      )}
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-medium ${
                          STATUS_STYLES[campaign.status] ?? STATUS_STYLES.draft
                        }`}
                      >
                        {campaign.status}
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
