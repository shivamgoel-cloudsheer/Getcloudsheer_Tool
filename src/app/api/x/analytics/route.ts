import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { xPosts, xPostLog, xStyleProfiles, xImportedTweets } from "@/db/schema";
import { requireUser } from "@/lib/x/guard";

// Posting activity + free-tier usage, scoped to ?xAccountId (or aggregate).
// The X free tier is write-only, so engagement only comes from the archive.
export async function GET(request: Request) {
  const u = await requireUser();
  if (u instanceof Response) return u;

  const { searchParams } = new URL(request.url);
  const xAccountId = searchParams.get("xAccountId");

  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const now = new Date();
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  );
  const since = new Date(dayStart);
  since.setUTCDate(since.getUTCDate() - 13);

  const logAcctEq = xAccountId ? eq(xPostLog.xAccountId, xAccountId) : undefined;
  const postAcctEq = xAccountId ? eq(xPosts.xAccountId, xAccountId) : undefined;
  const profAcctEq = xAccountId
    ? eq(xStyleProfiles.xAccountId, xAccountId)
    : undefined;
  const impAcctEq = xAccountId
    ? eq(xImportedTweets.xAccountId, xAccountId)
    : undefined;
  // Raw-SQL account filter fragment (x_account_id column on log + imported).
  const acctSql = xAccountId ? sql`AND x_account_id = ${xAccountId}` : sql``;

  const [
    todayRow,
    monthRow,
    totalRow,
    statusRows,
    dailyRows,
    voiceRows,
    profs,
    histAggRows,
    topPosts,
    monthlyRows,
  ] = await Promise.all([
    db
      .select({ v: count() })
      .from(xPostLog)
      .where(and(logAcctEq, gte(xPostLog.postedAt, dayStart))),
    db
      .select({ v: count() })
      .from(xPostLog)
      .where(and(logAcctEq, gte(xPostLog.postedAt, monthStart))),
    db.select({ v: count() }).from(xPostLog).where(logAcctEq),
    db
      .select({ status: xPosts.status, n: count() })
      .from(xPosts)
      .where(postAcctEq)
      .groupBy(xPosts.status),
    db.execute<{ day: string; n: string }>(sql`
      SELECT to_char(posted_at, 'YYYY-MM-DD') AS day, count(*)::text AS n
      FROM x_post_log WHERE posted_at >= ${since} ${acctSql} GROUP BY 1
    `),
    db
      .select({ pid: xPosts.styleProfileId, status: xPosts.status, n: count() })
      .from(xPosts)
      .where(postAcctEq)
      .groupBy(xPosts.styleProfileId, xPosts.status),
    db
      .select({ id: xStyleProfiles.id, name: xStyleProfiles.name })
      .from(xStyleProfiles)
      .where(profAcctEq),
    db.execute<{ n: string; likes: string; retweets: string }>(sql`
      SELECT count(*)::text n, coalesce(sum(likes),0)::text likes, coalesce(sum(retweets),0)::text retweets
      FROM x_imported_tweet WHERE 1=1 ${acctSql}
    `),
    db
      .select({
        text: xImportedTweets.text,
        likes: xImportedTweets.likes,
        retweets: xImportedTweets.retweets,
        createdAt: xImportedTweets.createdAt,
      })
      .from(xImportedTweets)
      .where(impAcctEq)
      .orderBy(desc(xImportedTweets.likes))
      .limit(5),
    db.execute<{ m: string; n: string; likes: string }>(sql`
      SELECT to_char(created_at,'YYYY-MM') m, count(*)::text n, coalesce(sum(likes),0)::text likes
      FROM x_imported_tweet WHERE 1=1 ${acctSql} GROUP BY 1 ORDER BY 1
    `),
  ]);

  const byStatus: Record<string, number> = {};
  for (const r of statusRows) byStatus[r.status] = Number(r.n);

  const dailyMap = new Map(dailyRows.rows.map((r) => [r.day, Number(r.n)]));
  const daily: { day: string; count: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(dayStart);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    daily.push({ day: key, count: dailyMap.get(key) ?? 0 });
  }

  type Agg = { posted: number; scheduled: number; drafts: number; failed: number; total: number };
  const empty = (): Agg => ({ posted: 0, scheduled: 0, drafts: 0, failed: 0, total: 0 });
  const aggByPid = new Map<string, Agg>();
  for (const r of voiceRows) {
    if (!r.pid) continue;
    const a = aggByPid.get(r.pid) ?? empty();
    const n = Number(r.n);
    a.total += n;
    if (r.status === "posted") a.posted += n;
    else if (r.status === "scheduled") a.scheduled += n;
    else if (r.status === "draft" || r.status === "approved") a.drafts += n;
    else if (r.status === "failed") a.failed += n;
    aggByPid.set(r.pid, a);
  }
  const voices = profs.map((p) => ({ name: p.name, ...(aggByPid.get(p.id) ?? empty()) }));

  const h = histAggRows.rows[0] ?? { n: "0", likes: "0", retweets: "0" };
  const history = {
    count: Number(h.n),
    likes: Number(h.likes),
    retweets: Number(h.retweets),
    top: topPosts,
    monthly: monthlyRows.rows.map((r) => ({
      month: r.m,
      count: Number(r.n),
      likes: Number(r.likes),
    })),
  };

  return Response.json({
    usage: {
      today: Number(todayRow[0].v),
      dailyCap: 17,
      month: Number(monthRow[0].v),
      monthlyCap: 500,
      total: Number(totalRow[0].v),
    },
    byStatus,
    daily,
    voices,
    history,
  });
}
