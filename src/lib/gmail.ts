type GmailMessageList = {
  messages?: { id: string }[];
  resultSizeEstimate?: number;
};

type GmailMessage = {
  id: string;
  internalDate?: string;
  payload?: { headers?: { name: string; value: string }[] };
};

const CHUNK_SIZE = 15;

function extractEmail(fromHeader: string): string | null {
  const match = fromHeader.match(/<([^>]+)>/);
  const email = (match ? match[1] : fromHeader).trim().toLowerCase();
  return email.includes("@") ? email : null;
}

/**
 * Searches the user's Gmail inbox for messages from any of the given
 * addresses and returns a map of sender email -> reply timestamp.
 * Throws with a clear message when the Gmail scope is missing.
 */
export async function findRepliesFrom(
  accessToken: string,
  emails: string[]
): Promise<Map<string, Date>> {
  const replies = new Map<string, Date>();
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
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${ref.id}?format=metadata&metadataHeaders=From`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        }
      );
      if (!msgRes.ok) continue;

      const msg = (await msgRes.json()) as GmailMessage;
      const fromHeader = msg.payload?.headers?.find(
        (h) => h.name.toLowerCase() === "from"
      )?.value;
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
      if (!existing || at > existing) {
        replies.set(sender, at);
      }
    }
  }

  return replies;
}
