import { and, count, desc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { xPosts, xPostLog } from "@/db/schema";
import { requireUser } from "@/lib/x/guard";

// Polled by the queue UI. Scoped to ?xAccountId when present, else aggregate.
export async function GET(request: Request) {
  const u = await requireUser();
  if (u instanceof Response) return u;

  const { searchParams } = new URL(request.url);
  const xAccountId = searchParams.get("xAccountId");

  const grouped = await db
    .select({ status: xPosts.status, n: count() })
    .from(xPosts)
    .where(xAccountId ? eq(xPosts.xAccountId, xAccountId) : undefined)
    .groupBy(xPosts.status);
  const counts: Record<string, number> = {};
  for (const g of grouped) counts[g.status] = Number(g.n);

  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const todayWhere = xAccountId
    ? and(eq(xPostLog.xAccountId, xAccountId), gte(xPostLog.postedAt, dayStart))
    : gte(xPostLog.postedAt, dayStart);
  const [{ value: postedToday }] = await db
    .select({ value: count() })
    .from(xPostLog)
    .where(todayWhere);

  const recent = await db
    .select()
    .from(xPosts)
    .where(xAccountId ? eq(xPosts.xAccountId, xAccountId) : undefined)
    .orderBy(desc(xPosts.createdAt))
    .limit(50);

  return Response.json({
    counts,
    postedToday: Number(postedToday),
    dailyCap: 17,
    posts: recent,
  });
}
