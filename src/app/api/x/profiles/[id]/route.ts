import { eq } from "drizzle-orm";
import { db } from "@/db";
import { xStyleProfiles } from "@/db/schema";
import { buildStyleProfile } from "@/lib/x/generate";
import { requireUser } from "@/lib/x/guard";

export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const u = await requireUser();
  if (u instanceof Response) return u;
  const { id } = await params;
  const [row] = await db
    .select()
    .from(xStyleProfiles)
    .where(eq(xStyleProfiles.id, id));
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ profile: row });
}

export async function PATCH(request: Request, { params }: Ctx) {
  const u = await requireUser();
  if (u instanceof Response) return u;
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const [existing] = await db
    .select()
    .from(xStyleProfiles)
    .where(eq(xStyleProfiles.id, id));
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });

  const set: Partial<typeof xStyleProfiles.$inferInsert> = {};
  if (typeof body.name === "string") set.name = body.name;
  if (typeof body.niche === "string") set.niche = body.niche;
  if (typeof body.model === "string") set.model = body.model;
  if (typeof body.autonomous === "boolean") set.autonomous = body.autonomous;
  if (typeof body.postsPerDay === "number") set.postsPerDay = body.postsPerDay;

  if (typeof body.corpus === "string" && body.corpus.trim()) {
    set.sourceCorpus = body.corpus;
    try {
      set.profile = await buildStyleProfile(
        body.corpus,
        set.model || existing.model
      );
    } catch (err) {
      return Response.json(
        {
          error: `Style analysis failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        },
        { status: 502 }
      );
    }
  }

  if (Object.keys(set).length === 0) {
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }

  const [row] = await db
    .update(xStyleProfiles)
    .set(set)
    .where(eq(xStyleProfiles.id, id))
    .returning();
  return Response.json({ profile: row });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const u = await requireUser();
  if (u instanceof Response) return u;
  const { id } = await params;
  await db.delete(xStyleProfiles).where(eq(xStyleProfiles.id, id));
  return Response.json({ ok: true });
}
