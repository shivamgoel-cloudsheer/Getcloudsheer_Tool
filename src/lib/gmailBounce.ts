/**
 * Bounce detection without webhooks: delivery failures arrive as
 * mailer-daemon/postmaster reports in the sending mailbox, so we scan for
 * them and extract the failed recipient address. Conservative by design -
 * only exact addresses from the report's machine-readable fields are
 * returned, never fuzzy parses of the quoted original.
 */

type GmailMessageList = {
  messages?: { id: string }[];
};

type GmailMessageMeta = {
  id: string;
  internalDate?: string;
  payload?: { headers?: { name: string; value: string }[] };
};

type GmailMessageFull = {
  id: string;
  internalDate?: string;
  payload?: GmailPart;
};

type GmailPart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
};

function decodeBody(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64")
    .toString("utf8");
}

/** Walks the MIME tree collecting decoded text of delivery-status parts
 *  (falls back to all text parts when none is marked as such). */
function collectStatusText(part: GmailPart | undefined, out: string[]): void {
  if (!part) return;
  const isStatus =
    part.mimeType === "message/delivery-status" ||
    part.mimeType?.startsWith("text/");
  if (isStatus && part.body?.data) {
    out.push(decodeBody(part.body.data));
  }
  for (const p of part.parts ?? []) collectStatusText(p, out);
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

function extractFailedAddress(
  headers: { name: string; value: string }[] | undefined,
  bodyTexts: string[]
): string | null {
  const failedHeader = headers?.find(
    (h) => h.name.toLowerCase() === "x-failed-recipients"
  )?.value;
  if (failedHeader) {
    const m = failedHeader.match(EMAIL_RE);
    if (m) return m[0].toLowerCase();
  }

  for (const text of bodyTexts) {
    // RFC 3464 delivery status: "Final-Recipient: rfc822; user@example.com"
    const m = text.match(
      /Final-Recipient:\s*rfc822;\s*<?([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})>?/i
    );
    if (m) return m[1].toLowerCase();
  }
  return null;
}

/**
 * Scans the mailbox for recent delivery-failure reports and returns a map of
 * failed recipient email -> report timestamp.
 */
export async function findBouncedAddresses(
  accessToken: string
): Promise<Map<string, Date>> {
  const bounced = new Map<string, Date>();

  const query = "from:(mailer-daemon OR postmaster) newer_than:3d";
  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=50`,
    { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" }
  );
  if (!listRes.ok) {
    // Missing scope / transient failure: report nothing rather than guessing
    if (listRes.status === 403) return bounced;
    throw new Error(`Gmail bounce scan failed: ${listRes.status}`);
  }

  const list = (await listRes.json()) as GmailMessageList;

  for (const ref of list.messages ?? []) {
    // Cheap pass first: the X-Failed-Recipients header alone often suffices
    const metaRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${ref.id}?format=metadata&metadataHeaders=X-Failed-Recipients`,
      { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" }
    );
    if (!metaRes.ok) continue;
    const meta = (await metaRes.json()) as GmailMessageMeta;
    const at = meta.internalDate
      ? new Date(Number(meta.internalDate))
      : new Date();

    let address = extractFailedAddress(meta.payload?.headers, []);

    if (!address) {
      const fullRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${ref.id}?format=full`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        }
      );
      if (!fullRes.ok) continue;
      const full = (await fullRes.json()) as GmailMessageFull;
      const texts: string[] = [];
      collectStatusText(full.payload, texts);
      address = extractFailedAddress(undefined, texts);
    }

    if (address) {
      const existing = bounced.get(address);
      if (!existing || at > existing) bounced.set(address, at);
    }
  }

  return bounced;
}
