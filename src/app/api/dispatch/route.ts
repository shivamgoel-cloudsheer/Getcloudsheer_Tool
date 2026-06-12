import { auth } from "@/auth";
import { dispatchDue } from "@/lib/dispatch";

export const maxDuration = 300;

// Cron trigger (cron-job.org / Vercel cron, every ~10 min): sends every
// scheduled recipient whose time has come, through the sender's own Gmail.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await dispatchDue();
  return Response.json(result);
}

// Manual trigger from the dashboard for debugging.
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  const result = await dispatchDue();
  return Response.json(result);
}
