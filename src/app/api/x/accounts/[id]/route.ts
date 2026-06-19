import { disconnectXAccount } from "@/lib/x/auth";
import { requireAdmin } from "@/lib/x/guard";

type Ctx = { params: Promise<{ id: string }> };

// Soft-disconnect an X account (the dispatcher then skips it). Admin-only.
export async function DELETE(_request: Request, { params }: Ctx) {
  const u = await requireAdmin();
  if (u instanceof Response) return u;
  const { id } = await params;
  await disconnectXAccount(id);
  return Response.json({ ok: true });
}
