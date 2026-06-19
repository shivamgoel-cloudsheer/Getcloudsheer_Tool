import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, GENERATION_MODEL } from "./anthropic";

// Free, key-less trend sourcing: pull fresh headlines from public feeds, then
// let Claude pick the most timely + postable ones for the niche. This avoids
// the paywalled X trends/search endpoints entirely.

export type Trend = {
  topic: string;
  summary: string;
  whyNow: string;
  sourceUrl: string;
};

type Headline = { title: string; url: string };

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function firstMatch(haystack: string, re: RegExp): string | null {
  const m = haystack.match(re);
  return m ? m[1] : null;
}

/** Google News RSS search for the niche. No key, returns recent headlines. */
async function googleNews(niche: string): Promise<Headline[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(
    niche
  )}&hl=en-US&gl=US&ceid=US:en`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CloudsheerX/1.0)" },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const items = xml.split("<item>").slice(1, 21);
    const out: Headline[] = [];
    for (const item of items) {
      const title = firstMatch(item, /<title>([\s\S]*?)<\/title>/);
      const link = firstMatch(item, /<link>([\s\S]*?)<\/link>/);
      if (title && link) {
        out.push({ title: decodeEntities(title), url: decodeEntities(link) });
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Hacker News front page via the public Algolia API. Good for tech niches. */
async function hackerNews(): Promise<Headline[]> {
  try {
    const res = await fetch(
      "https://hn.algolia.com/api/v1/search?tags=front_page"
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      hits?: { title?: string; url?: string; objectID: string }[];
    };
    return (data.hits ?? [])
      .filter((h) => h.title)
      .slice(0, 20)
      .map((h) => ({
        title: h.title!,
        url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      }));
  } catch {
    return [];
  }
}

async function fetchHeadlines(niche: string): Promise<Headline[]> {
  const [news, hn] = await Promise.all([googleNews(niche), hackerNews()]);
  const seen = new Set<string>();
  const all: Headline[] = [];
  for (const h of [...news, ...hn]) {
    const key = h.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(h);
  }
  return all;
}

const TRENDS_TOOL: Anthropic.Tool = {
  name: "emit_trends",
  description:
    "Return the most timely and postable trends for the niche, chosen from the supplied headlines.",
  input_schema: {
    type: "object",
    properties: {
      trends: {
        type: "array",
        items: {
          type: "object",
          properties: {
            topic: { type: "string", description: "Short topic label." },
            summary: { type: "string", description: "One-line summary." },
            whyNow: {
              type: "string",
              description: "Why this is timely right now.",
            },
            sourceUrl: {
              type: "string",
              description: "The source headline URL it came from.",
            },
          },
          required: ["topic", "summary", "whyNow", "sourceUrl"],
        },
      },
    },
    required: ["trends"],
  },
};

/**
 * Returns the top trends for a niche. Pulls free headlines, then has Claude
 * rank and frame them. Returns [] if no headlines could be fetched.
 */
export async function getTrends(
  niche: string,
  opts?: { limit?: number; model?: string }
): Promise<Trend[]> {
  const limit = opts?.limit ?? 6;
  const headlines = await fetchHeadlines(niche);
  if (headlines.length === 0) return [];

  const list = headlines
    .map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}`)
    .join("\n");

  const res = await anthropic.messages.create({
    model: opts?.model || GENERATION_MODEL,
    max_tokens: 1500,
    tools: [TRENDS_TOOL],
    tool_choice: { type: "tool", name: TRENDS_TOOL.name },
    messages: [
      {
        role: "user",
        content:
          `Niche: ${niche}\n\n` +
          `From the headlines below, pick the ${limit} most timely and engaging ` +
          `topics worth posting about for this niche right now. Use the real source ` +
          `URL for each. Skip anything off-topic, dated, or purely promotional.\n\n` +
          `<headlines>\n${list}\n</headlines>`,
      },
    ],
  });

  const block = res.content.find(
    (b): b is Anthropic.ToolUseBlock =>
      b.type === "tool_use" && b.name === TRENDS_TOOL.name
  );
  if (!block) return [];
  const out = block.input as { trends?: Trend[] };
  return (out.trends ?? []).slice(0, limit);
}
