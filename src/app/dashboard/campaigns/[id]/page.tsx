"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CalendarClock,
  CheckCheck,
  Eye,
  Loader2,
  Mail,
  MousePointerClick,
  RefreshCw,
  Send,
  TriangleAlert,
  X,
} from "lucide-react";
import { StatusChip } from "@/components/ui";

type CampaignStatusResponse = {
  campaign: {
    id: string;
    name: string;
    status: string;
    total: number;
    sentCount: number;
    subjectTemplate: string;
    createdAt: string;
    sentAt: string | null;
    scheduledAt: string | null;
  };
  counts: Record<string, number>;
  recipients: {
    id: string;
    email: string;
    name: string | null;
    status: string;
    openedAt: string | null;
    clickedAt: string | null;
    error: string | null;
  }[];
};

export default function CampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [data, setData] = useState<CampaignStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleTime, setScheduleTime] = useState("");
  const [filter, setFilter] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/campaigns/${id}/status`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load campaign");
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load campaign");
    }
  }, [id]);

  useEffect(() => {
    const initial = setTimeout(refresh, 0);
    const interval = setInterval(refresh, 5000);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [refresh]);

  async function startSend(scheduledAt?: string) {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          scheduledAt
            ? { scheduledAt: new Date(scheduledAt).toISOString() }
            : {}
        ),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to start sending");
      setShowSchedule(false);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start sending");
    } finally {
      setSending(false);
    }
  }

  async function cancelSchedule() {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${id}/cancel-schedule`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to cancel schedule");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to cancel schedule");
    } finally {
      setSending(false);
    }
  }

  const visibleRecipients = useMemo(() => {
    if (!data) return [];
    if (!filter) return data.recipients;
    return data.recipients.filter((r) => r.status === filter);
  }, [data, filter]);

  if (!data) {
    return (
      <div className="flex items-center justify-center py-32 text-neutral-500">
        {error ?? (
          <span className="inline-flex items-center gap-2 text-sm">
            <Loader2 size={15} className="animate-spin" />
            Loading campaign
          </span>
        )}
      </div>
    );
  }

  const { campaign, counts, recipients } = data;

  const delivered =
    (counts.delivered ?? 0) + (counts.opened ?? 0) + (counts.clicked ?? 0);
  const opened = (counts.opened ?? 0) + (counts.clicked ?? 0);
  const clicked = counts.clicked ?? 0;
  const bounced = (counts.bounced ?? 0) + (counts.complained ?? 0);
  const reached = delivered + bounced + (counts.sent ?? 0);

  const pct = (n: number) =>
    reached > 0 ? Math.round((n / reached) * 100) : 0;

  const stats = [
    {
      icon: Mail,
      label: "Sent",
      value: campaign.sentCount,
      sub: `of ${campaign.total}`,
      bar: campaign.total > 0 ? (campaign.sentCount / campaign.total) * 100 : 0,
      barClass: "bg-neutral-500",
    },
    {
      icon: CheckCheck,
      label: "Delivered",
      value: delivered,
      sub: `${pct(delivered)}%`,
      bar: pct(delivered),
      barClass: "bg-emerald-500",
    },
    {
      icon: Eye,
      label: "Opened",
      value: opened,
      sub: `${pct(opened)}%`,
      bar: pct(opened),
      barClass: "bg-violet-500",
    },
    {
      icon: MousePointerClick,
      label: "Clicked",
      value: clicked,
      sub: `${pct(clicked)}%`,
      bar: pct(clicked),
      barClass: "bg-fuchsia-500",
    },
    {
      icon: TriangleAlert,
      label: "Bounced",
      value: bounced,
      sub: `${pct(bounced)}%`,
      bar: pct(bounced),
      barClass: "bg-red-500",
    },
  ];

  const filterOptions = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  return (
    <div>
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 text-xs text-neutral-500 transition hover:text-neutral-300"
      >
        <ArrowLeft size={13} />
        Back to campaigns
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="truncate text-xl font-semibold">{campaign.name}</h1>
            <StatusChip status={campaign.status} />
          </div>
          <p className="mt-1 truncate text-sm text-neutral-500">
            Subject: {campaign.subjectTemplate}
          </p>
        </div>

        {(campaign.status === "draft" || campaign.status === "failed") && (
          <div className="flex flex-wrap items-center gap-2">
            {showSchedule ? (
              <>
                <input
                  type="datetime-local"
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                  className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-sky-500 [color-scheme:dark]"
                />
                <button
                  onClick={() => startSend(scheduleTime)}
                  disabled={sending || !scheduleTime}
                  className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-400 disabled:opacity-40"
                >
                  <CalendarClock size={15} />
                  {sending ? "Scheduling..." : "Schedule"}
                </button>
                <button
                  onClick={() => setShowSchedule(false)}
                  className="rounded-xl border border-neutral-800 p-2.5 text-neutral-400 transition hover:bg-neutral-900"
                  title="Back"
                >
                  <X size={15} />
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => startSend()}
                  disabled={sending}
                  className="inline-flex items-center gap-2 rounded-xl bg-linear-to-br from-emerald-500 to-teal-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition hover:brightness-110 disabled:opacity-40"
                >
                  {sending ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : campaign.status === "failed" ? (
                    <RefreshCw size={15} />
                  ) : (
                    <Send size={15} />
                  )}
                  {sending
                    ? "Starting..."
                    : campaign.status === "failed"
                      ? "Retry failed sends"
                      : `Send to ${campaign.total} recipients`}
                </button>
                <button
                  onClick={() => setShowSchedule(true)}
                  disabled={sending}
                  className="inline-flex items-center gap-2 rounded-xl border border-neutral-800 px-4 py-2.5 text-sm text-neutral-300 transition hover:bg-neutral-900 disabled:opacity-40"
                >
                  <CalendarClock size={15} />
                  Schedule
                </button>
              </>
            )}
          </div>
        )}

        {campaign.status === "sending" && (
          <span className="inline-flex items-center gap-2 rounded-full bg-amber-500/15 px-4 py-2 text-sm text-amber-300 ring-1 ring-inset ring-amber-500/30">
            <Loader2 size={14} className="animate-spin" />
            Working... {campaign.sentCount}/{campaign.total}
          </span>
        )}

        {campaign.status === "scheduled" && (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full bg-amber-500/15 px-4 py-2 text-sm text-amber-300 ring-1 ring-inset ring-amber-500/30">
              <CalendarClock size={14} />
              {campaign.scheduledAt
                ? new Date(campaign.scheduledAt).toLocaleString()
                : "Scheduled"}
            </span>
            <button
              onClick={cancelSchedule}
              disabled={sending}
              className="inline-flex items-center gap-1.5 rounded-xl border border-red-500/40 px-4 py-2 text-sm text-red-300 transition hover:bg-red-500/10 disabled:opacity-40"
            >
              <X size={14} />
              {sending ? "Cancelling..." : "Cancel"}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-2xl border border-neutral-800/80 bg-neutral-900/60 p-4"
          >
            <div className="flex items-center gap-2 text-neutral-500">
              <s.icon size={14} />
              <p className="text-xs">{s.label}</p>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <p className="text-2xl font-semibold tracking-tight">{s.value}</p>
              <p className="text-xs text-neutral-500">{s.sub}</p>
            </div>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-neutral-800">
              <div
                className={`h-full rounded-full ${s.barClass}`}
                style={{ width: `${Math.min(s.bar, 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setFilter(null)}
            className={`rounded-full px-3 py-1 text-xs transition ${
              filter === null
                ? "bg-neutral-200 font-medium text-neutral-900"
                : "border border-neutral-800 text-neutral-400 hover:bg-neutral-900"
            }`}
          >
            All ({recipients.length})
          </button>
          {filterOptions.map(([status, count]) => (
            <button
              key={status}
              onClick={() => setFilter(filter === status ? null : status)}
              className={`rounded-full px-3 py-1 text-xs transition ${
                filter === status
                  ? "bg-neutral-200 font-medium text-neutral-900"
                  : "border border-neutral-800 text-neutral-400 hover:bg-neutral-900"
              }`}
            >
              {status} ({count})
            </button>
          ))}
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs text-neutral-600">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </span>
          Live, refreshes every 5s
        </span>
      </div>

      <div className="mt-3 overflow-x-auto rounded-2xl border border-neutral-800/80">
        <table className="w-full text-left text-sm">
          <thead className="bg-neutral-900/80 text-xs text-neutral-400">
            <tr>
              <th className="px-4 py-3 font-medium">Recipient</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="hidden px-4 py-3 font-medium sm:table-cell">
                Opened
              </th>
              <th className="hidden px-4 py-3 font-medium sm:table-cell">
                Clicked
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleRecipients.map((r) => (
              <tr
                key={r.id}
                className="border-t border-neutral-800/60 transition hover:bg-neutral-900/40"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-[11px] font-medium text-neutral-300">
                      {(r.name ?? r.email).charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-neutral-200">{r.email}</p>
                      {r.name && (
                        <p className="truncate text-xs text-neutral-500">
                          {r.name}
                        </p>
                      )}
                      {r.error && (
                        <p className="mt-0.5 text-xs text-red-400">{r.error}</p>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <StatusChip status={r.status} />
                </td>
                <td className="hidden px-4 py-3 text-xs text-neutral-400 sm:table-cell">
                  {r.openedAt ? new Date(r.openedAt).toLocaleString() : "-"}
                </td>
                <td className="hidden px-4 py-3 text-xs text-neutral-400 sm:table-cell">
                  {r.clickedAt ? new Date(r.clickedAt).toLocaleString() : "-"}
                </td>
              </tr>
            ))}
            {visibleRecipients.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-10 text-center text-sm text-neutral-500"
                >
                  No recipients match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
