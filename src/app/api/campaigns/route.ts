import { nanoid } from "nanoid";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/db";
import { campaigns, recipients } from "@/db/schema";
import { getValidAccessToken } from "@/lib/google";
import {
  fetchSheetRows,
  findEmailColumn,
  isValidEmail,
  parseSheetUrl,
} from "@/lib/sheets";
import { findUnknownPlaceholders } from "@/lib/template";
import { lintContent } from "@/lib/linter";
import { signatureFor } from "@/lib/senders";

const bodySchema = z.object({
  name: z.string().min(1).max(200),
  sheetUrl: z.string().min(1),
  subjectTemplate: z.string().min(1).max(500),
  bodyTemplate: z.string().min(1).max(100_000),
  subjectTemplateB: z.string().max(500).optional(),
  bodyTemplateB: z.string().max(100_000).optional(),
  // Any sender name/email is allowed (custom sender). Note: Resend can only
  // deliver from a domain verified in your account.
  fromName: z.string().max(100).optional(),
  fromEmail: z.string().email().max(200).optional(),
  signature: z.string().max(2000).optional(),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { name, sheetUrl, subjectTemplate, bodyTemplate } = parsed.data;
  // A/B is active only when a B variant has real content
  const subjectTemplateB = parsed.data.subjectTemplateB?.trim() || null;
  const bodyTemplateB = parsed.data.bodyTemplateB?.trim() || null;
  const hasVariantB = !!(subjectTemplateB || bodyTemplateB);

  // Strip characters that could break the From header (newlines, angle
  // brackets, commas) before composing "Name <email>".
  const fromEmail =
    parsed.data.fromEmail?.trim().toLowerCase().replace(/[\r\n<>,]/g, "") ||
    null;
  const fromName =
    parsed.data.fromName?.trim().replace(/[\r\n<>]/g, "") || null;
  const fromAddress = fromEmail
    ? fromName
      ? `${fromName} <${fromEmail}>`
      : fromEmail
    : null;
  // Stored sign-off: the user's text, else the default for this sender.
  const signature =
    parsed.data.signature?.trim() ||
    (fromAddress ? signatureFor(fromAddress) : null);

  const sheetId = parseSheetUrl(sheetUrl);
  if (!sheetId) {
    return Response.json(
      { error: "That doesn't look like a Google Sheets URL or ID" },
      { status: 400 }
    );
  }

  try {
    const accessToken = await getValidAccessToken(session.user.id);
    const sheet = await fetchSheetRows(accessToken, sheetId);

    const emailColumn = sheet.emailColumn ?? findEmailColumn(sheet.headers);
    if (!emailColumn) {
      return Response.json(
        { error: "No email column found. Add a column named Email." },
        { status: 400 }
      );
    }

    const unknown = [
      ...findUnknownPlaceholders(subjectTemplate, sheet.headers),
      ...findUnknownPlaceholders(bodyTemplate, sheet.headers),
      ...findUnknownPlaceholders(subjectTemplateB ?? "", sheet.headers),
      ...findUnknownPlaceholders(bodyTemplateB ?? "", sheet.headers),
    ];
    if (unknown.length > 0) {
      return Response.json(
        {
          error: `Unknown placeholders (no matching sheet column): ${unknown.join(", ")}`,
        },
        { status: 400 }
      );
    }

    const nameColumn = sheet.headers.find(
      (h) => h.trim().toLowerCase() === "name"
    );

    // Row 1 is headers, so data row i lives at sheet row i + 2
    const withValidEmail = sheet.rows
      .map((row, i) => ({ row, sheetRow: i + 2 }))
      .filter(({ row }) => isValidEmail(row[emailColumn] ?? ""));
    const skippedInvalid = sheet.rows.length - withValidEmail.length;

    // Dedup on lowercased email: keep the first occurrence, drop the rest.
    const seen = new Set<string>();
    const validRows: { row: Record<string, string>; sheetRow: number }[] = [];
    for (const entry of withValidEmail) {
      const key = entry.row[emailColumn].trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      validRows.push(entry);
    }
    const skippedDuplicates = withValidEmail.length - validRows.length;

    if (validRows.length === 0) {
      return Response.json(
        { error: `No rows with a valid email in column "${emailColumn}"` },
        { status: 400 }
      );
    }

    // Deliverability warnings (non-blocking) on the composed content.
    const warnings = [
      ...lintContent({ subject: subjectTemplate, body: bodyTemplate }),
      ...(hasVariantB
        ? lintContent({
            subject: subjectTemplateB ?? subjectTemplate,
            body: bodyTemplateB ?? bodyTemplate,
          })
        : []),
    ].map((w) => w.message);

    const [campaign] = await db
      .insert(campaigns)
      .values({
        userId: session.user.id,
        name,
        sheetId,
        sheetUrl,
        subjectTemplate,
        bodyTemplate,
        subjectTemplateB,
        bodyTemplateB,
        fromAddress,
        signature,
        status: "draft",
        total: validRows.length,
      })
      .returning();

    // Insert recipients in chunks to stay under statement parameter limits
    const CHUNK = 500;
    for (let i = 0; i < validRows.length; i += CHUNK) {
      await db.insert(recipients).values(
        validRows.slice(i, i + CHUNK).map(({ row, sheetRow }, j) => ({
          campaignId: campaign.id,
          email: row[emailColumn].trim().toLowerCase(),
          name: nameColumn ? row[nameColumn] || null : null,
          rowData: row,
          sheetRow,
          variant: (hasVariantB && (i + j) % 2 === 1 ? "B" : "A") as "A" | "B",
          unsubscribeToken: nanoid(32),
        }))
      );
    }

    return Response.json({
      id: campaign.id,
      total: validRows.length,
      skippedInvalidEmails: skippedInvalid,
      skippedDuplicates,
      warnings,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to create campaign",
      },
      { status: 502 }
    );
  }
}
