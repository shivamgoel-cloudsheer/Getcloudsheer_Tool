import { runDailyProcess } from "@/lib/x/autopilot";
import { dispatchDue } from "@/lib/x/dispatch";

export const maxDuration = 300;

// Daily cron (cron-job.org): per account, pull trends, generate + schedule
// posts, then dispatch as a backstop.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const processed = await runDailyProcess();
  const dispatched = await dispatchDue();
  return Response.json({ processed, dispatched });
}
