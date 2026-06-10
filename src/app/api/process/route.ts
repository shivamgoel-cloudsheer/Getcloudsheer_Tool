import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { processUser } from "@/lib/processor";

export const maxDuration = 300;

// Manual trigger from the dashboard: processes the signed-in user.
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  const result = await processUser(session.user.id);
  return Response.json(result);
}

// Vercel Cron trigger: processes every connected user once a day as a
// backstop, so follow-ups go out even if nobody opens the dashboard.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const googleUsers = await db
    .select({ userId: accounts.userId })
    .from(accounts)
    .where(eq(accounts.provider, "google"));

  const results = [];
  for (const { userId } of googleUsers) {
    results.push({ userId, ...(await processUser(userId)) });
  }

  return Response.json({ processed: results.length, results });
}
