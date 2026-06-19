import { eq } from "drizzle-orm";
import { db } from "@/db";
import { xPosts } from "@/db/schema";
import { requireUser } from "@/lib/x/guard";

type Ctx = { params: Promise<{ id: string }> };

// Edit a post body and/or move it through the state machine via `action`:
//   approve -> approved, schedule -> scheduled (needs scheduledFor),
//   draft -> draft (unschedule), cancel -> cancelled.
export async function PATCH(request: Request, { params }: Ctx) {
  const u = await requireUser();
  if (u instanceof Response) return u;
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const set: Partial<typeof xPosts.$inferInsert> = {};
  if (typeof body.body === "string") set.body = body.body;

  switch (body.action) {
    case "approve":
      set.status = "approved";
      break;
    case "schedule":
      if (!body.scheduledFor) {
        return Response.json(
          { error: "scheduledFor is required to schedule" },
          { status: 400 }
        );
      }
      set.status = "scheduled";
      set.scheduledFor = new Date(body.scheduledFor);
      set.dispatchClaimedAt = null;
      break;
    case "draft":
      set.status = "draft";
      set.scheduledFor = null;
      break;
    case "cancel":
      set.status = "cancelled";
      set.scheduledFor = null;
      set.dispatchClaimedAt = null;
      break;
    case undefined:
      break;
    default:
      return Response.json({ error: "Unknown action" }, { status: 400 });
  }

  if (Object.keys(set).length === 0) {
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }

  const [row] = await db
    .update(xPosts)
    .set(set)
    .where(eq(xPosts.id, id))
    .returning();
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ post: row });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const u = await requireUser();
  if (u instanceof Response) return u;
  const { id } = await params;
  await db.delete(xPosts).where(eq(xPosts.id, id));
  return Response.json({ ok: true });
}
