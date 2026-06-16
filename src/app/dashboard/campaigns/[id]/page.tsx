"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CalendarClock,
  CheckCheck,
  FlaskConical,
  ListPlus,
  Loader2,
  Mail,
  MessageSquareReply,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
  TriangleAlert,
  X,
  Zap,
} from "lucide-react";
import { StatusChip } from "@/components/ui";
import { COUNTRY_OPTIONS } from "@/lib/geo";
import { zonedTimeToUtc } from "@/lib/timezone";

type Step = {
  id: string;
  stepNumber: number;
  delayDays: number;
  scheduledAt: string | null;
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
    staggerConfig: {
      gapMinutes: number;
      dailyCap: number;
      windowStart: string;
      windowEnd: string;
      skipWeekends: boolean;
      timeZone: string;
      warmup: boolean;
      perRecipientTimeZone?: boolean;
    } | null;
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
    replySnippet: string | null;
    replySubject: string | null;
    error: string | null;
  }[];
  lastReplyCheckAt: string | null;
};

type ReplyView = {
  recipientId: string;
  email: string;
  loading: boolean;
  error?: string;
  data?: { from: string; subject: string; date: string; body: string };
};

const ENGAGED = ["delivered", "opened", "clicked", "replied"];

export default function CampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [data, setData] = useState<CampaignStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleTime, setScheduleTime] = useState("");
  const [gapMinutes, setGapMinutes] = useState(3);
  const [dailyCap, setDailyCap] = useState(40);
  const [windowStart, setWindowStart] = useState("09:00");
  const [windowEnd, setWindowEnd] = useState("17:00");
  const [skipWeekends, setSkipWeekends] = useState(true);
  const [warmup, setWarmup] = useState(true);
  const [recipientLocalTz, setRecipientLocalTz] = useState(false);
  // "" = use my (browser) timezone; otherwise a chosen country's IANA zone.
  const [windowTz, setWindowTz] = useState("");
  const [filter, setFilter] = useState<string | null>(null);
  const [replyView, setReplyView] = useState<ReplyView | null>(null);
  const [showAddStep, setShowAddStep] = useState(false);
  const [stepDelay, setStepDelay] = useState(3);
  const [stepSubject, setStepSubject] = useState("");
  const [stepBody, setStepBody] = useState("");
  // "days" = N days after previous email; "date" = an exact date/time.
  const [stepMode, setStepMode] = useState<"days" | "date">("days");
  const [stepScheduledAt, setStepScheduledAt] = useState("");
  // "" = my (browser) timezone; otherwise a chosen country's IANA zone.
  const [stepTz, setStepTz] = useState("");
  // Optional sheet re-upload to refresh recipients' personalization data.
  const [stepSheetUrl, setStepSheetUrl] = useState("");
  const [stepSheetTab, setStepSheetTab] = useState<string | null>(null);
  const [stepSheetCols, setStepSheetCols] = useState<string[] | null>(null);
  const [stepSelectedCols, setStepSelectedCols] = useState<string[]>([]);
  const [stepSheetLoading, setStepSheetLoading] = useState(false);
  const [stepSheetMsg, setStepSheetMsg] = useState<string | null>(null);

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

  // ISO -> the value a <input type="datetime-local"> expects (local time).
  function toLocalInput(iso: string): string {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
      d.getDate()
    )}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // Open the drip dialog, prefilling from any settings saved on the draft.
  function openSchedule() {
    const cfg = data?.campaign.staggerConfig;
    if (cfg) {
      setGapMinutes(cfg.gapMinutes);
      setDailyCap(cfg.dailyCap);
      setWindowStart(cfg.windowStart);
      setWindowEnd(cfg.windowEnd);
      setSkipWeekends(cfg.skipWeekends);
      setWarmup(cfg.warmup);
      setRecipientLocalTz(cfg.perRecipientTimeZone ?? false);
      const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const known = COUNTRY_OPTIONS.some((c) => c.timeZone === cfg.timeZone);
      setWindowTz(
        cfg.timeZone && cfg.timeZone !== browserTz && known ? cfg.timeZone : ""
      );
    }
    if (data?.campaign.scheduledAt) {
      setScheduleTime(toLocalInput(data.campaign.scheduledAt));
    }
    setShowSchedule(true);
  }

  function staggerBody() {
    return {
      ...(scheduleTime
        ? { scheduledAt: new Date(scheduleTime).toISOString() }
        : {}),
      stagger: {
        gapMinutes,
        dailyCap,
        windowStart,
        windowEnd,
        skipWeekends,
        warmup,
        perRecipientTimeZone: recipientLocalTz,
        timeZone: windowTz || Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    };
  }

  // Save the drip settings (and start time) onto the draft without sending,
  // so the campaign can be scheduled or sent later with these defaults.
  async function saveSchedule() {
    setSending(true);
    setError(null);
    try {
      const body = staggerBody();
      const res = await fetch(`/api/campaigns/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stagger: body.stagger,
          scheduledAt: scheduleTime
            ? new Date(scheduleTime).toISOString()
            : null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to save");
      setShowSchedule(false);
      setNotice("Saved. You can schedule or send this campaign later.");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSending(false);
    }
  }

  // Sending is always a drip. An optional start time only moves when the
  // first email goes out; the send still spreads over the window.
  async function startSend() {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(staggerBody()),
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

  // Instant send: every recipient goes out right now, no drip/window. The
  // server still skips suppressed addresses and trims to the daily cap.
  async function instantSend() {
    if (
      !window.confirm(
        `Send to all ${campaign?.total ?? 0} recipients right now? This goes out immediately, with no delay or send window.`
      )
    ) {
      return;
    }
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instant: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to send");
      setShowSchedule(false);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send");
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
        `${json.bouncesFound ?? 0} bounce${json.bouncesFound === 1 ? "" : "s"}`,
        `${json.followUpsSent} follow-up${json.followUpsSent === 1 ? "" : "s"} queued`,
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

  // Load the columns from a re-uploaded sheet so they can be picked for refresh.
  async function loadStepSheet() {
    if (!stepSheetUrl.trim()) return;
    setStepSheetLoading(true);
    setStepSheetMsg(null);
    setError(null);
    try {
      const res = await fetch("/api/sheets/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheetUrl: stepSheetUrl.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to read sheet");
      setStepSheetCols(json.headers as string[]);
      setStepSelectedCols(json.headers as string[]);
      setStepSheetTab(json.selectedTab ?? null);
      setStepSheetMsg(`${json.totalRows} rows · pick the columns to refresh`);
    } catch (e) {
      setStepSheetCols(null);
      setStepSheetMsg(e instanceof Error ? e.message : "Failed to read sheet");
    } finally {
      setStepSheetLoading(false);
    }
  }

  function resetStepForm() {
    setShowAddStep(false);
    setStepSubject("");
    setStepBody("");
    setStepDelay(3);
    setStepMode("days");
    setStepScheduledAt("");
    setStepTz("");
    setStepSheetUrl("");
    setStepSheetTab(null);
    setStepSheetCols(null);
    setStepSelectedCols([]);
    setStepSheetMsg(null);
  }

  // The follow-up date in the chosen timezone, as a UTC ISO string. With "my
  // timezone" the browser-local datetime is used directly.
  function stepScheduledAtIso(): string {
    if (!stepTz) return new Date(stepScheduledAt).toISOString();
    const [date, time] = stepScheduledAt.split("T");
    return (zonedTimeToUtc(date, time, stepTz) ?? new Date(stepScheduledAt)).toISOString();
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
          ...(stepMode === "date" && stepScheduledAt
            ? { scheduledAt: stepScheduledAtIso() }
            : {}),
          ...(stepSheetUrl.trim() && stepSheetCols
            ? {
                sheetUrl: stepSheetUrl.trim(),
                ...(stepSheetTab ? { sheetTab: stepSheetTab } : {}),
                selectedColumns: stepSelectedCols,
              }
            : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to add step");
      if (json.refreshed > 0) {
        setNotice(`Follow-up added · refreshed ${json.refreshed} recipients`);
      }
      resetStepForm();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add step");
    }
  }

  // Open the reply viewer and load the full body from Gmail on demand.
  async function viewReply(recipientId: string, email: string) {
    setReplyView({ recipientId, email, loading: true });
    try {
      const res = await fetch(
        `/api/campaigns/${id}/recipients/${recipientId}/reply`,
        { cache: "no-store" }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load reply");
      setReplyView({ recipientId, email, loading: false, data: json });
    } catch (e) {
      setReplyView({
        recipientId,
        email,
        loading: false,
        error: e instanceof Error ? e.message : "Failed to load reply",
      });
    }
  }

  // Act on scheduled recipients: pull back to pending, or delete the mail.
  async function recipientAction(ids: string[], action: "pending" | "delete") {
    if (
      action === "delete" &&
      !window.confirm(
        `Delete ${ids.length} scheduled email${ids.length === 1 ? "" : "s"}? This removes the recipient${ids.length === 1 ? "" : "s"} from the campaign.`
      )
    ) {
      return;
    }
    setError(null);
    setSending(true);
    try {
      const res = await fetch(`/api/campaigns/${id}/recipients`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientIds: ids, action }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Action failed");
      setNotice(
        action === "pending"
          ? `${json.updated} moved back to pending`
          : `${json.deleted} scheduled email${json.deleted === 1 ? "" : "s"} deleted`
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setSending(false);
    }
  }

  async function deleteCampaign() {
    const scheduled = data?.counts.scheduled ?? 0;
    const message =
      scheduled > 0
        ? `Delete this campaign? ${scheduled} still-queued email${scheduled === 1 ? "" : "s"} will be cancelled. This cannot be undone.`
        : "Delete this campaign and all its tracking data? This cannot be undone.";
    if (!window.confirm(message)) return;

    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to delete campaign");
      router.push("/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete campaign");
      setSending(false);
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
      const replied = group.filter((r) => r.repliedAt).length;
      return { total: group.length, reached, replied };
    };
    return { A: compute("A"), B: compute("B") };
  }, [data]);

  if (!data) {
    return (
      <div className="flex items-center justify-center py-32 text-slate-500">
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
  // Resend-era statuses still count as reached for historical campaigns
  const legacyEngaged =
    (counts.delivered ?? 0) + (counts.opened ?? 0) + (counts.clicked ?? 0);
  const bounced = (counts.bounced ?? 0) + (counts.complained ?? 0);
  const queued = counts.scheduled ?? 0;
  const reached = (counts.sent ?? 0) + legacyEngaged + replied + bounced;

  const pct = (n: number) =>
    reached > 0 ? Math.round((n / reached) * 100) : 0;

  // Reply-centric: Gmail sending has no delivery/open/click events, and
  // text-only cold email has no tracking pixel anyway. Replies and bounces
  // are detected from each sender's own inbox.
  const stats = [
    {
      icon: Mail,
      label: "Sent",
      value: campaign.sentCount,
      sub: `of ${campaign.total}`,
      bar: campaign.total > 0 ? (campaign.sentCount / campaign.total) * 100 : 0,
      barClass: "bg-slate-400",
    },
    {
      icon: CheckCheck,
      label: "Queued",
      value: queued,
      sub: campaign.total > 0 ? `of ${campaign.total}` : "",
      bar: campaign.total > 0 ? (queued / campaign.total) * 100 : 0,
      barClass: "bg-emerald-500",
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
        className="inline-flex items-center gap-1.5 text-xs text-slate-500 transition hover:text-slate-700"
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
              <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2.5 py-0.5 text-xs font-medium text-sky-700 ring-1 ring-inset ring-sky-500/30">
                <FlaskConical size={11} />
                A/B
              </span>
            )}
          </div>
          <p className="mt-1 truncate text-sm text-slate-500">
            Subject: {campaign.subjectTemplate}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {campaign.status !== "draft" && (
            <button
              onClick={runProcess}
              disabled={processing}
              title="Check Gmail for replies, send due follow-ups, sync the sheet"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
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
                <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-xl sm:w-auto">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">Drip send options</p>
                    <button
                      onClick={() => setShowSchedule(false)}
                      className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                      title="Close"
                    >
                      <X size={14} />
                    </button>
                  </div>

                  <div className="mt-3 space-y-3">
                    <div>
                      <label className="mb-1 block text-xs text-slate-500">
                        Start time{" "}
                        <span className="text-slate-400">
                          (leave empty to start now)
                        </span>
                      </label>
                      <input
                        type="datetime-local"
                        value={scheduleTime}
                        onChange={(e) => setScheduleTime(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
                      />
                    </div>

                    <p className="text-xs text-slate-500">
                      Every campaign is dripped: emails go out one at a time
                      with a gap, only inside the window, capped per day per
                      sender.
                    </p>

                    <div className="space-y-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="grid grid-cols-2 gap-2.5">
                        <div>
                          <label className="mb-1 block text-xs text-slate-500">
                            Gap between emails (min)
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={240}
                            value={gapMinutes}
                            onChange={(e) =>
                              setGapMinutes(Number(e.target.value))
                            }
                            className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-slate-500">
                            Max per day / sender
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={100}
                            value={dailyCap}
                            onChange={(e) =>
                              setDailyCap(
                                Math.min(100, Math.max(1, Number(e.target.value)))
                              )
                            }
                            className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2.5">
                        <div>
                          <label className="mb-1 block text-xs text-slate-500">
                            Window start
                          </label>
                          <input
                            type="time"
                            value={windowStart}
                            onChange={(e) => setWindowStart(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-slate-500">
                            Window end
                          </label>
                          <input
                            type="time"
                            value={windowEnd}
                            onChange={(e) => setWindowEnd(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-slate-500">
                          Window timezone (country)
                        </label>
                        <select
                          value={windowTz}
                          onChange={(e) => setWindowTz(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
                        >
                          <option value="">My timezone</option>
                          {COUNTRY_OPTIONS.map((c) => (
                            <option key={c.timeZone} value={c.timeZone}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                        <p className="mt-1 text-xs text-slate-400">
                          The {windowStart}-{windowEnd} window runs in this
                          country&apos;s local time.
                          {recipientLocalTz
                            ? " (Used only as the fallback when recipient local time is on below.)"
                            : ""}
                        </p>
                      </div>
                      <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-500">
                        <input
                          type="checkbox"
                          checked={skipWeekends}
                          onChange={(e) => setSkipWeekends(e.target.checked)}
                          className="h-3.5 w-3.5 rounded accent-sky-500"
                        />
                        Skip weekends
                      </label>
                      <label
                        className="flex cursor-pointer items-center gap-2 text-xs text-slate-500"
                        title="New sender mailboxes ramp up gradually (10/day, +25% every 3 days) to the cap to protect reputation"
                      >
                        <input
                          type="checkbox"
                          checked={warmup}
                          onChange={(e) => setWarmup(e.target.checked)}
                          className="h-3.5 w-3.5 rounded accent-sky-500"
                        />
                        Warm-up new senders (ramp up to the cap)
                      </label>
                      <label
                        className="flex cursor-pointer items-center gap-2 text-xs text-slate-500"
                        title="Each recipient is sent inside their own country's business hours, read from a Country or Timezone column in your sheet (keep that column included)"
                      >
                        <input
                          type="checkbox"
                          checked={recipientLocalTz}
                          onChange={(e) => setRecipientLocalTz(e.target.checked)}
                          className="h-3.5 w-3.5 rounded accent-sky-500"
                        />
                        Send in each recipient&apos;s local time (Country/Timezone
                        column)
                      </label>
                      <p className="text-xs text-amber-600">
                        Sends happen only inside the window. A start time
                        outside it rolls to the next window opening.
                      </p>
                      <p className="text-xs text-slate-500">
                        {(() => {
                          const remaining =
                            campaign.total - campaign.sentCount > 0
                              ? campaign.total - campaign.sentCount
                              : campaign.total;
                          const [sh, sm] = windowStart.split(":").map(Number);
                          const [eh, em] = windowEnd.split(":").map(Number);
                          const windowMin = Math.max(
                            eh * 60 + em - (sh * 60 + sm),
                            1
                          );
                          const perDay = Math.max(
                            Math.min(
                              dailyCap,
                              Math.floor(windowMin / Math.max(gapMinutes, 1))
                            ),
                            1
                          );
                          const days = Math.ceil(remaining / perDay);
                          return `≈ ${Math.min(perDay, remaining)} emails/day, finishes in about ${days} day${days === 1 ? "" : "s"}${warmup ? " (longer while a new sender warms up)" : ""}`;
                        })()}
                      </p>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => saveSchedule()}
                        disabled={sending}
                        title="Save these settings to this draft and schedule or send it later"
                        className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
                      >
                        <Save size={14} />
                        {sending ? "Saving..." : "Save for later"}
                      </button>
                      <button
                        onClick={() => startSend()}
                        disabled={sending}
                        className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-400 disabled:opacity-40"
                      >
                        <CalendarClock size={14} />
                        {sending ? "Scheduling..." : "Start drip send"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={openSchedule}
                    disabled={sending}
                    className="inline-flex items-center gap-2 rounded-xl bg-linear-to-br from-emerald-500 to-teal-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition hover:brightness-110 disabled:opacity-40"
                  >
                    {sending ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : campaign.status === "failed" ? (
                      <RefreshCw size={15} />
                    ) : (
                      <CalendarClock size={15} />
                    )}
                    {campaign.status === "failed"
                      ? "Retry failed sends"
                      : `Schedule drip (${campaign.total})`}
                  </button>
                  <button
                    onClick={() => instantSend()}
                    disabled={sending}
                    title="Send to everyone immediately, with no delay or send window"
                    className="inline-flex items-center gap-2 rounded-xl bg-linear-to-br from-sky-500 to-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition hover:brightness-110 disabled:opacity-40"
                  >
                    {sending ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <Zap size={15} />
                    )}
                    Send now
                  </button>
                </div>
              )}
            </>
          )}

          {campaign.status === "sending" && (
            <span className="inline-flex items-center gap-2 rounded-full bg-amber-500/15 px-4 py-2 text-sm text-amber-700 ring-1 ring-inset ring-amber-500/30">
              <Loader2 size={14} className="animate-spin" />
              Working... {campaign.sentCount}/{campaign.total}
            </span>
          )}

          {campaign.status === "scheduled" && (
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full bg-amber-500/15 px-4 py-2 text-sm text-amber-700 ring-1 ring-inset ring-amber-500/30">
                <CalendarClock size={14} />
                {campaign.scheduledAt
                  ? new Date(campaign.scheduledAt).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                      timeZone: campaign.staggerConfig?.timeZone || undefined,
                      timeZoneName: "short",
                    })
                  : "Scheduled"}
              </span>
              <button
                onClick={cancelSchedule}
                disabled={sending}
                className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-white px-4 py-2 text-sm text-red-600 transition hover:bg-red-50 disabled:opacity-40"
              >
                <X size={14} />
                {sending ? "Cancelling..." : "Cancel"}
              </button>
            </div>
          )}

          <button
            onClick={deleteCampaign}
            disabled={sending}
            title="Delete campaign"
            className="rounded-xl border border-slate-300 bg-white p-2.5 text-slate-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {notice && (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {notice}
        </div>
      )}
      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="flex items-center gap-2 text-slate-500">
              <s.icon size={14} />
              <p className="text-xs">{s.label}</p>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <p className="text-2xl font-semibold tracking-tight text-slate-900">{s.value}</p>
              <p className="text-xs text-slate-500">{s.sub}</p>
            </div>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-slate-100">
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
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <FlaskConical size={15} className="text-sky-500" />
            <h2 className="text-sm font-semibold text-slate-900">A/B results</h2>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {(["A", "B"] as const).map((v) => {
              const s = abStats[v];
              const rate = (n: number) =>
                s.reached > 0 ? `${Math.round((n / s.reached) * 100)}%` : "-";
              return (
                <div
                  key={v}
                  className="rounded-xl border border-slate-200 bg-slate-50 p-4"
                >
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Variant {v}
                    <span className="ml-2 font-normal normal-case tracking-normal text-slate-400">
                      {s.total} recipients
                    </span>
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-center">
                    <div>
                      <p className="text-lg font-semibold text-slate-900">{s.reached}</p>
                      <p className="text-xs text-slate-500">reached</p>
                    </div>
                    <div>
                      <p className="text-lg font-semibold text-slate-900">{rate(s.replied)}</p>
                      <p className="text-xs text-slate-500">replied</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Follow-up sequence */}
      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ListPlus size={15} className="text-sky-500" />
            <h2 className="text-sm font-semibold text-slate-900">Follow-up sequence</h2>
          </div>
          {!showAddStep && steps.length < 5 && (
            <button
              onClick={() => setShowAddStep(true)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 transition hover:bg-slate-50"
            >
              Add step
            </button>
          )}
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Follow-ups go to recipients who haven&apos;t replied, bounced, or
          unsubscribed, threaded under the original email. Start the subject
          with &quot;Re:&quot; so they thread on the recipient&apos;s side too.
        </p>

        {steps.length === 0 && !showAddStep && (
          <p className="mt-4 text-sm text-slate-400">
            No follow-ups yet. Most replies come from follow-up 1 and 2.
          </p>
        )}

        {steps.length > 0 && (
          <ol className="mt-4 space-y-2">
            {steps.map((s) => (
              <li
                key={s.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5"
              >
                <div className="min-w-0">
                  <p className="text-xs font-medium text-sky-700">
                    Step {s.stepNumber} ·{" "}
                    {s.scheduledAt
                      ? `on ${new Date(s.scheduledAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}`
                      : `${s.delayDays} day${s.delayDays === 1 ? "" : "s"} after the previous email`}
                  </p>
                  <p className="mt-1 truncate text-sm text-slate-800">
                    {s.subjectTemplate}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">
                    {s.bodyTemplate}
                  </p>
                </div>
                <button
                  onClick={() => removeStep(s.id)}
                  title="Remove step"
                  className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ol>
        )}

        {showAddStep && (
          <div className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            {/* When to send: relative days OR an exact date/time */}
            <div className="space-y-2">
              <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 text-xs">
                <button
                  onClick={() => setStepMode("days")}
                  className={`rounded-md px-2.5 py-1 transition ${
                    stepMode === "days"
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Days after previous
                </button>
                <button
                  onClick={() => setStepMode("date")}
                  className={`rounded-md px-2.5 py-1 transition ${
                    stepMode === "date"
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Specific date &amp; time
                </button>
              </div>
              {stepMode === "days" ? (
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-500">Send</label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={stepDelay}
                    onChange={(e) => setStepDelay(Number(e.target.value))}
                    className="w-16 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
                  />
                  <label className="text-xs text-slate-500">
                    days after the previous email
                  </label>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-xs text-slate-500">Send on</label>
                  <input
                    type="datetime-local"
                    value={stepScheduledAt}
                    onChange={(e) => setStepScheduledAt(e.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
                  />
                  <select
                    value={stepTz}
                    onChange={(e) => setStepTz(e.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
                  >
                    <option value="">My timezone</option>
                    {COUNTRY_OPTIONS.map((c) => (
                      <option key={c.timeZone} value={c.timeZone}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <input
              placeholder="Subject, e.g. Re: {{Subject}}"
              value={stepSubject}
              onChange={(e) => setStepSubject(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
            />
            <textarea
              placeholder={"Hi {{Name}}, just floating this back up..."}
              value={stepBody}
              onChange={(e) => setStepBody(e.target.value)}
              className="min-h-24 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-[13px] text-slate-900 placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
            />

            {/* Optional: refresh recipient data from a re-uploaded sheet */}
            <details className="rounded-lg border border-slate-200 bg-white p-3">
              <summary className="cursor-pointer text-xs font-medium text-slate-700">
                Refresh contact data from a sheet (optional)
              </summary>
              <p className="mt-2 text-xs text-slate-500">
                Re-read a sheet to update the same recipients&apos; details
                (matched by email). It won&apos;t add new people.
              </p>
              <div className="mt-2 flex gap-2">
                <input
                  placeholder="Google Sheet URL"
                  value={stepSheetUrl}
                  onChange={(e) => {
                    setStepSheetUrl(e.target.value);
                    setStepSheetCols(null);
                  }}
                  className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
                />
                <button
                  onClick={loadStepSheet}
                  disabled={!stepSheetUrl.trim() || stepSheetLoading}
                  className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
                >
                  {stepSheetLoading ? "Loading..." : "Load columns"}
                </button>
              </div>
              {stepSheetMsg && (
                <p className="mt-1.5 text-xs text-slate-500">{stepSheetMsg}</p>
              )}
              {stepSheetCols && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {stepSheetCols.map((col) => {
                    const on = stepSelectedCols.includes(col);
                    return (
                      <button
                        key={col}
                        onClick={() =>
                          setStepSelectedCols((prev) =>
                            prev.includes(col)
                              ? prev.filter((c) => c !== col)
                              : [...prev, col]
                          )
                        }
                        className={`rounded-full px-2.5 py-0.5 text-xs ring-1 ring-inset transition ${
                          on
                            ? "bg-indigo-50 text-indigo-700 ring-indigo-200"
                            : "bg-white text-slate-500 ring-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        {col}
                      </button>
                    );
                  })}
                </div>
              )}
            </details>

            <div className="flex justify-end gap-2">
              <button
                onClick={resetStepForm}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={addStep}
                disabled={
                  !stepSubject.trim() ||
                  !stepBody.trim() ||
                  (stepMode === "date" && !stepScheduledAt)
                }
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
                ? "bg-slate-900 font-medium text-white"
                : "border border-slate-300 bg-white text-slate-500 hover:bg-slate-50"
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
                  ? "bg-slate-900 font-medium text-white"
                  : "border border-slate-300 bg-white text-slate-500 hover:bg-slate-50"
              }`}
            >
              {status} ({count})
            </button>
          ))}
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </span>
          Live, refreshes every 5s
        </span>
      </div>

      {(() => {
        const scheduledIds = visibleRecipients
          .filter((r) => r.status === "scheduled")
          .map((r) => r.id);
        if (scheduledIds.length < 2) return null;
        return (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
            <span>
              {scheduledIds.length} scheduled email
              {scheduledIds.length === 1 ? "" : "s"} shown
            </span>
            <span className="flex-1" />
            <button
              onClick={() => recipientAction(scheduledIds, "pending")}
              disabled={sending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-medium text-amber-800 transition hover:bg-amber-100 disabled:opacity-40"
            >
              <RotateCcw size={13} />
              All to pending
            </button>
            <button
              onClick={() => recipientAction(scheduledIds, "delete")}
              disabled={sending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-40"
            >
              <Trash2 size={13} />
              Delete all
            </button>
          </div>
        );
      })()}

      <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-200 shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
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
                Replied
              </th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleRecipients.map((r) => (
              <tr
                key={r.id}
                className="border-t border-slate-200 transition hover:bg-slate-50"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-medium text-slate-700">
                      {(r.name ?? r.email).charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-slate-900">{r.email}</p>
                      {r.name && (
                        <p className="truncate text-xs text-slate-500">
                          {r.name}
                        </p>
                      )}
                      {r.error && (
                        <p className="mt-0.5 text-xs text-red-600">{r.error}</p>
                      )}
                      {r.status === "replied" && r.replySnippet && (
                        <p className="mt-1 line-clamp-2 max-w-md text-xs text-teal-700">
                          <span className="font-medium">Reply: </span>
                          {r.replySnippet}
                        </p>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <StatusChip status={r.status} />
                </td>
                {campaign.hasVariantB && (
                  <td className="hidden px-4 py-3 text-xs text-slate-500 sm:table-cell">
                    {r.variant}
                  </td>
                )}
                <td className="hidden px-4 py-3 text-xs text-slate-500 sm:table-cell">
                  {r.sequenceStep > 0 ? `+${r.sequenceStep}` : "-"}
                </td>
                <td className="hidden px-4 py-3 text-xs text-slate-500 md:table-cell">
                  {r.repliedAt ? new Date(r.repliedAt).toLocaleString() : "-"}
                </td>
                <td className="px-4 py-3">
                  {r.status === "scheduled" ? (
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => recipientAction([r.id], "pending")}
                        disabled={sending}
                        title="Move back to pending (won't send until rescheduled)"
                        className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
                      >
                        <RotateCcw size={14} />
                      </button>
                      <button
                        onClick={() => recipientAction([r.id], "delete")}
                        disabled={sending}
                        title="Delete this scheduled email"
                        className="rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ) : r.status === "replied" ? (
                    <div className="flex justify-end">
                      <button
                        onClick={() => viewReply(r.id, r.email)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-700 transition hover:bg-teal-100"
                      >
                        <MessageSquareReply size={13} />
                        View reply
                      </button>
                    </div>
                  ) : (
                    <span className="block text-right text-slate-300">-</span>
                  )}
                </td>
              </tr>
            ))}
            {visibleRecipients.length === 0 && (
              <tr>
                <td
                  colSpan={campaign.hasVariantB ? 6 : 5}
                  className="px-4 py-10 text-center text-sm text-slate-500"
                >
                  No recipients match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {replyView && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/30 p-4"
          onClick={() => setReplyView(null)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                  <MessageSquareReply size={15} className="text-teal-600" />
                  Reply
                </p>
                <p className="truncate text-xs text-slate-500">
                  {replyView.email}
                </p>
              </div>
              <button
                onClick={() => setReplyView(null)}
                className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                title="Close"
              >
                <X size={14} />
              </button>
            </div>
            <div className="mt-4">
              {replyView.loading ? (
                <div className="flex items-center gap-2 py-10 text-sm text-slate-500">
                  <Loader2 size={15} className="animate-spin" />
                  Loading reply
                </div>
              ) : replyView.error ? (
                <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {replyView.error}
                </p>
              ) : replyView.data ? (
                <div>
                  <p className="text-sm font-medium text-slate-800">
                    {replyView.data.subject || "(no subject)"}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {replyView.data.from}
                    {replyView.data.date ? ` · ${replyView.data.date}` : ""}
                  </p>
                  <div className="mt-3 max-h-[55vh] overflow-auto whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
                    {replyView.data.body || "(empty message)"}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
