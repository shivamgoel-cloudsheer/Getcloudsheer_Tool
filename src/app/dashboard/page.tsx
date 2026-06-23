import Link from "next/link";
import { desc, inArray, sql } from "drizzle-orm";
import {
  ChevronRight,
  Clock,
  FileSpreadsheet,
  Mail,
  MailX,
  MessageSquareReply,
  Plus,
} from "lucide-react";
import { auth } from "@/auth";
import { db } from "@/db";
import { campaigns, recipients, users } from "@/db/schema";
import { StatusChip } from "@/components/ui";
import { isAdminEmail } from "@/lib/admin";
import { getSender } from "@/lib/senders";
import { visibleCampaignsWhere } from "@/lib/visibility";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  const userId = session!.user.id;
  // Managers (ADMIN_EMAILS) see every campaign; everyone else sees their own.
  const admin = isAdminEmail(session!.user.email);

  const list = await db
    .select()
    .from(campaigns)
    .where(await visibleCampaignsWhere(userId, session!.user.email))
    .orderBy(desc(campaigns.createdAt));

  // In manager view, label each campaign with who created it. Prefer the
  // friendly sender name (Tushar/Bharat/...), then the Google name, then email.
  const ownerLabelById = new Map<string, string>();
  if (admin && list.length > 0) {
    const ownerIds = [...new Set(list.map((c) => c.userId))];
    const owners = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(inArray(users.id, ownerIds));
    for (const o of owners) {
      const label =
        (o.email ? getSender(o.email)?.name : null) ??
        o.name ??
        o.email ??
        "Unknown";
      ownerLabelById.set(o.id, label);
    }
  }

  type Stats = {
    replied: number;
    bounced: number;
    reached: number;
  };
  const statsByCampaign = new Map<string, Stats>();
  let totalSent = 0;
  let totalReplied = 0;
  let totalBounced = 0;

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
        replied: 0,
        bounced: 0,
        reached: 0,
      };
      // "reached" = everyone a send was attempted for. Gmail sending has no
      // delivery/open/click events, so "sent" is the success state; legacy
      // Resend statuses are kept here only for historical campaigns.
      if (
        ["sent", "delivered", "opened", "clicked", "replied", "bounced"].includes(
          row.status
        )
      ) {
        stats.reached += row.count;
        totalSent += row.count;
      }
      if (row.status === "replied") {
        stats.replied += row.count;
        totalReplied += row.count;
      }
      if (row.status === "bounced") {
        stats.bounced += row.count;
        totalBounced += row.count;
      }
      statsByCampaign.set(row.campaignId, stats);
    }
  }

  // Reply rate is the headline for cold outreach; bounce rate flags list health.
  const replyRate =
    totalSent > 0 ? `${Math.round((totalReplied / totalSent) * 100)}%` : "-";
  const bounceRate =
    totalSent > 0 ? `${Math.round((totalBounced / totalSent) * 100)}%` : "-";

  const overview = [
    { icon: Mail, label: "Emails sent", value: totalSent },
    { icon: MessageSquareReply, label: "Reply rate", value: replyRate },
    { icon: MailX, label: "Bounce rate", value: bounceRate },
    { icon: FileSpreadsheet, label: "Campaigns", value: list.length },
  ];

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Campaigns</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Welcome back{session!.user.name ? `, ${session!.user.name.split(" ")[0]}` : ""}
          </p>
        </div>
        <Link
          href="/dashboard/new"
          className="inline-flex items-center gap-2 rounded-xl bg-linear-to-br from-sky-500 to-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-110"
        >
          <Plus size={16} />
          New campaign
        </Link>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {overview.map((s) => (
          <div
            key={s.label}
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="flex items-center gap-2 text-slate-500">
              <s.icon size={14} />
              <p className="text-xs">{s.label}</p>
            </div>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-slate-300 bg-white p-14 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
            <FileSpreadsheet size={20} />
          </div>
          <p className="mt-4 font-medium text-slate-700">
            No campaigns yet
          </p>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-slate-500">
            Create your first one from a Google Sheet with Name, Email, and
            content columns.
          </p>
          <Link
            href="/dashboard/new"
            className="mt-6 inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
          >
            <Plus size={15} />
            Create campaign
          </Link>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {list.map((campaign) => {
            const stats = statsByCampaign.get(campaign.id);
            const replyPct =
              stats && stats.reached > 0
                ? Math.round((stats.replied / stats.reached) * 100)
                : 0;
            return (
              <li key={campaign.id}>
                <Link
                  href={`/dashboard/campaigns/${campaign.id}`}
                  className="group block rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow-md"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <p className="truncate font-medium text-slate-900">{campaign.name}</p>
                        <StatusChip status={campaign.status} />
                        {admin && ownerLabelById.get(campaign.userId) && (
                          <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200">
                            by {ownerLabelById.get(campaign.userId)}
                          </span>
                        )}
                      </div>
                      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500">
                        {campaign.status === "scheduled" &&
                        campaign.scheduledAt ? (
                          <>
                            <Clock size={12} />
                            Scheduled for{" "}
                            {campaign.scheduledAt.toLocaleString(undefined, {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                              timeZone: campaign.staggerConfig?.timeZone || "UTC",
                              timeZoneName: "short",
                            })}
                            {campaign.staggerConfig?.perRecipientTimeZone
                              ? " · each recipient's local time"
                              : ""}
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
                            <p className="text-sm font-semibold text-slate-800">
                              {stats.replied}
                              <span className="ml-1 text-xs font-normal text-slate-500">
                                replied
                              </span>
                            </p>
                            <div className="mt-1.5 h-1 w-28 overflow-hidden rounded-full bg-slate-200">
                              <div
                                className="h-full rounded-full bg-linear-to-r from-teal-400 to-emerald-500"
                                style={{ width: `${replyPct}%` }}
                              />
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold text-slate-800">
                              {stats.reached - stats.bounced}
                            </p>
                            <p className="text-xs text-slate-500">sent</p>
                          </div>
                        </div>
                      )}
                      <ChevronRight
                        size={16}
                        className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500"
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
