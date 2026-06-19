import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { xStyleProfiles } from "@/db/schema";
import { buildStyleProfile } from "@/lib/x/generate";
import { GENERATION_MODEL } from "@/lib/x/anthropic";
import { requireUser } from "@/lib/x/guard";

export const maxDuration = 120;

export async function GET(request: Request) {
  const u = await requireUser();
  if (u instanceof Response) return u;

  const { searchParams } = new URL(request.url);
  const xAccountId = searchParams.get("xAccountId");

  const rows = await db
    .select()
    .from(xStyleProfiles)
    .where(xAccountId ? eq(xStyleProfiles.xAccountId, xAccountId) : undefined)
    .orderBy(desc(xStyleProfiles.createdAt));
  return Response.json({ profiles: rows });
}

export async function POST(request: Request) {
  const u = await requireUser();
  if (u instanceof Response) return u;

  const body = await request.json().catch(() => null);
  if (!body?.xAccountId || !body?.name || !body?.niche || !body?.corpus) {
    return Response.json(
      { error: "xAccountId, name, niche, and corpus are required" },
      { status: 400 }
    );
  }

  const model = body.model || GENERATION_MODEL;

  let profile;
  try {
    profile = await buildStyleProfile(body.corpus, model);
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

  const [row] = await db
    .insert(xStyleProfiles)
    .values({
      xAccountId: body.xAccountId,
      name: body.name,
      niche: body.niche,
      sourceCorpus: body.corpus,
      profile,
      model,
      autonomous: typeof body.autonomous === "boolean" ? body.autonomous : true,
      postsPerDay: typeof body.postsPerDay === "number" ? body.postsPerDay : 3,
    })
    .returning();

  return Response.json({ profile: row });
}
