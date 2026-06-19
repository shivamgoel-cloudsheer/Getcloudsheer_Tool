import { dispatchDue } from "@/lib/x/dispatch";
import { requireUser } from "@/lib/x/guard";

export const maxDuration = 300;

// Cron trigger (cron-job.org, every ~10 min): publishes every scheduled X post
// whose time has come, across all connected accounts, within each account's cap.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await dispatchDue();
  return Response.json(result);
}

// Manual trigger from the dashboard.
export async function POST() {
  const u = await requireUser();
  if (u instanceof Response) return u;
  const result = await dispatchDue();
  return Response.json(result);
}
