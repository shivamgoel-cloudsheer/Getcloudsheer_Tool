import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { xPosts, type XPostStatus } from "@/db/schema";
import { requireUser } from "@/lib/x/guard";

export async function GET(request: Request) {
  const u = await requireUser();
  if (u instanceof Response) return u;

  const { searchParams } = new URL(request.url);
  const xAccountId = searchParams.get("xAccountId");
  const status = searchParams.get("status") as XPostStatus | null;

  const conds = [];
  if (xAccountId) conds.push(eq(xPosts.xAccountId, xAccountId));
  if (status) conds.push(eq(xPosts.status, status));

  const rows = await db
    .select()
    .from(xPosts)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(xPosts.createdAt))
    .limit(200);

  return Response.json({ posts: rows });
}

// Create a manual post: a draft, or scheduled when scheduledFor is given.
export async function POST(request: Request) {
  const u = await requireUser();
  if (u instanceof Response) return u;

  const body = await request.json().catch(() => null);
  if (!body?.xAccountId || !body?.body || typeof body.body !== "string") {
    return Response.json(
      { error: "xAccountId and body are required" },
      { status: 400 }
    );
  }

  const scheduledFor = body.scheduledFor ? new Date(body.scheduledFor) : null;
  const [row] = await db
    .insert(xPosts)
    .values({
      xAccountId: body.xAccountId,
      body: body.body,
      styleProfileId: body.styleProfileId ?? null,
      scheduledFor,
      status: scheduledFor ? "scheduled" : "draft",
    })
    .returning();

  return Response.json({ post: row });
}
