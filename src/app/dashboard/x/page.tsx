import Link from "next/link";
import { isNull, count, gte, desc } from "drizzle-orm";
import {
  CheckCircle2,
  Plus,
  Bot,
  ArrowRight,
  Rocket,
  Check,
  Sparkles,
} from "lucide-react";
import { auth } from "@/auth";
import { isAdminEmail } from "@/lib/admin";
import { db } from "@/db";
import { xAccounts, xStyleProfiles, xPostLog, xPosts } from "@/db/schema";
import { RunNowButton } from "@/components/x/RunNowButton";

export const dynamic = "force-dynamic";

export default async function XOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ x?: string }>;
}) {
  const { x } = await searchParams;
  const session = await auth();
  const admin = isAdminEmail(session?.user?.email);

  const accounts = await db
    .select()
    .from(xAccounts)
    .where(isNull(xAccounts.disconnectedAt))
    .orderBy(xAccounts.createdAt);

  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);

  const [todayRows, profiles, postStatusRows] = accounts.length
    ? await Promise.all([
        db
          .select({ xAccountId: xPostLog.xAccountId, n: count() })
          .from(xPostLog)
          .where(gte(xPostLog.postedAt, dayStart))
          .groupBy(xPostLog.xAccountId),
        db.select().from(xStyleProfiles).orderBy(desc(xStyleProfiles.createdAt)),
        db
          .select({ xAccountId: xPosts.xAccountId, status: xPosts.status, n: count() })
          .from(xPosts)
          .groupBy(xPosts.xAccountId, xPosts.status),
      ])
    : [[], [], []];

  const todayMap = new Map(todayRows.map((r) => [r.xAccountId, Number(r.n)]));
  const voiceCount = new Map<string, number>();
  for (const p of profiles) {
    voiceCount.set(p.xAccountId, (voiceCount.get(p.xAccountId) ?? 0) + 1);
  }
  const scheduledMap = new Map<string, number>();
  const draftMap = new Map<string, number>();
  for (const r of postStatusRows) {
    const n = Number(r.n);
    if (r.status === "scheduled")
      scheduledMap.set(r.xAccountId, (scheduledMap.get(r.xAccountId) ?? 0) + n);
    else if (r.status === "draft" || r.status === "approved")
      draftMap.set(r.xAccountId, (draftMap.get(r.xAccountId) ?? 0) + n);
  }

  const firstAccountId = accounts[0]?.id;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">X automation</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            On-voice posting on trending topics, on a schedule.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          {accounts.length > 0 && <RunNowButton />}
          {admin && (
            <a
              href="/api/x/connect"
              className="inline-flex items-center gap-1.5 rounded-lg bg-linear-to-br from-sky-500 to-indigo-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-110"
            >
              <Plus size={15} />
              {accounts.length > 0 ? "Connect another" : "Connect account"}
            </a>
          )}
        </div>
      </div>

      {x === "connected" && <Banner ok>X account connected.</Banner>}
      {x === "error" && <Banner>Could not connect the X account. Try again.</Banner>}
      {x === "forbidden" && (
        <Banner>Only an admin can connect or disconnect X accounts.</Banner>
      )}

      {/* Accounts */}
      {accounts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-lg font-bold text-white">
            X
          </div>
          <p className="mt-4 text-sm font-medium text-slate-900">
            No X account connected yet
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {admin
              ? "Connect one to start writing and scheduling posts."
              : "Ask an admin to connect one."}
          </p>
          {admin && (
            <a
              href="/api/x/connect"
              className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-linear-to-br from-sky-500 to-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-110"
            >
              <Plus size={15} /> Connect X account
            </a>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {accounts.map((a) => {
            const today = todayMap.get(a.id) ?? 0;
            return (
              <div
                key={a.id}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-sm font-bold text-white">
                      X
                    </div>
                    <div>
                      <p className="font-semibold text-slate-900">
                        @{a.xUsername ?? a.id.slice(0, 8)}
                      </p>
                      <p className="flex items-center gap-1 text-xs font-medium text-emerald-600">
                        <CheckCircle2 size={12} /> Connected
                      </p>
                    </div>
                  </div>
                  <Link
                    href={`/dashboard/x/posts?xAccountId=${a.id}`}
                    className="text-xs font-medium text-slate-400 transition hover:text-slate-700"
                  >
                    Open
                  </Link>
                </div>

                {/* Daily usage meter */}
                <div className="mt-4">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">Posts today</span>
                    <span className="tabular-nums text-slate-500">
                      <b className="text-slate-900">{today}</b> / 17
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-linear-to-r from-sky-400 to-indigo-500"
                      style={{ width: `${Math.min(100, (today / 17) * 100)}%` }}
                    />
                  </div>
                </div>

                {/* Stat chips */}
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <Chip label="Voices" value={voiceCount.get(a.id) ?? 0} />
                  <Chip label="Scheduled" value={scheduledMap.get(a.id) ?? 0} />
                  <Chip label="Drafts" value={draftMap.get(a.id) ?? 0} />
                </div>

                {/* Actions */}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Link
                    href={`/dashboard/x/profiles/new?xAccountId=${a.id}`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100"
                  >
                    <Plus size={13} /> New voice
                  </Link>
                  <Link
                    href={`/dashboard/x/posts?xAccountId=${a.id}`}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                  >
                    Queue
                  </Link>
                  <Link
                    href={`/dashboard/x/analytics?xAccountId=${a.id}`}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                  >
                    Analytics
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Getting started (connected, but no voices yet) */}
      {accounts.length > 0 && profiles.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="flex items-center gap-2">
            <Rocket className="text-indigo-500" size={18} />
            <h2 className="font-semibold text-slate-900">
              Get your first posts going
            </h2>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            You&apos;re connected - two steps left.
          </p>
          <ol className="mt-4 space-y-3.5">
            <Step
              done
              n="1"
              title="Connect an X account"
              desc={`@${accounts[0].xUsername ?? "your account"} is connected.`}
            />
            <Step
              n="2"
              title="Create a voice"
              desc="Paste 50-100 posts you want to sound like; Claude learns the style once."
            />
            <Step
              n="3"
              title="It writes and posts"
              desc="Pulls trending topics for your niche and posts on a schedule, within the 17/day cap."
            />
          </ol>
          <Link
            href={
              firstAccountId
                ? `/dashboard/x/profiles/new?xAccountId=${firstAccountId}`
                : "/dashboard/x/profiles/new"
            }
            className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-linear-to-br from-sky-500 to-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-110"
          >
            <Sparkles size={15} /> Create your first voice
          </Link>
        </div>
      )}

      {/* Voices */}
      {profiles.length > 0 && (
        <section className="space-y-2.5">
          <h2 className="text-sm font-semibold text-slate-900">Voices</h2>
          <ul className="space-y-2">
            {profiles.map((p) => {
              const acct = accounts.find((a) => a.id === p.xAccountId);
              return (
                <li key={p.id}>
                  <Link
                    href={`/dashboard/x/profiles/${p.id}`}
                    className="group flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2.5">
                        <Bot size={15} className="shrink-0 text-slate-400" />
                        <p className="truncate font-medium text-slate-900">
                          {p.name}
                        </p>
                        <span className="text-xs text-slate-400">
                          {acct?.xUsername ? `@${acct.xUsername}` : ""}
                        </span>
                      </div>
                      <p className="mt-1 truncate pl-[26px] text-xs text-slate-500">
                        {p.niche} &middot; {p.postsPerDay}/day &middot;{" "}
                        {p.autonomous ? "autonomous" : "review first"} &middot;{" "}
                        {p.profile ? "analyzed" : "not analyzed"}
                      </p>
                    </div>
                    <ArrowRight
                      size={15}
                      className="shrink-0 text-slate-300 group-hover:text-slate-500"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function Banner({
  children,
  ok = false,
}: {
  children: React.ReactNode;
  ok?: boolean;
}) {
  return (
    <div
      className={`rounded-xl px-4 py-2.5 text-sm ${
        ok
          ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
          : "bg-amber-50 text-amber-800 ring-1 ring-amber-200"
      }`}
    >
      {children}
    </div>
  );
}

function Chip({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-slate-50 py-2.5 text-center">
      <p className="text-lg font-semibold text-slate-900">{value}</p>
      <p className="text-[11px] text-slate-500">{label}</p>
    </div>
  );
}

function Step({
  n,
  title,
  desc,
  done = false,
}: {
  n: string;
  title: string;
  desc: string;
  done?: boolean;
}) {
  return (
    <li className="flex gap-3">
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
          done ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
        }`}
      >
        {done ? <Check size={13} /> : n}
      </span>
      <div>
        <p className="text-sm font-medium text-slate-900">{title}</p>
        <p className="text-xs text-slate-500">{desc}</p>
      </div>
    </li>
  );
}
