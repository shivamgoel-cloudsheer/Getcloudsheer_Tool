"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CalendarClock,
  CheckCheck,
  Eye,
  FlaskConical,
  ListPlus,
  Loader2,
  Mail,
  MessageSquareReply,
  MousePointerClick,
  RefreshCw,
  Send,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { StatusChip } from "@/components/ui";

type Step = {
  id: string;
  stepNumber: number;
  delayDays: number;
  subjectTemplate: string;
  bodyTemplate: string;
};

type CampaignStatusResponse = {
  campaign: {
    id: string;
    name: string;
    status: string;
    total: number;
    sentCount: number;
    subjectTemplate: string;
    hasVariantB: boolean;
    createdAt: string;
    sentAt: string | null;
    scheduledAt: string | null;
  };
  steps: Step[];
  counts: Record<string, number>;
  recipients: {
    id: string;
    email: string;
    name: string | null;
    status: string;
    variant: "A" | "B";
    sequenceStep: number;
    openedAt: string | null;
    clickedAt: string | null;
    repliedAt: string | null;
    error: string | null;
  }[];
  lastReplyCheckAt: string | null;
};

const ENGAGED = ["delivered", "opened", "clicked", "replied"];

export default function CampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [data, setData] = useState<CampaignStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleTime, setScheduleTime] = useState("");
  const [localTimeMode, setLocalTimeMode] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);
  const [showAddStep, setShowAddStep] = useState(false);
  const [stepDelay, setStepDelay] = useState(3);
  const [stepSubject, setStepSubject] = useState("");
  const [stepBody, setStepBody] = useState("");

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

  async function startSend(schedule?: { time: string; localMode: boolean }) {
    setSending(true);
    setError(null);
    try {
      let body = {};
      if (schedule) {
        if (schedule.localMode) {
          const [date, time] = schedule.time.split("T");
          body = {
            localDate: date,
            localTime: time,
            fallbackTimeZone:
              Intl.DateTimeFormat().resolvedOptions().timeZone,
          };
        } else {
          body = { scheduledAt: new Date(schedule.time).toISOString() };
        }
      }
      const res = await fetch(`/api/campaigns/${id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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

  async function runProcess() {
    setProcessing(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/process", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Processing failed");
      const parts = [
        `${json.repliesFound} new repl${json.repliesFound === 1 ? "y" : "ies"}`,
        `${json.followUpsSent} follow-up${json.followUpsSent === 1 ? "" : "s"} sent`,
        `${json.sheetsSynced} sheet${json.sheetsSynced === 1 ? "" : "s"} synced`,
      ];
      setNotice(parts.join(" · "));
      if (json.errors?.length) setError(json.errors.join(" / "));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Processing failed");
    } finally {
      setProcessing(false);
    }
  }

  async function addStep() {
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${id}/steps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          delayDays: stepDelay,
          subjectTemplate: stepSubject,
          bodyTemplate: stepBody,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to add step");
      setShowAddStep(false);
      setStepSubject("");
      setStepBody("");
      setStepDelay(3);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add step");
    }
  }

  async function removeStep(stepId: string) {
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${id}/steps`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to remove step");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove step");
    }
  }

  const visibleRecipients = useMemo(() => {
    if (!data) return [];
    if (!filter) return data.recipients;
    return data.recipients.filter((r) => r.status === filter);
  }, [data, filter]);

  const abStats = useMemo(() => {
    if (!data?.campaign.hasVariantB) return null;
    const compute = (variant: "A" | "B") => {
      const group = data.recipients.filter((r) => r.variant === variant);
      const reached = group.filter((r) =>
        ["sent", ...ENGAGED, "bounced", "complained"].includes(r.status)
      ).length;
      const opened = group.filter((r) =>
        ["opened", "clicked", "replied"].includes(r.status)
      ).length;
      const clicked = group.filter((r) => r.status === "clicked").length;
      const replied = group.filter((r) => r.repliedAt).length;
      return { total: group.length, reached, opened, clicked, replied };
    };
    return { A: compute("A"), B: compute("B") };
  }, [data]);

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

  const { campaign, steps, counts, recipients } = data;

  const replied = counts.replied ?? 0;
  const delivered =
    (counts.delivered ?? 0) +
    (counts.opened ?? 0) +
    (counts.clicked ?? 0) +
    replied;
  const opened = (counts.opened ?? 0) + (counts.clicked ?? 0) + replied;
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
      icon: MessageSquareReply,
      label: "Replied",
      value: replied,
      sub: `${pct(replied)}%`,
      bar: pct(replied),
      barClass: "bg-teal-500",
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
            {campaign.hasVariantB && (
              <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2.5 py-0.5 text-xs font-medium text-sky-300 ring-1 ring-inset ring-sky-500/30">
                <FlaskConical size={11} />
                A/B
              </span>
            )}
          </div>
          <p className="mt-1 truncate text-sm text-neutral-500">
            Subject: {campaign.subjectTemplate}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {campaign.status !== "draft" && (
            <button
              onClick={runProcess}
              disabled={processing}
              title="Check Gmail for replies, send due follow-ups, sync the sheet"
              className="inline-flex items-center gap-2 rounded-xl border border-neutral-800 px-4 py-2.5 text-sm text-neutral-300 transition hover:bg-neutral-900 disabled:opacity-40"
            >
              {processing ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <RefreshCw size={15} />
              )}
              {processing ? "Checking..." : "Check replies + sync"}
            </button>
          )}

          {(campaign.status === "draft" || campaign.status === "failed") && (
            <>
              {showSchedule ? (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900/60 p-2">
                  <input
                    type="datetime-local"
                    value={scheduleTime}
                    onChange={(e) => setScheduleTime(e.target.value)}
                    className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-sky-500 [color-scheme:dark]"
                  />
                  <label
                    className="flex cursor-pointer items-center gap-1.5 px-1 text-xs text-neutral-400"
                    title="Each recipient gets the email at this wall-clock time in their own timezone, read from a Timezone column in your sheet"
                  >
                    <input
                      type="checkbox"
                      checked={localTimeMode}
                      onChange={(e) => setLocalTimeMode(e.target.checked)}
                      className="h-3.5 w-3.5 rounded accent-sky-500"
                    />
                    Recipient local time
                  </label>
                  <button
                    onClick={() =>
                      startSend({ time: scheduleTime, localMode: localTimeMode })
                    }
                    disabled={sending || !scheduleTime}
                    className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-400 disabled:opacity-40"
                  >
                    <CalendarClock size={14} />
                    {sending ? "Scheduling..." : "Schedule"}
                  </button>
                  <button
                    onClick={() => setShowSchedule(false)}
                    className="rounded-lg border border-neutral-800 p-2 text-neutral-400 transition hover:bg-neutral-900"
                    title="Back"
                  >
                    <X size={14} />
                  </button>
                </div>
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
            </>
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
      </div>

      {notice && (
        <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {notice}
        </div>
      )}
      {error && (
        <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
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

      {/* A/B comparison */}
      {abStats && (
        <div className="mt-4 rounded-2xl border border-neutral-800/80 bg-neutral-900/60 p-5">
          <div className="flex items-center gap-2">
            <FlaskConical size={15} className="text-sky-400" />
            <h2 className="text-sm font-semibold">A/B results</h2>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {(["A", "B"] as const).map((v) => {
              const s = abStats[v];
              const rate = (n: number) =>
                s.reached > 0 ? `${Math.round((n / s.reached) * 100)}%` : "-";
              return (
                <div
                  key={v}
                  className="rounded-xl border border-neutral-800 bg-neutral-950/50 p-4"
                >
                  <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                    Variant {v}
                    <span className="ml-2 font-normal normal-case tracking-normal text-neutral-600">
                      {s.total} recipients
                    </span>
                  </p>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-lg font-semibold">{rate(s.opened)}</p>
                      <p className="text-xs text-neutral-500">opened</p>
                    </div>
                    <div>
                      <p className="text-lg font-semibold">{rate(s.clicked)}</p>
                      <p className="text-xs text-neutral-500">clicked</p>
                    </div>
                    <div>
                      <p className="text-lg font-semibold">{rate(s.replied)}</p>
                      <p className="text-xs text-neutral-500">replied</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Follow-up sequence */}
      <div className="mt-4 rounded-2xl border border-neutral-800/80 bg-neutral-900/60 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ListPlus size={15} className="text-sky-400" />
            <h2 className="text-sm font-semibold">Follow-up sequence</h2>
          </div>
          {!showAddStep && steps.length < 5 && (
            <button
              onClick={() => setShowAddStep(true)}
              className="rounded-lg border border-neutral-800 px-3 py-1.5 text-xs text-neutral-300 transition hover:bg-neutral-900"
            >
              Add step
            </button>
          )}
        </div>
        <p className="mt-1 text-xs text-neutral-500">
          Follow-ups go to recipients who haven&apos;t replied, bounced, or
          unsubscribed. They&apos;re sent by the daily background check or when
          you press &quot;Check replies + sync&quot;.
        </p>

        {steps.length === 0 && !showAddStep && (
          <p className="mt-4 text-sm text-neutral-600">
            No follow-ups yet. Most replies come from follow-up 1 and 2.
          </p>
        )}

        {steps.length > 0 && (
          <ol className="mt-4 space-y-2">
            {steps.map((s) => (
              <li
                key={s.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-950/50 p-3.5"
              >
                <div className="min-w-0">
                  <p className="text-xs font-medium text-sky-300">
                    Step {s.stepNumber} · {s.delayDays} day
                    {s.delayDays === 1 ? "" : "s"} after the previous email
                  </p>
                  <p className="mt-1 truncate text-sm text-neutral-200">
                    {s.subjectTemplate}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-neutral-500">
                    {s.bodyTemplate}
                  </p>
                </div>
                <button
                  onClick={() => removeStep(s.id)}
                  title="Remove step"
                  className="shrink-0 rounded-lg p-1.5 text-neutral-600 transition hover:bg-red-500/10 hover:text-red-400"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ol>
        )}

        {showAddStep && (
          <div className="mt-4 space-y-3 rounded-xl border border-neutral-800 bg-neutral-950/50 p-4">
            <div className="flex items-center gap-2">
              <label className="text-xs text-neutral-400">Send</label>
              <input
                type="number"
                min={1}
                max={30}
                value={stepDelay}
                onChange={(e) => setStepDelay(Number(e.target.value))}
                className="w-16 rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-sky-500"
              />
              <label className="text-xs text-neutral-400">
                days after the previous email
              </label>
            </div>
            <input
              placeholder="Subject, e.g. Re: {{Subject}}"
              value={stepSubject}
              onChange={(e) => setStepSubject(e.target.value)}
              className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 outline-none focus:border-sky-500"
            />
            <textarea
              placeholder={"Hi {{Name}}, just floating this back up..."}
              value={stepBody}
              onChange={(e) => setStepBody(e.target.value)}
              className="min-h-24 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-[13px] text-neutral-100 placeholder-neutral-600 outline-none focus:border-sky-500"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowAddStep(false)}
                className="rounded-lg border border-neutral-800 px-3 py-1.5 text-xs text-neutral-400 transition hover:bg-neutral-900"
              >
                Cancel
              </button>
              <button
                onClick={addStep}
                disabled={!stepSubject.trim() || !stepBody.trim()}
                className="rounded-lg bg-sky-500 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-400 disabled:opacity-40"
              >
                Add step
              </button>
            </div>
          </div>
        )}
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
              {campaign.hasVariantB && (
                <th className="hidden px-4 py-3 font-medium sm:table-cell">
                  Variant
                </th>
              )}
              <th className="hidden px-4 py-3 font-medium sm:table-cell">
                Step
              </th>
              <th className="hidden px-4 py-3 font-medium md:table-cell">
                Opened
              </th>
              <th className="hidden px-4 py-3 font-medium md:table-cell">
                Replied
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
                {campaign.hasVariantB && (
                  <td className="hidden px-4 py-3 text-xs text-neutral-400 sm:table-cell">
                    {r.variant}
                  </td>
                )}
                <td className="hidden px-4 py-3 text-xs text-neutral-400 sm:table-cell">
                  {r.sequenceStep > 0 ? `+${r.sequenceStep}` : "-"}
                </td>
                <td className="hidden px-4 py-3 text-xs text-neutral-400 md:table-cell">
                  {r.openedAt ? new Date(r.openedAt).toLocaleString() : "-"}
                </td>
                <td className="hidden px-4 py-3 text-xs text-neutral-400 md:table-cell">
                  {r.repliedAt ? new Date(r.repliedAt).toLocaleString() : "-"}
                </td>
              </tr>
            ))}
            {visibleRecipients.length === 0 && (
              <tr>
                <td
                  colSpan={campaign.hasVariantB ? 6 : 5}
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
