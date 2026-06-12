/**
 * Sends email through the Gmail API as the sender's own mailbox — the message
 * goes out from Google's servers, lands in the sender's Sent folder, and
 * threads exactly like hand-written mail. Plain text only by design.
 */

export type GmailSendArgs = {
  accessToken: string;
  /** Display name only; the From mailbox is implicitly the token's user. */
  fromName: string | null;
  fromEmail: string;
  to: string;
  subject: string;
  text: string;
  /** Our own RFC 2822 Message-ID for the initial send (see newRfcMessageId). */
  messageId?: string;
  /** Gmail thread id of the original send — follow-ups thread under it. */
  threadId?: string | null;
  /** RFC Message-ID of the original send, for In-Reply-To/References. */
  inReplyTo?: string | null;
};

export type GmailSendResult = {
  id: string;
  threadId: string;
  rfcMessageId: string;
};

export class GmailSendError extends Error {
  status: number;
  /** true => transient; leave the recipient scheduled for a later run. */
  retryable: boolean;
  /** true => the sender's token is dead; batch must abort until re-link. */
  tokenProblem: boolean;

  constructor(
    message: string,
    opts: { status: number; retryable: boolean; tokenProblem?: boolean }
  ) {
    super(message);
    this.name = "GmailSendError";
    this.status = opts.status;
    this.retryable = opts.retryable;
    this.tokenProblem = opts.tokenProblem ?? false;
  }
}

/** Deterministic-enough RFC Message-ID we control, so follow-ups can
 *  reference the original without refetching it from Gmail. */
export function newRfcMessageId(recipientId: string, step: number): string {
  return `<cs.${recipientId}.s${step}.${Date.now().toString(36)}@cloudsheer.com>`;
}

/** RFC 2047 B-encoding, only when the value actually needs it. */
function encodeHeaderWord(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Builds the raw RFC 2822 message (exported for testing). */
export function buildMime(args: GmailSendArgs): string {
  const from = args.fromName
    ? `${encodeHeaderWord(args.fromName)} <${args.fromEmail}>`
    : args.fromEmail;

  const headers: string[] = [
    `From: ${from}`,
    `To: ${args.to}`,
    `Subject: ${encodeHeaderWord(args.subject)}`,
  ];
  if (args.messageId) headers.push(`Message-ID: ${args.messageId}`);
  if (args.inReplyTo) {
    headers.push(`In-Reply-To: ${args.inReplyTo}`);
    headers.push(`References: ${args.inReplyTo}`);
  }
  headers.push(
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64"
  );

  // Body base64 lines are wrapped at 76 chars per RFC 2045
  const body =
    Buffer.from(args.text, "utf8")
      .toString("base64")
      .match(/.{1,76}/g)
      ?.join("\r\n") ?? "";

  return headers.join("\r\n") + "\r\n\r\n" + body;
}

const SEND_URL =
  "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

function classifyError(status: number, errBody: string): GmailSendError {
  if (status === 401) {
    return new GmailSendError(`Gmail auth failed (401): ${errBody}`, {
      status,
      retryable: false,
      tokenProblem: true,
    });
  }
  if (status === 429) {
    return new GmailSendError(`Gmail rate limited (429): ${errBody}`, {
      status,
      retryable: true,
    });
  }
  if (status === 403) {
    const rateLike = /rateLimitExceeded|userRateLimitExceeded|dailyLimitExceeded|quota/i.test(
      errBody
    );
    return new GmailSendError(`Gmail send forbidden (403): ${errBody}`, {
      status,
      retryable: rateLike,
    });
  }
  if (status >= 500) {
    return new GmailSendError(`Gmail server error (${status}): ${errBody}`, {
      status,
      retryable: true,
    });
  }
  // 400 etc. — bad recipient/payload; fatal for this recipient only
  return new GmailSendError(`Gmail rejected the send (${status}): ${errBody}`, {
    status,
    retryable: false,
  });
}

async function fetchRfcMessageId(
  accessToken: string,
  gmailMessageId: string
): Promise<string | null> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${gmailMessageId}?format=metadata&metadataHeaders=Message-ID`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) return null;
  const data = (await res.json()) as {
    payload?: { headers?: { name: string; value: string }[] };
  };
  return (
    data.payload?.headers?.find(
      (h) => h.name.toLowerCase() === "message-id"
    )?.value ?? null
  );
}

/**
 * Sends one message. Retries 5xx/network twice in-call (1s/2s); all other
 * failures throw a classified GmailSendError for the dispatcher to act on.
 */
export async function sendGmail(args: GmailSendArgs): Promise<GmailSendResult> {
  const raw = base64url(Buffer.from(buildMime(args), "utf8"));
  const payload: { raw: string; threadId?: string } = { raw };
  if (args.threadId) payload.threadId = args.threadId;

  let lastError: GmailSendError | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, attempt * 1000));
    }
    let res: Response;
    try {
      res = await fetch(SEND_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${args.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      lastError = new GmailSendError(
        `Network error sending via Gmail: ${err instanceof Error ? err.message : err}`,
        { status: 0, retryable: true }
      );
      continue;
    }

    if (res.ok) {
      const data = (await res.json()) as { id: string; threadId: string };
      // Gmail normally preserves a caller-supplied Message-ID; fall back to
      // reading it off the sent message if we didn't supply one.
      let rfcMessageId = args.messageId ?? null;
      if (!rfcMessageId) {
        rfcMessageId = await fetchRfcMessageId(args.accessToken, data.id);
      }
      return {
        id: data.id,
        threadId: data.threadId,
        rfcMessageId: rfcMessageId ?? "",
      };
    }

    const errBody = (await res.text()).slice(0, 500);
    const classified = classifyError(res.status, errBody);
    if (!classified.retryable || res.status === 429 || res.status === 403) {
      // Rate limits are "retryable" across runs, not within one batch loop
      throw classified;
    }
    lastError = classified;
  }
  throw lastError!;
}
