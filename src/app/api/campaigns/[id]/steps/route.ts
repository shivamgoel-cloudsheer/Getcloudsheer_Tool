import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/db";
import { campaigns, recipients, sequenceSteps } from "@/db/schema";
import { isAdminEmail } from "@/lib/admin";
import { getValidAccessToken } from "@/lib/google";
import { fetchSheetRows, parseSheetUrl } from "@/lib/sheets";

const addSchema = z.object({
  delayDays: z.number().int().min(1).max(30),
  subjectTemplate: z.string().min(1).max(500),
  bodyTemplate: z.string().min(1).max(100_000),
  // Optional absolute send time (overrides delayDays for this step).
  scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
  // Optional: re-read a sheet and refresh the matching recipients' data.
  sheetUrl: z.string().optional(),
  sheetTab: z.string().optional(),
  selectedColumns: z.array(z.string()).optional(),
});

/**
 * Re-reads a sheet and merges the chosen columns into existing recipients,
 * matched by email. Returns how many recipients were refreshed. Only updates
 * people already in the campaign - it never adds new recipients.
 */
async function refreshRecipientData(
  campaignId: string,
  userId: string,
  sheetUrl: string,
  sheetTab: string | undefined,
  selectedColumns: string[] | undefined
): Promise<number> {
  const sheetId = parseSheetUrl(sheetUrl);
  if (!sheetId) throw new Error("That doesn't look like a Google Sheets URL");

  const token = await getValidAccessToken(userId);
  const sheet = await fetchSheetRows(token, sheetId, sheetTab ?? null);
  const emailCol = sheet.emailColumn;
  if (!emailCol) throw new Error("No email column found in that sheet");

  const cols =
    selectedColumns && selectedColumns.length > 0
      ? new Set(selectedColumns)
      : new Set(sheet.headers);

  // email -> chosen columns of its (first) row
  const byEmail = new Map<string, Record<string, string>>();
  for (const row of sheet.rows) {
    const e = (row[emailCol] ?? "").trim().toLowerCase();
    if (!e || byEmail.has(e)) continue;
    byEmail.set(
      e,
      Object.fromEntries(Object.entries(row).filter(([k]) => cols.has(k)))
    );
  }

  const recs = await db
    .select({ id: recipients.id, email: recipients.email, rowData: recipients.rowData })
    .from(recipients)
    .where(eq(recipients.campaignId, campaignId));

  let updated = 0;
  for (const r of recs) {
    const fresh = byEmail.get(r.email.toLowerCase());
    if (!fresh) continue;
    await db
      .update(recipients)
      .set({
        rowData: { ...(r.rowData as Record<string, string>), ...fresh },
      })
      .where(eq(recipients.id, r.id));
    updated++;
  }
  return updated;
}

const removeSchema = z.object({ stepId: z.string().uuid() });

// Managers (admin) may edit any campaign's steps; everyone else only their own.
async function ownedCampaign(id: string, userId: string, admin: boolean) {
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(
      admin
        ? eq(campaigns.id, id)
        : and(eq(campaigns.id, id), eq(campaigns.userId, userId))
    );
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
  const campaign = await ownedCampaign(
    id,
    session.user.id,
    isAdminEmail(session.user.email)
  );
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

  // Optional: refresh the matching recipients' data from a re-uploaded sheet.
  let refreshed = 0;
  if (parsed.data.sheetUrl) {
    try {
      refreshed = await refreshRecipientData(
        id,
        session.user.id,
        parsed.data.sheetUrl,
        parsed.data.sheetTab,
        parsed.data.selectedColumns
      );
    } catch (e) {
      return Response.json(
        { error: e instanceof Error ? e.message : "Failed to read sheet" },
        { status: 400 }
      );
    }
  }

  const [step] = await db
    .insert(sequenceSteps)
    .values({
      campaignId: id,
      stepNumber: (existing.at(-1)?.stepNumber ?? 0) + 1,
      delayDays: parsed.data.delayDays,
      scheduledAt: parsed.data.scheduledAt
        ? new Date(parsed.data.scheduledAt)
        : null,
      subjectTemplate: parsed.data.subjectTemplate,
      bodyTemplate: parsed.data.bodyTemplate,
    })
    .returning();

  return Response.json({ step, refreshed });
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
  const campaign = await ownedCampaign(
    id,
    session.user.id,
    isAdminEmail(session.user.email)
  );
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
