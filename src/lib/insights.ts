import Anthropic from "@anthropic-ai/sdk";
import type { Metrics } from "@/lib/analytics";

export type CampaignInsight = {
  summary: string;
  actions: string[];
};

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic();
  return client;
}

/**
 * Writes a short, honest performance read + recommended next actions for a
 * campaign with Claude Haiku. Returns null when ANTHROPIC_API_KEY is absent or
 * on any error, so the analytics page degrades gracefully without the key.
 */
export async function generateInsights(
  name: string,
  status: string,
  followUpSteps: number,
  m: Metrics
): Promise<CampaignInsight | null> {
  const anthropic = getClient();
  if (!anthropic) return null;

  // Only the figures the model needs, named plainly so it reasons over them.
  const stats = {
    campaign: name,
    status,
    followUpSteps,
    recipients: m.recipients,
    emailed: m.reached,
    delivered: m.delivered,
    bounced: m.bounced,
    queuedToSend: m.queued,
    replies: m.replied,
    positiveReplies: m.positive,
    meetingsRequested: m.meetings,
    notInterested: m.notInterested,
    unsubscribed: m.unsubscribed,
    outOfOffice: m.outOfOffice,
    replyRatePct: m.replyRate,
    positiveReplyRatePct: m.positiveRate,
    bounceRatePct: m.bounceRate,
  };

  try {
    const res = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 500,
      system:
        "You are a cold-email performance analyst. Given one campaign's stats, " +
        "respond with ONLY minified JSON of the form " +
        '{"summary": string, "actions": string[]}. ' +
        "summary: 1 to 2 sentences on how the campaign is performing, citing the key rates. " +
        "actions: 2 to 4 short, specific, imperative next steps ordered most impactful first, " +
        "grounded in these exact numbers (e.g. follow up with the positive replies, fix a high " +
        "bounce rate, add a follow-up step if reply rate is low, send the queued emails). " +
        "Cold-email benchmarks: reply rate 5-10% is solid, positive reply rate 1-3% is good, " +
        "bounce rate under 3% is healthy and over 5% is a deliverability risk. " +
        "Be direct and practical. Do not use em dashes; use regular hyphens.",
      messages: [{ role: "user", content: JSON.stringify(stats) }],
    });

    const out = res.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    const start = out.indexOf("{");
    const end = out.lastIndexOf("}");
    if (start === -1 || end === -1) return null;
    const parsed = JSON.parse(out.slice(start, end + 1)) as CampaignInsight;
    if (typeof parsed?.summary !== "string" || !Array.isArray(parsed.actions)) {
      return null;
    }
    return {
      summary: parsed.summary.trim(),
      actions: parsed.actions
        .filter((a): a is string => typeof a === "string" && a.trim().length > 0)
        .slice(0, 4),
    };
  } catch {
    return null;
  }
}
