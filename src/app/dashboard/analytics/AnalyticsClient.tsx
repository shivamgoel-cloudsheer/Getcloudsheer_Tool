"use client";

import { useEffect, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  CalendarClock,
  CheckCheck,
  Clock,
  FlaskConical,
  Inbox,
  Loader2,
  Mail,
  MailX,
  MessageSquareReply,
  Repeat,
  Send,
  Settings2,
  TriangleAlert,
} from "lucide-react";
import { StatusChip } from "@/components/ui";

export type CampaignListItem = {
  id: string;
  name: string;
  status: string;
  total: number;
  sentCount: number;
  createdAt: string;
  owner: string | null;
};

type Recipient = {
  id: string;
  email: string;
  name: string | null;
  status: string;
  variant: "A" | "B";
  sequenceStep: number;
  repliedAt: string | null;
  replyCategory: string | null;
  replySubject: string | null;
  replySnippet: string | null;
};

type Stagger = {
  gapMinutes: number;
  dailyCap: number;
  windowStart: string;
  windowEnd: string;
  skipWeekends: boolean;
  timeZone: string;
  warmup: boolean;
  perRecipientTimeZone?: boolean;
};

type StatusData = {
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
    fromAddress: string | null;
    staggerConfig: Stagger | null;
  };
  steps: {
    id: string;
    stepNumber: number;
    delayDays: number;
    subjectTemplate: string;
  }[];
  counts: Record<string, number>;
  recipients: Recipient[];
};

const STATUS_BAR: Record<string, string> = {
  sent: "bg-emerald-500",
  delivered: "bg-emerald-400",
  opened: "bg-violet-500",
  clicked: "bg-fuchsia-500",
  replied: "bg-teal-500",
  scheduled: "bg-amber-500",
  pending: "bg-slate-400",
  suppressed: "bg-slate-300",
  bounced: "bg-red-500",
  complained: "bg-red-500",
  failed: "bg-red-400",
};

const STATUS_ORDER = [
  "sent",
  "delivered",
  "opened",
  "clicked",
  "replied",
  "scheduled",
  "pending",
  "suppressed",
  "bounced",
  "complained",
  "failed",
];

// Reply segmentation (intent of each reply). Mirrors the campaign page taxonomy.
const REPLY_CATEGORY_ORDER = [
  "interested",
  "meeting",
  "later",
  "not_interested",
  "unsubscribe",
  "wrong_person",
  "out_of_office",
  "neutral",
];

const REPLY_CATEGORY_META: Record<
  string,
  { label: string; bar: string; chip: string; next: string }
> = {
  interested: {
    label: "Interested",
    bar: "bg-emerald-500",
    chip: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    next: "Reply fast with a booking link or two time slots to lock in a call.",
  },
  meeting: {
    label: "Meeting request",
    bar: "bg-teal-500",
    chip: "bg-teal-50 text-teal-700 ring-teal-200",
    next: "Confirm a time and send the calendar invite.",
  },
  later: {
    label: "Not now / Later",
    bar: "bg-amber-500",
    chip: "bg-amber-50 text-amber-700 ring-amber-200",
    next: "Snooze and follow up when they asked you to.",
  },
  not_interested: {
    label: "Not interested",
    bar: "bg-orange-500",
    chip: "bg-orange-50 text-orange-700 ring-orange-200",
    next: "Close the thread - no further outreach for now.",
  },
  unsubscribe: {
    label: "Unsubscribe",
    bar: "bg-red-500",
    chip: "bg-red-50 text-red-700 ring-red-200",
    next: "Suppressed automatically - do not contact again.",
  },
  wrong_person: {
    label: "Wrong person",
    bar: "bg-violet-500",
    chip: "bg-violet-50 text-violet-700 ring-violet-200",
    next: "Ask for the right contact and re-route the outreach.",
  },
  out_of_office: {
    label: "Out of office",
    bar: "bg-slate-400",
    chip: "bg-slate-100 text-slate-600 ring-slate-200",
    next: "Wait for their return date, then resend.",
  },
  neutral: {
    label: "Neutral",
    bar: "bg-slate-300",
    chip: "bg-slate-100 text-slate-500 ring-slate-200",
    next: "Read the reply and decide the next move.",
  },
  // Legacy values from before the taxonomy change.
  positive: {
    label: "Interested",
    bar: "bg-emerald-500",
    chip: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    next: "Reply fast with a booking link or two time slots to lock in a call.",
  },
  negative: {
    label: "Not interested",
    bar: "bg-orange-500",
    chip: "bg-orange-50 text-orange-700 ring-orange-200",
    next: "Close the thread - no further outreach for now.",
  },
};

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

function fmt(iso: string | null | undefined, tz?: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz || undefined,
    timeZoneName: "short",
  });
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Mail;
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-slate-500">
        <Icon size={14} />
        <p className="text-xs">{label}</p>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Mail;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <Icon size={15} className="text-indigo-600" />
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      </div>
      {children}
    </div>
  );
}

export default function AnalyticsClient({
  campaigns,
}: {
  campaigns: CampaignListItem[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(
    campaigns[0]?.id ?? null
  );
  const [result, setResult] = useState<{
    id: string;
    data?: StatusData;
    error?: string;
  } | null>(null);

  useEffect(() => {
    if (!selectedId) return;
    const id = selectedId;
    let cancelled = false;
    fetch(`/api/campaigns/${id}/status`, { cache: "no-store" })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (cancelled) return;
        setResult(
          ok
            ? { id, data: j }
            : { id, error: j.error ?? "Failed to load analytics" }
        );
      })
      .catch((e) => {
        if (!cancelled)
          setResult({
            id,
            error: e instanceof Error ? e.message : "Failed to load analytics",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // Only show a result that matches the current selection (avoids stale flashes).
  const matched = result && result.id === selectedId ? result : null;
  const data = matched?.data ?? null;
  const error = matched?.error ?? null;
  const loading = !!selectedId && !matched;

  return (
    <div>
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
          <BarChart3 size={20} className="text-indigo-600" />
          Analytics
        </h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Pick a campaign to see everything we can measure about it.
        </p>
      </div>

      {campaigns.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-14 text-center text-sm text-slate-500">
          No campaigns yet.
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[19rem_1fr]">
          {/* Left rail: campaign list */}
          <aside className="lg:sticky lg:top-20 lg:self-start">
            <ul className="max-h-[75vh] space-y-1.5 overflow-auto pr-1">
              {campaigns.map((c) => {
                const active = c.id === selectedId;
                return (
                  <li key={c.id}>
                    <button
                      onClick={() => setSelectedId(c.id)}
                      className={`w-full rounded-xl border px-3.5 py-3 text-left transition ${
                        active
                          ? "border-indigo-300 bg-indigo-50/60 ring-1 ring-indigo-200"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-slate-900">
                          {c.name}
                        </span>
                        <StatusChip status={c.status} />
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                        <span>{c.total} recipients</span>
                        {c.owner && (
                          <span className="text-indigo-600">· {c.owner}</span>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>

          {/* Right panel: analytics */}
          <div className="min-w-0">
            {loading && (
              <div className="flex items-center justify-center gap-2 py-32 text-sm text-slate-500">
                <Loader2 size={16} className="animate-spin" />
                Loading analytics
              </div>
            )}
            {error && !loading && (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
                {error}
              </div>
            )}
            {data && !loading && <CampaignAnalytics data={data} />}
          </div>
        </div>
      )}
    </div>
  );
}

function CampaignAnalytics({ data }: { data: StatusData }) {
  const { campaign, counts, recipients, steps } = data;
  const tz = campaign.staggerConfig?.timeZone;

  const total = campaign.total;
  const sent = campaign.sentCount;
  const replied = counts.replied ?? 0;
  const bounced = (counts.bounced ?? 0) + (counts.complained ?? 0);
  const legacyEngaged =
    (counts.delivered ?? 0) + (counts.opened ?? 0) + (counts.clicked ?? 0);
  const reached = (counts.sent ?? 0) + legacyEngaged + replied + bounced;
  const queued = (counts.scheduled ?? 0) + (counts.pending ?? 0);
  const suppressed = counts.suppressed ?? 0;
  const failed = counts.failed ?? 0;

  // Reply segmentation breakdown: how each reply was classified by intent.
  const repliesTotal = recipients.filter((r) => r.repliedAt).length;
  const catCounts: Record<string, number> = {};
  for (const r of recipients) {
    if (r.replyCategory)
      catCounts[r.replyCategory] = (catCounts[r.replyCategory] ?? 0) + 1;
  }
  const taggedTotal = Object.values(catCounts).reduce((s, n) => s + n, 0);
  const untaggedReplies = Math.max(repliesTotal - taggedTotal, 0);
  const presentCats = [
    ...REPLY_CATEGORY_ORDER.filter((c) => catCounts[c]),
    ...Object.keys(catCounts).filter((c) => !REPLY_CATEGORY_ORDER.includes(c)),
  ];

  // Detailed reply log: every reply, hottest intent first, with its text.
  const catRank = (c: string | null) => {
    if (!c) return 99;
    const i = REPLY_CATEGORY_ORDER.indexOf(c);
    return i === -1 ? 50 : i;
  };
  const replyRows = recipients
    .filter((r) => r.repliedAt || r.replyCategory)
    .sort((x, y) => {
      const d = catRank(x.replyCategory) - catRank(y.replyCategory);
      if (d !== 0) return d;
      return (y.repliedAt ?? "").localeCompare(x.repliedAt ?? "");
    });

  // A/B split, computed from the returned recipients
  const REACHED = ["sent", "delivered", "opened", "clicked", "replied", "bounced"];
  const variantStats = (v: "A" | "B") => {
    const rs = recipients.filter((r) => r.variant === v);
    const r = rs.filter((x) => REACHED.includes(x.status)).length;
    const rep = rs.filter((x) => x.status === "replied").length;
    return { count: rs.length, reached: r, replied: rep };
  };
  const a = variantStats("A");
  const b = variantStats("B");

  // Follow-up step distribution (0 = initial email, 1..n = follow-ups)
  const byStep = new Map<number, number>();
  for (const r of recipients) {
    byStep.set(r.sequenceStep, (byStep.get(r.sequenceStep) ?? 0) + 1);
  }
  const maxStep = Math.max(0, ...steps.map((s) => s.stepNumber));

  const sampled = total > recipients.length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-lg font-semibold text-slate-900">
            {campaign.name}
          </h2>
          <StatusChip status={campaign.status} />
        </div>
        <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-1.5 text-xs sm:grid-cols-2">
          <div className="flex items-center gap-1.5 text-slate-500">
            <Send size={12} /> Sends from
            <span className="font-medium text-slate-700">
              {campaign.fromAddress ?? "default sender"}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-slate-500">
            <Clock size={12} /> Created
            <span className="font-medium text-slate-700">
              {fmt(campaign.createdAt, tz)}
            </span>
          </div>
          {campaign.scheduledAt && (
            <div className="flex items-center gap-1.5 text-slate-500">
              <CalendarClock size={12} /> Scheduled
              <span className="font-medium text-slate-700">
                {fmt(campaign.scheduledAt, tz)}
              </span>
            </div>
          )}
          {campaign.sentAt && (
            <div className="flex items-center gap-1.5 text-slate-500">
              <CheckCheck size={12} /> Completed
              <span className="font-medium text-slate-700">
                {fmt(campaign.sentAt, tz)}
              </span>
            </div>
          )}
        </dl>
      </div>

      {/* Headline stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={Inbox} label="Recipients" value={total} />
        <StatCard
          icon={Mail}
          label="Sent"
          value={sent}
          sub={`${pct(sent, total)}% of list`}
        />
        <StatCard
          icon={MessageSquareReply}
          label="Reply rate"
          value={reached > 0 ? `${pct(replied, reached)}%` : "-"}
          sub={`${replied} repl${replied === 1 ? "y" : "ies"}`}
        />
        <StatCard
          icon={MailX}
          label="Bounce rate"
          value={reached > 0 ? `${pct(bounced, reached)}%` : "-"}
          sub={`${bounced} bounced`}
        />
      </div>

      {/* Delivery breakdown */}
      <Section icon={BarChart3} title="Delivery breakdown">
        <div className="space-y-2.5">
          {STATUS_ORDER.filter((s) => (counts[s] ?? 0) > 0).map((s) => {
            const n = counts[s];
            return (
              <div key={s} className="flex items-center gap-3">
                <span className="w-24 shrink-0 text-xs capitalize text-slate-600">
                  {s}
                </span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full ${STATUS_BAR[s] ?? "bg-slate-400"}`}
                    style={{ width: `${Math.max(pct(n, total), 2)}%` }}
                  />
                </div>
                <span className="w-16 shrink-0 text-right text-xs text-slate-500">
                  {n} · {pct(n, total)}%
                </span>
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-400">
          <span>Reached: {reached}</span>
          <span>Queued: {queued}</span>
          <span>Suppressed: {suppressed}</span>
          <span>Failed: {failed}</span>
        </div>
      </Section>

      {/* Reply breakdown */}
      {repliesTotal > 0 && (
        <Section icon={MessageSquareReply} title="Reply breakdown">
          <div className="space-y-2.5">
            {presentCats.map((c) => {
              const n = catCounts[c];
              const meta = REPLY_CATEGORY_META[c];
              return (
                <div key={c} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 text-xs text-slate-600">
                    {meta?.label ?? c}
                  </span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full ${meta?.bar ?? "bg-slate-400"}`}
                      style={{ width: `${Math.max(pct(n, repliesTotal), 2)}%` }}
                    />
                  </div>
                  <span className="w-16 shrink-0 text-right text-xs text-slate-500">
                    {n} · {pct(n, repliesTotal)}%
                  </span>
                </div>
              );
            })}
            {untaggedReplies > 0 && (
              <div className="flex items-center gap-3">
                <span className="w-28 shrink-0 text-xs text-slate-400">
                  Untagged
                </span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-slate-200"
                    style={{
                      width: `${Math.max(pct(untaggedReplies, repliesTotal), 2)}%`,
                    }}
                  />
                </div>
                <span className="w-16 shrink-0 text-right text-xs text-slate-500">
                  {untaggedReplies} · {pct(untaggedReplies, repliesTotal)}%
                </span>
              </div>
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-400">
            <span>Total replies: {repliesTotal}</span>
            <span>Tagged: {taggedTotal}</span>
            {untaggedReplies > 0 && (
              <span>Untagged replies are classified automatically in the background.</span>
            )}
          </div>
        </Section>
      )}

      {/* Detailed reply log with the suggested next step per reply */}
      {replyRows.length > 0 && (
        <Section icon={Inbox} title={`All replies (${replyRows.length})`}>
          <ul className="space-y-2.5">
            {replyRows.map((r) => {
              const meta = r.replyCategory
                ? REPLY_CATEGORY_META[r.replyCategory]
                : null;
              return (
                <li
                  key={r.id}
                  className="rounded-xl border border-slate-200 p-3.5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">
                        {r.name || r.email}
                      </p>
                      {r.name && (
                        <p className="truncate text-xs text-slate-400">
                          {r.email}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {r.sequenceStep > 0 && (
                        <span className="text-xs text-slate-400">
                          Follow-up {r.sequenceStep}
                        </span>
                      )}
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                          meta?.chip ?? "bg-slate-100 text-slate-500 ring-slate-200"
                        }`}
                      >
                        {meta?.label ?? r.replyCategory ?? "Untagged"}
                      </span>
                    </div>
                  </div>
                  {r.replySubject && (
                    <p className="mt-2 truncate text-xs font-medium text-slate-600">
                      {r.replySubject}
                    </p>
                  )}
                  {r.replySnippet && (
                    <p className="mt-1 line-clamp-2 text-xs text-slate-500">
                      {r.replySnippet}
                    </p>
                  )}
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-indigo-700">
                    <ArrowRight size={13} className="mt-0.5 shrink-0" />
                    <span>
                      {meta?.next ??
                        "Being classified - open View reply on the campaign page to read the full message."}
                    </span>
                  </p>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {/* A/B test */}
      {campaign.hasVariantB && (
        <Section icon={FlaskConical} title="A/B test">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[
              { label: "Variant A", s: a },
              { label: "Variant B", s: b },
            ].map(({ label, s }) => (
              <div
                key={label}
                className="rounded-xl border border-slate-200 bg-slate-50 p-4"
              >
                <p className="text-sm font-semibold text-slate-800">{label}</p>
                <p className="mt-1 text-2xl font-semibold text-slate-900">
                  {s.reached > 0 ? `${pct(s.replied, s.reached)}%` : "-"}
                  <span className="ml-1 text-xs font-normal text-slate-500">
                    reply rate
                  </span>
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {s.count} assigned · {s.reached} sent · {s.replied} replied
                </p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Follow-up sequence */}
      <Section icon={Repeat} title="Follow-up sequence">
        {steps.length === 0 ? (
          <p className="text-sm text-slate-500">
            No follow-up steps. This campaign sends a single email.
          </p>
        ) : (
          <div className="space-y-2.5">
            {Array.from({ length: maxStep + 1 }, (_, step) => {
              const cfg = steps.find((s) => s.stepNumber === step);
              const n = byStep.get(step) ?? 0;
              return (
                <div
                  key={step}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3.5 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800">
                      {step === 0
                        ? "Initial email"
                        : `Follow-up ${step}${
                            cfg ? ` · +${cfg.delayDays}d` : ""
                          }`}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {step === 0 ? campaign.subjectTemplate : cfg?.subjectTemplate}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-slate-700">
                    {n}
                    <span className="ml-1 text-xs font-normal text-slate-500">
                      reached this step
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* Sending configuration */}
      {campaign.staggerConfig && (
        <Section icon={Settings2} title="Sending configuration">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-sm sm:grid-cols-3">
            <Detail label="Gap between emails" value={`${campaign.staggerConfig.gapMinutes} min`} />
            <Detail label="Daily cap / sender" value={`${campaign.staggerConfig.dailyCap}`} />
            <Detail
              label="Send window"
              value={`${campaign.staggerConfig.windowStart}-${campaign.staggerConfig.windowEnd}`}
            />
            <Detail label="Window timezone" value={campaign.staggerConfig.timeZone} />
            <Detail
              label="Skip weekends"
              value={campaign.staggerConfig.skipWeekends ? "Yes" : "No"}
            />
            <Detail
              label="Warm-up"
              value={campaign.staggerConfig.warmup ? "On" : "Off"}
            />
            <Detail
              label="Recipient local time"
              value={campaign.staggerConfig.perRecipientTimeZone ? "On" : "Off"}
            />
          </dl>
        </Section>
      )}

      <p className="flex items-center gap-1.5 text-xs text-slate-400">
        <TriangleAlert size={12} />
        Opens and clicks aren&apos;t tracked - emails send as plain personal mail
        for deliverability, so engagement is measured by replies and bounces.
        {sampled && " A/B and step figures are based on a sample of recipients."}
      </p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="font-medium text-slate-800">{value}</dd>
    </div>
  );
}
