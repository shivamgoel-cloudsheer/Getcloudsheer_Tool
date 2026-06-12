/**
 * Replaces {{Column Name}} placeholders with values from the row data.
 * Matching is case-insensitive and whitespace-tolerant.
 */
export function renderTemplate(
  template: string,
  data: Record<string, string>
): string {
  const lookup = new Map(
    Object.entries(data).map(([k, v]) => [k.trim().toLowerCase(), v])
  );
  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, key: string) => {
    return lookup.get(key.toLowerCase()) ?? "";
  });
}

/** Lists distinct placeholder names used in a template. */
export function extractPlaceholders(template: string): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
    found.add(match[1]);
  }
  return [...found];
}

/** Returns placeholders that don't correspond to any sheet column. */
export function findUnknownPlaceholders(
  template: string,
  headers: string[]
): string[] {
  const known = new Set(headers.map((h) => h.trim().toLowerCase()));
  return extractPlaceholders(template).filter(
    (p) => !known.has(p.trim().toLowerCase())
  );
}

/**
 * Picks the subject/body templates for a recipient's A/B variant. Structural
 * types keep this lib decoupled from the DB schema.
 */
export function templatesFor(
  campaign: {
    subjectTemplate: string;
    bodyTemplate: string;
    subjectTemplateB: string | null;
    bodyTemplateB: string | null;
  },
  r: { variant: string }
): { subject: string; body: string } {
  if (r.variant === "B") {
    return {
      subject: campaign.subjectTemplateB || campaign.subjectTemplate,
      body: campaign.bodyTemplateB || campaign.bodyTemplate,
    };
  }
  return { subject: campaign.subjectTemplate, body: campaign.bodyTemplate };
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Builds the HTML and plain-text bodies for an email. If the rendered body
 * already looks like HTML it is passed through; otherwise newlines become
 * <br/> tags. Only the signature is appended - no footer, opt-out line, or
 * postal address (removed for a fully 1:1 look; note this is not CAN-SPAM
 * compliant for US commercial mail).
 */
export function buildEmailBodies(
  renderedBody: string,
  signature?: string | null
): { html: string; text: string } {
  const looksLikeHtml = /<[a-z][\s\S]*>/i.test(renderedBody);
  const sig = signature?.trim() || "";

  const htmlBody = looksLikeHtml
    ? renderedBody
    : escapeHtml(renderedBody).replace(/\r?\n/g, "<br/>");
  const htmlSig = sig
    ? `<p style="margin-top: 16px;">${escapeHtml(sig).replace(/\r?\n/g, "<br/>")}</p>`
    : "";

  const html = `<!DOCTYPE html>
<html>
  <body style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.6; color: #1a1a1a;">
    <div>${htmlBody}</div>
    ${htmlSig}
  </body>
</html>`;

  const text = `${renderedBody}${sig ? `\n\n${sig}` : ""}`;

  return { html, text };
}
