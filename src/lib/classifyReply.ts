import Anthropic from "@anthropic-ai/sdk";

export type ReplyCategory =
  | "positive"
  | "negative"
  | "out_of_office"
  | "neutral";

export const REPLY_CATEGORIES: ReplyCategory[] = [
  "positive",
  "negative",
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
        "You label replies to cold sales emails. Respond with EXACTLY one of these " +
        "labels and nothing else: positive, negative, out_of_office, neutral.\n" +
        "positive = interested, wants to talk, asks a question, books a call.\n" +
        "negative = not interested, asks to unsubscribe/stop, do not contact, hostile.\n" +
        "out_of_office = an automatic away/vacation/parental-leave/left-the-company reply.\n" +
        "neutral = anything else (forwarded, unclear, asks who you are).",
      messages: [{ role: "user", content: text }],
    });

    const out = res.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join(" ")
      .toLowerCase();

    return REPLY_CATEGORIES.find((c) => out.includes(c)) ?? "neutral";
  } catch {
    return null;
  }
}
