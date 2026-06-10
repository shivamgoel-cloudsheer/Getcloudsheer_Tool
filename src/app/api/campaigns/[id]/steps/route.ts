import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/db";
import { campaigns, sequenceSteps } from "@/db/schema";

const addSchema = z.object({
  delayDays: z.number().int().min(1).max(30),
  subjectTemplate: z.string().min(1).max(500),
  bodyTemplate: z.string().min(1).max(100_000),
});

const removeSchema = z.object({ stepId: z.string().uuid() });

async function ownedCampaign(id: string, userId: string) {
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, id), eq(campaigns.userId, userId)));
  return campaign ?? null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await params;
  const campaign = await ownedCampaign(id, session.user.id);
  if (!campaign) {
    return Response.json({ error: "Campaign not found" }, { status: 404 });
  }

  const parsed = addSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid step: delay must be 1-30 days, subject and body required" },
      { status: 400 }
    );
  }

  const existing = await db
    .select()
    .from(sequenceSteps)
    .where(eq(sequenceSteps.campaignId, id))
    .orderBy(asc(sequenceSteps.stepNumber));

  if (existing.length >= 5) {
    return Response.json(
      { error: "A campaign supports at most 5 follow-up steps" },
      { status: 400 }
    );
  }

  const [step] = await db
    .insert(sequenceSteps)
    .values({
      campaignId: id,
      stepNumber: (existing.at(-1)?.stepNumber ?? 0) + 1,
      delayDays: parsed.data.delayDays,
      subjectTemplate: parsed.data.subjectTemplate,
      bodyTemplate: parsed.data.bodyTemplate,
    })
    .returning();

  return Response.json({ step });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await params;
  const campaign = await ownedCampaign(id, session.user.id);
  if (!campaign) {
    return Response.json({ error: "Campaign not found" }, { status: 404 });
  }

  const parsed = removeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "stepId required" }, { status: 400 });
  }

  await db
    .delete(sequenceSteps)
    .where(
      and(
        eq(sequenceSteps.id, parsed.data.stepId),
        eq(sequenceSteps.campaignId, id)
      )
    );

  // Renumber the remaining steps so the sequence stays 1..n
  const remaining = await db
    .select()
    .from(sequenceSteps)
    .where(eq(sequenceSteps.campaignId, id))
    .orderBy(asc(sequenceSteps.stepNumber));

  for (let i = 0; i < remaining.length; i++) {
    if (remaining[i].stepNumber !== i + 1) {
      await db
        .update(sequenceSteps)
        .set({ stepNumber: i + 1 })
        .where(eq(sequenceSteps.id, remaining[i].id));
    }
  }

  return Response.json({ ok: true });
}
