import Link from "next/link";
import { isNull, count, gte, desc } from "drizzle-orm";
import { CheckCircle2, Plus, Bot, ArrowRight } from "lucide-react";
import { auth } from "@/auth";
import { isAdminEmail } from "@/lib/admin";
import { db } from "@/db";
import { xAccounts, xStyleProfiles, xPostLog } from "@/db/schema";
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
  const todayRows = accounts.length
    ? await db
        .select({ xAccountId: xPostLog.xAccountId, n: count() })
        .from(xPostLog)
        .where(gte(xPostLog.postedAt, dayStart))
        .groupBy(xPostLog.xAccountId)
    : [];
  const todayMap = new Map(todayRows.map((r) => [r.xAccountId, Number(r.n)]));

  const profiles = accounts.length
    ? await db
        .select()
        .from(xStyleProfiles)
        .orderBy(desc(xStyleProfiles.createdAt))
    : [];
  const voiceCount = new Map<string, number>();
  for (const p of profiles) {
    voiceCount.set(p.xAccountId, (voiceCount.get(p.xAccountId) ?? 0) + 1);
  }

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
          <RunNowButton />
          {admin && (
            <a
              href="/api/x/connect"
              className="inline-flex items-center gap-1.5 rounded-lg bg-linear-to-br from-sky-500 to-indigo-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-110"
            >
              <Plus size={15} /> Connect account
            </a>
          )}
        </div>
      </div>

      {x === "connected" && (
        <Banner ok>X account connected.</Banner>
      )}
      {x === "error" && <Banner>Could not connect the X account. Try again.</Banner>}
      {x === "forbidden" && (
        <Banner>Only an admin can connect or disconnect X accounts.</Banner>
      )}

      {/* Accounts */}
      {accounts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
          <p className="text-sm text-slate-600">
            {admin
              ? "No X account connected yet. Connect one to start posting."
              : "No X account connected yet. Ask an admin to connect one."}
          </p>
          {admin && (
            <a
              href="/api/x/connect"
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-linear-to-br from-sky-500 to-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-110"
            >
              <Plus size={15} /> Connect X account
            </a>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {accounts.map((a) => (
            <div
              key={a.id}
              className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4"
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="text-emerald-600" size={18} />
                <p className="font-medium text-slate-900">
                  {a.xUsername ? `@${a.xUsername}` : "X account"}
                </p>
              </div>
              <div className="mt-2 flex items-center gap-4 text-xs text-slate-500">
                <span>
                  <b className="text-slate-800">{todayMap.get(a.id) ?? 0}</b> / 17
                  today
                </span>
                <span>
                  <b className="text-slate-800">{voiceCount.get(a.id) ?? 0}</b>{" "}
                  voices
                </span>
              </div>
              <div className="mt-3 flex items-center gap-3 text-xs font-medium">
                <Link
                  href={`/dashboard/x/profiles/new?xAccountId=${a.id}`}
                  className="text-indigo-600 hover:underline"
                >
                  New voice
                </Link>
                <Link
                  href={`/dashboard/x/posts?xAccountId=${a.id}`}
                  className="text-slate-600 hover:underline"
                >
                  Queue
                </Link>
                <Link
                  href={`/dashboard/x/analytics?xAccountId=${a.id}`}
                  className="text-slate-600 hover:underline"
                >
                  Analytics
                </Link>
              </div>
            </div>
          ))}
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

      <p className="text-center text-xs text-slate-400">
        <Link href="/dashboard/x/posts" className="hover:underline">
          Post queue
        </Link>{" "}
        &middot;{" "}
        <Link href="/dashboard/x/analytics" className="hover:underline">
          Analytics
        </Link>
      </p>
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
