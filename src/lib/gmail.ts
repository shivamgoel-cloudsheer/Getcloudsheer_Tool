type GmailHeader = { name: string; value: string };

type GmailMessagePart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailMessagePart[];
};

type GmailMessageList = {
  messages?: { id: string }[];
  resultSizeEstimate?: number;
};

type GmailMessage = {
  id: string;
  internalDate?: string;
  snippet?: string;
  payload?: { headers?: GmailHeader[] } & GmailMessagePart;
};

/** What we learn about the latest reply from a given address. */
export type ReplyInfo = {
  at: Date;
  snippet: string;
  messageId: string;
  subject: string;
};

const CHUNK_SIZE = 15;

function extractEmail(fromHeader: string): string | null {
  const match = fromHeader.match(/<([^>]+)>/);
  const email = (match ? match[1] : fromHeader).trim().toLowerCase();
  return email.includes("@") ? email : null;
}

function headerValue(headers: GmailHeader[] | undefined, name: string): string {
  return (
    headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ??
    ""
  );
}

/** Gmail base64url -> utf8 string. */
function decodeB64Url(data: string): string {
  return Buffer.from(
    data.replace(/-/g, "+").replace(/_/g, "/"),
    "base64"
  ).toString("utf8");
}

/**
 * Walks a Gmail payload tree and returns the best human-readable body:
 * prefers text/plain, falls back to a tag-stripped text/html.
 */
function extractBody(part: GmailMessagePart | undefined): string {
  if (!part) return "";
  const findMime = (mime: string): string | null => {
    const walk = (p: GmailMessagePart): string | null => {
      if (p.mimeType === mime && p.body?.data) return decodeB64Url(p.body.data);
      for (const child of p.parts ?? []) {
        const found = walk(child);
        if (found) return found;
      }
      return null;
    };
    return walk(part);
  };
  const plain = findMime("text/plain");
  if (plain) return plain;
  const html = findMime("text/html");
  if (html) {
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  return "";
}

/**
 * Searches the user's Gmail inbox for messages from any of the given
 * addresses and returns a map of sender email -> latest reply info (timestamp,
 * preview snippet, message id, subject). Throws with a clear message when the
 * Gmail scope is missing.
 */
export async function findRepliesFrom(
  accessToken: string,
  emails: string[]
): Promise<Map<string, ReplyInfo>> {
  const replies = new Map<string, ReplyInfo>();
  if (emails.length === 0) return replies;

  const watched = new Set(emails.map((e) => e.toLowerCase()));

  for (let i = 0; i < emails.length; i += CHUNK_SIZE) {
    const chunk = emails.slice(i, i + CHUNK_SIZE);
    const query = `in:inbox newer_than:30d from:(${chunk.join(" OR ")})`;

    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=50`,
      { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" }
    );

    if (listRes.status === 403) {
      throw new Error(
        "Gmail access not granted. Sign out and sign in again to enable reply detection."
      );
    }
    if (!listRes.ok) {
      throw new Error(`Gmail API error ${listRes.status}`);
    }

    const list = (await listRes.json()) as GmailMessageList;

    for (const ref of list.messages ?? []) {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${ref.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        }
      );
      if (!msgRes.ok) continue;

      const msg = (await msgRes.json()) as GmailMessage;
      const fromHeader = headerValue(msg.payload?.headers, "from");
      if (!fromHeader) continue;

      const sender = extractEmail(fromHeader);
      if (!sender || !watched.has(sender)) continue;

      const at = msg.internalDate
        ? new Date(Number(msg.internalDate))
        : new Date();
      // Keep the most recent message from this sender. The caller compares it
      // against when we last emailed them, so an older pre-existing thread
      // can't hide a genuine reply that arrived after our send.
      const existing = replies.get(sender);
      if (!existing || at > existing.at) {
        replies.set(sender, {
          at,
          snippet: msg.snippet ?? "",
          messageId: msg.id,
          subject: headerValue(msg.payload?.headers, "subject"),
        });
      }
    }
  }

  return replies;
}

/**
 * Fetches one message's readable body + headers (for "View reply"). Uses the
 * mailbox the token belongs to - the sender's, since replies land there.
 */
export async function fetchMessageBody(
  accessToken: string,
  messageId: string
): Promise<{ from: string; subject: string; date: string; body: string }> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" }
  );
  if (res.status === 403) {
    throw new Error("Gmail access not granted for this mailbox.");
  }
  if (!res.ok) throw new Error(`Gmail API error ${res.status}`);

  const msg = (await res.json()) as GmailMessage;
  return {
    from: headerValue(msg.payload?.headers, "from"),
    subject: headerValue(msg.payload?.headers, "subject"),
    date: headerValue(msg.payload?.headers, "date"),
    body: extractBody(msg.payload) || msg.snippet || "",
  };
}
