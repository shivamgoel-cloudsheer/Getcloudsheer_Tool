import { generateDrafts } from "@/lib/x/autopilot";
import { requireUser } from "@/lib/x/guard";

export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

// "Generate draft now": creates 1-5 draft posts from current trends to review.
export async function POST(request: Request, { params }: Ctx) {
  const u = await requireUser();
  if (u instanceof Response) return u;
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const count = Math.min(Math.max(Number(body.count) || 1, 1), 5);

  try {
    const created = await generateDrafts(id, count);
    return Response.json({ created });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
