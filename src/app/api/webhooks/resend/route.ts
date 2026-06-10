import { Webhook } from "svix";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  emailEvents,
  recipients,
  unsubscribes,
  type RecipientStatus,
} from "@/db/schema";

type ResendWebhookEvent = {
  type: string;
  created_at: string;
  data: {
    email_id?: string;
    to?: string[];
    tags?: Record<string, string> | { name: string; value: string }[];
    [key: string]: unknown;
  };
};

// Precedence ladder: a recipient's status only moves forward, never back.
const STATUS_RANK: Record<RecipientStatus, number> = {
  pending: 0,
  suppressed: 0,
  scheduled: 1,
  sent: 2,
  delivered: 3,
  opened: 4,
  clicked: 5,
  replied: 50, // set by the reply detector, never by webhooks
  failed: 90,
  bounced: 91,
  complained: 92,
};

const EVENT_TO_STATUS: Record<string, RecipientStatus> = {
  "email.scheduled": "scheduled",
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.opened": "opened",
  "email.clicked": "clicked",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.failed": "failed",
};

function getTag(
  tags: ResendWebhookEvent["data"]["tags"],
  name: string
): string | null {
  if (!tags) return null;
  if (Array.isArray(tags)) {
    return tags.find((t) => t.name === name)?.value ?? null;
  }
  return tags[name] ?? null;
}

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  const payload = await request.text();
  const svixHeaders = {
    "svix-id": request.headers.get("svix-id") ?? "",
    "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
    "svix-signature": request.headers.get("svix-signature") ?? "",
  };

  let event: ResendWebhookEvent;
  try {
    event = new Webhook(secret).verify(payload, svixHeaders) as ResendWebhookEvent;
  } catch {
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  const emailId = event.data?.email_id;
  if (!emailId) {
    // Not an email event we track (e.g. domain or contact events)
    return Response.json({ received: true });
  }

  // Resolve the recipient: primary key is the stored Resend email ID,
  // fallback is the recipient_id tag we attach to every send.
  let [recipient] = await db
    .select()
    .from(recipients)
    .where(eq(recipients.resendEmailId, emailId));

  if (!recipient) {
    const recipientIdTag = getTag(event.data.tags, "recipient_id");
    if (recipientIdTag) {
      [recipient] = await db
        .select()
        .from(recipients)
        .where(eq(recipients.id, recipientIdTag));
    }
  }

  if (!recipient) {
    if (!EVENT_TO_STATUS[event.type]) {
      // Event we take no action on (e.g. email.canceled) for an email
      // we no longer track; acknowledge it.
      return Response.json({ received: true });
    }
    // The send route may not have committed resend_email_id yet.
    // Return 500 so Svix retries this delivery shortly.
    return Response.json({ error: "Recipient not found yet" }, { status: 500 });
  }

  // Raw audit log; unique(resend_email_id, type) keeps this idempotent
  await db
    .insert(emailEvents)
    .values({
      recipientId: recipient.id,
      resendEmailId: emailId,
      type: event.type,
      payload: event.data,
    })
    .onConflictDoNothing();

  const newStatus = EVENT_TO_STATUS[event.type];
  if (newStatus && STATUS_RANK[newStatus] > STATUS_RANK[recipient.status]) {
    await db
      .update(recipients)
      .set({
        status: newStatus,
        ...(newStatus === "opened" && !recipient.openedAt
          ? { openedAt: new Date() }
          : {}),
        ...(newStatus === "clicked"
          ? {
              clickedAt: recipient.clickedAt ?? new Date(),
              ...(recipient.openedAt ? {} : { openedAt: new Date() }),
            }
          : {}),
      })
      .where(eq(recipients.id, recipient.id));
  }

  // Hard bounces and complaints go straight onto the suppression list
  if (event.type === "email.bounced" || event.type === "email.complained") {
    await db
      .insert(unsubscribes)
      .values({
        email: recipient.email.toLowerCase(),
        source: event.type === "email.bounced" ? "bounce" : "complaint",
      })
      .onConflictDoNothing();
  }

  return Response.json({ received: true });
}
