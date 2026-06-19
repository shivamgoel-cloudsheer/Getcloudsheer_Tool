import { runDailyProcess } from "@/lib/x/autopilot";
import { dispatchDue } from "@/lib/x/dispatch";
import { requireUser } from "@/lib/x/guard";

export const maxDuration = 300;

// Manual trigger from the dashboard (behind the Google login). Used to test the
// loop without waiting for cron.
//   action "dispatch" (default): publish anything already due.
//   action "process": generate + schedule from trends, then dispatch.
export async function POST(request: Request) {
  const u = await requireUser();
  if (u instanceof Response) return u;

  const body = await request.json().catch(() => ({} as { action?: string }));
  const action = body.action ?? "dispatch";

  if (action === "process") {
    const processed = await runDailyProcess();
    const dispatched = await dispatchDue();
    return Response.json({ processed, dispatched });
  }

  const dispatched = await dispatchDue();
  return Response.json({ dispatched });
}
