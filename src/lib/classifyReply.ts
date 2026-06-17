import Anthropic from "@anthropic-ai/sdk";

export type ReplyCategory =
  | "interested"
  | "meeting"
  | "later"
  | "not_interested"
  | "unsubscribe"
  | "wrong_person"
  | "out_of_office"
  | "neutral";

export const REPLY_CATEGORIES: ReplyCategory[] = [
  "interested",
  "meeting",
  "later",
  "not_interested",
  "unsubscribe",
  "wrong_person",
  "out_of_office",
  "neutral",
];

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic();
  return client;
}

/**
 * Classifies a reply into one of four buckets with Claude Haiku. Returns null
 * when ANTHROPIC_API_KEY isn't configured or on any error, so reply processing
 * keeps working uncategorized until the key is added (then it auto-tags).
 */
export async function classifyReply(
  subject: string | null | undefined,
  snippet: string | null | undefined
): Promise<ReplyCategory | null> {
  const anthropic = getClient();
  if (!anthropic) return null;

  const text = `Subject: ${subject ?? ""}\n\n${snippet ?? ""}`
    .slice(0, 2000)
    .trim();
  if (!text) return null;

  try {
    const res = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 16,
      system:
        "You label replies to cold sales emails by the sender's intent. Respond with " +
        "EXACTLY one of these labels and nothing else:\n" +
        "interested = positive, wants to learn more, asks a genuine question.\n" +
        "meeting = explicitly wants a call/demo or proposes a time.\n" +
        "later = interested but not now (e.g. 'circle back next quarter', 'reach out in Q3').\n" +
        "not_interested = a clear no, but not asking to be removed.\n" +
        "unsubscribe = asks to stop/unsubscribe/remove/do-not-contact, or is hostile about being emailed.\n" +
        "wrong_person = says they aren't the right contact or refers you to someone else.\n" +
        "out_of_office = an automatic away/vacation/parental-leave/left-the-company reply.\n" +
        "neutral = anything else (forwarded, unclear, just 'who is this?').",
      messages: [{ role: "user", content: text }],
    });

    const out = res.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join(" ")
      .toLowerCase();

    // Match longest label first so "interested" doesn't shadow "not_interested".
    const byLength = [...REPLY_CATEGORIES].sort((a, b) => b.length - a.length);
    return byLength.find((c) => out.includes(c)) ?? "neutral";
  } catch {
    return null;
  }
}
