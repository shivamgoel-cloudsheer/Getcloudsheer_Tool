import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/db";
import { campaigns, type StoredStaggerConfig } from "@/db/schema";
import { isValidTimeZone } from "@/lib/timezone";
import { isAdminEmail } from "@/lib/admin";

const MAX_DAILY_CAP = 100;

// Saves drip settings (and an optional start time) onto a draft so it can be
// scheduled or sent later. This does NOT start sending - recipients stay
// pending and the campaign stays a draft until Start/Send now is pressed.
const patchSchema = z.object({
  scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
  stagger: z
    .object({
      gapMinutes: z.number().min(1).max(240),
      dailyCap: z.number().int().min(1).max(MAX_DAILY_CAP),
      windowStart: z.string().regex(/^\d{2}:\d{2}$/),
      windowEnd: z.string().regex(/^\d{2}:\d{2}$/),
      skipWeekends: z.boolean(),
      timeZone: z.string(),
      warmup: z.boolean().optional(),
      perRecipientTimeZone: z.boolean().optional(),
    })
    .optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await params;

  const raw = await request.text();
  const parsed = patchSchema.safeParse(raw ? JSON.parse(raw) : {});
  if (!parsed.success) {
    return Response.json({ error: "Invalid input" }, { status: 400 });
  }

  const update: Partial<typeof campaigns.$inferInsert> = {};

  if (parsed.data.stagger) {
    const s = parsed.data.stagger;
    if (!isValidTimeZone(s.timeZone)) {
      return Response.json({ error: "Invalid timezone" }, { status: 400 });
    }
    if (s.windowStart >= s.windowEnd) {
      return Response.json(
        { error: "Send window start must be before its end" },
        { status: 400 }
      );
    }
    const stored: StoredStaggerConfig = {
      gapMinutes: s.gapMinutes,
      dailyCap: s.dailyCap,
      windowStart: s.windowStart,
      windowEnd: s.windowEnd,
      skipWeekends: s.skipWeekends,
      timeZone: s.timeZone,
      warmup: s.warmup ?? true,
      perRecipientTimeZone: s.perRecipientTimeZone ?? false,
    };
    update.staggerConfig = stored;
  }

  if (parsed.data.scheduledAt !== undefined) {
    update.scheduledAt = parsed.data.scheduledAt
      ? new Date(parsed.data.scheduledAt)
      : null;
  }

  // Only a draft/failed campaign can have its plan edited; sending/sent/
  // scheduled ones are locked. Managers can edit anyone's; others only own.
  const admin = isAdminEmail(session.user.email);
  const [updated] = await db
    .update(campaigns)
    .set(update)
    .where(
      and(
        eq(campaigns.id, id),
        ...(admin ? [] : [eq(campaigns.userId, session.user.id)]),
        inArray(campaigns.status, ["draft", "failed"])
      )
    )
    .returning({ id: campaigns.id });

  if (!updated) {
    return Response.json(
      { error: "Campaign not found or already scheduled/sending" },
      { status: 409 }
    );
  }

  return Response.json({ saved: true });
}

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
  // still-queued rows and nothing remote needs cancelling first. Managers can
  // delete anyone's campaign; everyone else only their own.
  const admin = isAdminEmail(session.user.email);
  const deleted = await db
    .delete(campaigns)
    .where(
      and(
        eq(campaigns.id, id),
        ...(admin ? [] : [eq(campaigns.userId, session.user.id)])
      )
    )
    .returning({ id: campaigns.id });

  if (deleted.length === 0) {
    return Response.json({ error: "Campaign not found" }, { status: 404 });
  }

  return Response.json({ deleted: true });
}
