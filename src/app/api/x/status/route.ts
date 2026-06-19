import { count, gte } from "drizzle-orm";
import { db } from "@/db";
import { xPostLog } from "@/db/schema";
import { listXAccounts } from "@/lib/x/auth";
import { requireUser } from "@/lib/x/guard";

// Per-account connection summary for the dashboard (username + today's usage).
export async function GET() {
  const u = await requireUser();
  if (u instanceof Response) return u;

  const accounts = await listXAccounts();

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

  return Response.json({
    accounts: accounts.map((a) => ({
      id: a.id,
      username: a.xUsername,
      postedToday: todayMap.get(a.id) ?? 0,
      dailyCap: 17,
      expiresAt: a.expiresAt,
    })),
  });
}
