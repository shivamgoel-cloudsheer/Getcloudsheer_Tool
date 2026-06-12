import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { campaigns } from "@/db/schema";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await params;

  // Scheduling is DB-backed, so deleting the campaign cascades away any
  // still-queued rows and nothing remote needs cancelling first.
  const deleted = await db
    .delete(campaigns)
    .where(and(eq(campaigns.id, id), eq(campaigns.userId, session.user.id)))
    .returning({ id: campaigns.id });

  if (deleted.length === 0) {
    return Response.json({ error: "Campaign not found" }, { status: 404 });
  }

  return Response.json({ deleted: true });
}
