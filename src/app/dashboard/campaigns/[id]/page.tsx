"use client";

import { use, useCallback, useEffect, useState } from "react";

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

const CHIP_STYLES: Record<string, string> = {
  pending: "bg-neutral-700/50 text-neutral-300",
  suppressed: "bg-neutral-700/50 text-neutral-500",
  scheduled: "bg-amber-500/15 text-amber-400",
  sent: "bg-sky-500/15 text-sky-400",
  delivered: "bg-emerald-500/15 text-emerald-400",
  opened: "bg-violet-500/15 text-violet-400",
  clicked: "bg-fuchsia-500/15 text-fuchsia-400",
  bounced: "bg-red-500/15 text-red-400",
  complained: "bg-red-500/15 text-red-400",
  failed: "bg-red-500/15 text-red-400",
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

  if (!data) {
    return (
      <p className="text-sm text-neutral-500">
        {error ?? "Loading campaign..."}
      </p>
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
    reached > 0 ? `${Math.round((n / reached) * 100)}%` : "0%";

  const stats = [
    { label: "Sent", value: campaign.sentCount, sub: `of ${campaign.total}` },
    { label: "Delivered", value: delivered, sub: pct(delivered) },
    { label: "Opened", value: opened, sub: pct(opened) },
    { label: "Clicked", value: clicked, sub: pct(clicked) },
    { label: "Bounced", value: bounced, sub: pct(bounced) },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{campaign.name}</h1>
          <p className="mt-1 text-xs text-neutral-500">
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
                  className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-sky-500 [color-scheme:dark]"
                />
                <button
                  onClick={() => startSend(scheduleTime)}
                  disabled={sending || !scheduleTime}
                  className="rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-amber-400 disabled:opacity-40"
                >
                  {sending ? "Scheduling..." : "Schedule"}
                </button>
                <button
                  onClick={() => setShowSchedule(false)}
                  className="rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-400 transition hover:bg-neutral-800"
                >
                  Back
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => startSend()}
                  disabled={sending}
                  className="rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-400 disabled:opacity-40"
                >
                  {sending
                    ? "Starting..."
                    : campaign.status === "failed"
                      ? "Retry failed sends"
                      : `Send to ${campaign.total} recipients`}
                </button>
                <button
                  onClick={() => setShowSchedule(true)}
                  disabled={sending}
                  className="rounded-lg border border-neutral-700 px-4 py-2.5 text-sm text-neutral-300 transition hover:bg-neutral-800 disabled:opacity-40"
                >
                  Schedule for later
                </button>
              </>
            )}
          </div>
        )}
        {campaign.status === "sending" && (
          <span className="rounded-full bg-amber-500/15 px-4 py-1.5 text-sm text-amber-400">
            Working... {campaign.sentCount}/{campaign.total}
          </span>
        )}
        {campaign.status === "scheduled" && (
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-amber-500/15 px-4 py-1.5 text-sm text-amber-400">
              Scheduled for{" "}
              {campaign.scheduledAt
                ? new Date(campaign.scheduledAt).toLocaleString()
                : "later"}
            </span>
            <button
              onClick={cancelSchedule}
              disabled={sending}
              className="rounded-lg border border-red-500/40 px-4 py-2 text-sm text-red-400 transition hover:bg-red-500/10 disabled:opacity-40"
            >
              {sending ? "Cancelling..." : "Cancel schedule"}
            </button>
          </div>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-neutral-800 bg-neutral-900 p-4"
          >
            <p className="text-xs text-neutral-500">{s.label}</p>
            <p className="mt-1 text-2xl font-semibold">{s.value}</p>
            <p className="text-xs text-neutral-500">{s.sub}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border border-neutral-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-neutral-900 text-xs text-neutral-400">
            <tr>
              <th className="px-4 py-3 font-medium">Recipient</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Opened</th>
              <th className="px-4 py-3 font-medium">Clicked</th>
            </tr>
          </thead>
          <tbody>
            {recipients.map((r) => (
              <tr key={r.id} className="border-t border-neutral-800/70">
                <td className="px-4 py-2.5">
                  <p className="text-neutral-200">{r.email}</p>
                  {r.name && (
                    <p className="text-xs text-neutral-500">{r.name}</p>
                  )}
                  {r.error && (
                    <p className="text-xs text-red-400">{r.error}</p>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      CHIP_STYLES[r.status] ?? CHIP_STYLES.pending
                    }`}
                  >
                    {r.status}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs text-neutral-400">
                  {r.openedAt ? new Date(r.openedAt).toLocaleString() : "-"}
                </td>
                <td className="px-4 py-2.5 text-xs text-neutral-400">
                  {r.clickedAt ? new Date(r.clickedAt).toLocaleString() : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
