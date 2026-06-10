import Link from "next/link";
import { desc, eq, inArray, sql } from "drizzle-orm";
import {
  ChevronRight,
  Clock,
  Eye,
  FileSpreadsheet,
  Mail,
  MousePointerClick,
  Plus,
} from "lucide-react";
import { auth } from "@/auth";
import { db } from "@/db";
import { campaigns, recipients } from "@/db/schema";
import { StatusChip } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  const userId = session!.user.id;

  const list = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.userId, userId))
    .orderBy(desc(campaigns.createdAt));

  type Stats = {
    delivered: number;
    opened: number;
    clicked: number;
    bounced: number;
    reached: number;
  };
  const statsByCampaign = new Map<string, Stats>();
  let totalSent = 0;
  let totalOpened = 0;
  let totalClicked = 0;

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
        reached: 0,
      };
      // Higher statuses imply the lower ones (clicked implies opened, etc.)
      if (["sent", "delivered", "opened", "clicked", "bounced"].includes(row.status)) {
        stats.reached += row.count;
        totalSent += row.count;
      }
      if (["delivered", "opened", "clicked"].includes(row.status)) {
        stats.delivered += row.count;
      }
      if (["opened", "clicked"].includes(row.status)) {
        stats.opened += row.count;
        totalOpened += row.count;
      }
      if (row.status === "clicked") {
        stats.clicked += row.count;
        totalClicked += row.count;
      }
      if (row.status === "bounced") stats.bounced += row.count;
      statsByCampaign.set(row.campaignId, stats);
    }
  }

  const openRate =
    totalSent > 0 ? `${Math.round((totalOpened / totalSent) * 100)}%` : "-";

  const overview = [
    { icon: Mail, label: "Emails sent", value: totalSent },
    { icon: Eye, label: "Open rate", value: openRate },
    { icon: MousePointerClick, label: "Total clicks", value: totalClicked },
    { icon: FileSpreadsheet, label: "Campaigns", value: list.length },
  ];

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Campaigns</h1>
          <p className="mt-0.5 text-sm text-neutral-500">
            Welcome back{session!.user.name ? `, ${session!.user.name.split(" ")[0]}` : ""}
          </p>
        </div>
        <Link
          href="/dashboard/new"
          className="inline-flex items-center gap-2 rounded-xl bg-linear-to-br from-sky-500 to-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-500/20 transition hover:brightness-110"
        >
          <Plus size={16} />
          New campaign
        </Link>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {overview.map((s) => (
          <div
            key={s.label}
            className="rounded-2xl border border-neutral-800/80 bg-neutral-900/60 p-4"
          >
            <div className="flex items-center gap-2 text-neutral-500">
              <s.icon size={14} />
              <p className="text-xs">{s.label}</p>
            </div>
            <p className="mt-2 text-2xl font-semibold tracking-tight">
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-neutral-800 p-14 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-900 text-neutral-500">
            <FileSpreadsheet size={20} />
          </div>
          <p className="mt-4 font-medium text-neutral-300">
            No campaigns yet
          </p>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-neutral-500">
            Create your first one from a Google Sheet with Name, Email, and
            content columns.
          </p>
          <Link
            href="/dashboard/new"
            className="mt-6 inline-flex items-center gap-2 rounded-xl border border-neutral-700 px-4 py-2 text-sm text-neutral-200 transition hover:bg-neutral-900"
          >
            <Plus size={15} />
            Create campaign
          </Link>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {list.map((campaign) => {
            const stats = statsByCampaign.get(campaign.id);
            const openPct =
              stats && stats.reached > 0
                ? Math.round((stats.opened / stats.reached) * 100)
                : 0;
            return (
              <li key={campaign.id}>
                <Link
                  href={`/dashboard/campaigns/${campaign.id}`}
                  className="group block rounded-2xl border border-neutral-800/80 bg-neutral-900/60 p-5 transition hover:border-neutral-700 hover:bg-neutral-900"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <p className="truncate font-medium">{campaign.name}</p>
                        <StatusChip status={campaign.status} />
                      </div>
                      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-neutral-500">
                        {campaign.status === "scheduled" &&
                        campaign.scheduledAt ? (
                          <>
                            <Clock size={12} />
                            Scheduled for{" "}
                            {campaign.scheduledAt.toLocaleString()}
                          </>
                        ) : (
                          <>
                            {campaign.total} recipients ·{" "}
                            {campaign.createdAt.toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                          </>
                        )}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-6">
                      {stats && stats.reached > 0 && (
                        <div className="hidden items-center gap-6 sm:flex">
                          <div className="text-right">
                            <p className="text-sm font-semibold text-neutral-200">
                              {stats.opened}
                              <span className="ml-1 text-xs font-normal text-neutral-500">
                                opened
                              </span>
                            </p>
                            <div className="mt-1.5 h-1 w-28 overflow-hidden rounded-full bg-neutral-800">
                              <div
                                className="h-full rounded-full bg-linear-to-r from-sky-400 to-indigo-500"
                                style={{ width: `${openPct}%` }}
                              />
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold text-neutral-200">
                              {stats.clicked}
                            </p>
                            <p className="text-xs text-neutral-500">clicked</p>
                          </div>
                        </div>
                      )}
                      <ChevronRight
                        size={16}
                        className="text-neutral-600 transition group-hover:translate-x-0.5 group-hover:text-neutral-400"
                      />
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
