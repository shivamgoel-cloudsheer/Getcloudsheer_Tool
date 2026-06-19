import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, GENERATION_MODEL } from "./anthropic";
import type { XStoredStyleProfile } from "@/db/schema";

// ---------------------------------------------------------------------------
// Structured-output helper: force a single tool call and return its input.
// Version-stable across SDK releases (no reliance on a parse helper).
// ---------------------------------------------------------------------------
function toolUseInput<T>(res: Anthropic.Message, toolName: string): T {
  const block = res.content.find(
    (b): b is Anthropic.ToolUseBlock =>
      b.type === "tool_use" && b.name === toolName
  );
  if (!block) {
    throw new Error(`Model did not return the expected "${toolName}" tool call.`);
  }
  return block.input as T;
}

// ---------------------------------------------------------------------------
// Build a style profile from a pasted corpus of an author's posts.
// ---------------------------------------------------------------------------
const STYLE_TOOL: Anthropic.Tool = {
  name: "emit_style_profile",
  description:
    "Return the structured writing-style profile distilled from the example posts.",
  input_schema: {
    type: "object",
    properties: {
      voice: {
        type: "string",
        description: "The overall voice and tone in a sentence or two.",
      },
      sentenceStyle: {
        type: "string",
        description: "Sentence length, rhythm, and punctuation habits.",
      },
      emojiUse: { type: "string", description: "Emoji usage: none, sparing, or frequent, and which kinds." },
      hashtagUse: { type: "string", description: "Hashtag usage: none, sparing, or frequent, and which kinds." },
      openingPatterns: {
        type: "array",
        items: { type: "string" },
        description: "How posts typically open or hook the reader.",
      },
      closingPatterns: {
        type: "array",
        items: { type: "string" },
        description: "How posts typically land or close.",
      },
      vocabulary: {
        type: "array",
        items: { type: "string" },
        description: "Characteristic words, phrases, or slang.",
      },
      topics: {
        type: "array",
        items: { type: "string" },
        description: "Recurring subject matter.",
      },
      avoid: {
        type: "array",
        items: { type: "string" },
        description: "Things this voice never does.",
      },
      examplePosts: {
        type: "array",
        items: { type: "string" },
        description: "3-5 of the most representative posts, verbatim, for calibration.",
      },
    },
    required: [
      "voice",
      "sentenceStyle",
      "emojiUse",
      "hashtagUse",
      "openingPatterns",
      "closingPatterns",
      "vocabulary",
      "topics",
      "avoid",
      "examplePosts",
    ],
  },
};

export async function buildStyleProfile(
  corpus: string,
  model: string = GENERATION_MODEL
): Promise<XStoredStyleProfile> {
  const res = await anthropic.messages.create({
    model,
    max_tokens: 2000,
    tools: [STYLE_TOOL],
    tool_choice: { type: "tool", name: STYLE_TOOL.name },
    messages: [
      {
        role: "user",
        content:
          "Analyze the writing style of the following social posts, all from a single author. " +
          "Capture what makes the voice recognizable so it can be reproduced on new topics. " +
          "Do not summarize the content; describe the style.\n\n<posts>\n" +
          corpus.trim() +
          "\n</posts>",
      },
    ],
  });
  return toolUseInput<XStoredStyleProfile>(res, STYLE_TOOL.name);
}

// ---------------------------------------------------------------------------
// Generate one post on a topic, in the profile's voice.
// ---------------------------------------------------------------------------
function styleSystemPrompt(profile: XStoredStyleProfile, niche: string): string {
  return [
    `You write X (Twitter) posts for a Cloudsheer-managed account in a specific author's voice.`,
    `The niche is: ${niche}.`,
    ``,
    `VOICE: ${profile.voice}`,
    `SENTENCE STYLE: ${profile.sentenceStyle}`,
    `EMOJI: ${profile.emojiUse}`,
    `HASHTAGS: ${profile.hashtagUse}`,
    profile.openingPatterns.length
      ? `OPENINGS: ${profile.openingPatterns.join(" | ")}`
      : ``,
    profile.closingPatterns.length
      ? `CLOSINGS: ${profile.closingPatterns.join(" | ")}`
      : ``,
    profile.vocabulary.length
      ? `VOCABULARY: ${profile.vocabulary.join(", ")}`
      : ``,
    profile.avoid.length ? `NEVER DO: ${profile.avoid.join("; ")}` : ``,
    ``,
    `Examples of the voice (match this feel, do not copy them):`,
    ...profile.examplePosts.slice(0, 5).map((p) => `- ${p}`),
    ``,
    `RULES:`,
    `- Output exactly one post, 280 characters or fewer.`,
    `- No preamble, no quotes around the post, no "here's a post" framing.`,
    `- Mimic the STYLE, never the identity. Do not impersonate or name the author.`,
    `- Never use em-dashes. Use a regular hyphen with spaces instead.`,
    `- Sound timely and human, not like an ad.`,
  ]
    .filter(Boolean)
    .join("\n");
}

const POST_TOOL: Anthropic.Tool = {
  name: "emit_post",
  description: "Return exactly one X post, ready to publish.",
  input_schema: {
    type: "object",
    properties: {
      post: {
        type: "string",
        description: "The post text, 280 characters or fewer, no surrounding quotes.",
      },
    },
    required: ["post"],
  },
};

export async function generatePost(args: {
  profile: XStoredStyleProfile;
  topic: string;
  whyNow: string;
  niche: string;
  model?: string;
}): Promise<string> {
  const model = args.model || GENERATION_MODEL;
  const res = await anthropic.messages.create({
    model,
    max_tokens: 400,
    system: [
      {
        type: "text",
        text: styleSystemPrompt(args.profile, args.niche),
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [POST_TOOL],
    tool_choice: { type: "tool", name: POST_TOOL.name },
    messages: [
      {
        role: "user",
        content:
          `Trending topic: ${args.topic}\n` +
          `Why it's timely: ${args.whyNow}\n\n` +
          `Write one post about this topic in the author's voice.`,
      },
    ],
  });
  const { post } = toolUseInput<{ post: string }>(res, POST_TOOL.name);
  return post.trim();
}
