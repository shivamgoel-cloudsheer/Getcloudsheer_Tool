import { eq } from "drizzle-orm";
import { db } from "@/db";
import { recipients, unsubscribes } from "@/db/schema";
import { cancelScheduledForEmail } from "@/lib/suppress";

function page(body: string): Response {
  return new Response(
    `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Unsubscribe</title>
    <style>
      body { font-family: Arial, Helvetica, sans-serif; background: #f6f6f6; margin: 0; }
      .card { max-width: 420px; margin: 80px auto; background: #ffffff; border-radius: 12px;
              padding: 40px; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
      h1 { font-size: 20px; color: #1a1a1a; }
      p { color: #555555; font-size: 14px; line-height: 1.6; }
      button { background: #1a1a1a; color: #ffffff; border: none; border-radius: 8px;
               padding: 12px 28px; font-size: 14px; cursor: pointer; }
    </style>
  </head>
  <body><div class="card">${body}</div></body>
</html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

async function findRecipient(token: string) {
  const [recipient] = await db
    .select()
    .from(recipients)
    .where(eq(recipients.unsubscribeToken, token));
  return recipient ?? null;
}

async function suppress(email: string, source: string) {
  await db
    .insert(unsubscribes)
    .values({ email: email.toLowerCase(), source })
    .onConflictDoNothing();
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const recipient = await findRecipient(token);

  if (!recipient) {
    return page("<h1>Link not found</h1><p>This unsubscribe link is not valid.</p>");
  }

  return page(`
    <h1>Unsubscribe</h1>
    <p>Stop receiving emails at <strong>${recipient.email}</strong>?</p>
    <form method="POST">
      <button type="submit">Unsubscribe</button>
    </form>
  `);
}

// Handles both the confirm button above and RFC 8058 one-click
// unsubscribe requests sent automatically by Gmail and Yahoo.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const recipient = await findRecipient(token);

  if (!recipient) {
    return page("<h1>Link not found</h1><p>This unsubscribe link is not valid.</p>");
  }

  await suppress(recipient.email, "link");
  // Pull back any follow-ups already queued to this address.
  await cancelScheduledForEmail(recipient.email);

  return page(
    `<h1>You're unsubscribed</h1><p><strong>${recipient.email}</strong> won't receive any more emails from us.</p>`
  );
}
