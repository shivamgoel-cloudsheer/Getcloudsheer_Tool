/**
 * Lightweight deliverability linter for cold outreach. Pure and dependency-free
 * so it can run both in the browser (live as you compose) and on the server (at
 * campaign creation). These are warnings, never hard errors.
 */
export type LintWarning = {
  field: "subject" | "body";
  message: string;
};

const SHORTENER_DOMAINS = [
  "bit.ly",
  "t.co",
  "tinyurl.com",
  "goo.gl",
  "ow.ly",
  "buff.ly",
  "is.gd",
  "rebrand.ly",
  "cutt.ly",
  "rb.gy",
  "shorturl.at",
  "lnkd.in",
];

// Words/phrases that commonly trip spam filters in cold email.
const SPAM_PHRASES = [
  "free",
  "guarantee",
  "guaranteed",
  "act now",
  "limited time",
  "click here",
  "buy now",
  "order now",
  "cash",
  "winner",
  "congratulations",
  "100%",
  "risk free",
  "no obligation",
  "earn money",
  "make money",
  "cheap",
  "discount",
  "offer expires",
  "urgent",
  "double your",
];

function countLinks(text: string): number {
  const anchors = (text.match(/<a\b[^>]*href=/gi) ?? []).length;
  // Bare URLs not already inside an href
  const bareUrls = (text.match(/\bhttps?:\/\/[^\s"'<>]+/gi) ?? []).length;
  // An <a href="http..."> counts the URL twice; take the larger signal.
  return Math.max(anchors, bareUrls);
}

function hasShortener(text: string): boolean {
  const lower = text.toLowerCase();
  return SHORTENER_DOMAINS.some((d) => lower.includes(d));
}

function spamHits(text: string): string[] {
  const lower = text.toLowerCase();
  return SPAM_PHRASES.filter((p) => {
    const re = new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    return re.test(lower);
  });
}

function longestCapsRun(text: string): number {
  let max = 0;
  for (const word of text.split(/\s+/)) {
    const letters = word.replace(/[^A-Za-z]/g, "");
    if (letters.length >= 3 && letters === letters.toUpperCase()) {
      max = Math.max(max, letters.length);
    }
  }
  return max;
}

export function lintContent(input: {
  subject: string;
  body: string;
}): LintWarning[] {
  const warnings: LintWarning[] = [];
  const subject = input.subject ?? "";
  const body = input.body ?? "";

  // --- Subject checks ---
  if (subject.length > 60) {
    warnings.push({
      field: "subject",
      message: `Subject is ${subject.length} characters; keep it under ~60 so it isn't truncated.`,
    });
  }
  if (longestCapsRun(subject) >= 4) {
    warnings.push({
      field: "subject",
      message: "Subject has ALL-CAPS words, which reads as spammy.",
    });
  }
  if (/(!|\?){2,}/.test(subject) || (subject.match(/[!?]/g)?.length ?? 0) > 1) {
    warnings.push({
      field: "subject",
      message: "Excessive punctuation in the subject (!! / ??) hurts deliverability.",
    });
  }
  for (const phrase of spamHits(subject)) {
    warnings.push({
      field: "subject",
      message: `Subject contains a spam-trigger word: "${phrase}".`,
    });
  }

  // --- Body checks ---
  if (/<img\b/i.test(body)) {
    warnings.push({
      field: "body",
      message: "Body contains an image. Cold emails land better as plain text.",
    });
  }
  if (/<table\b/i.test(body)) {
    warnings.push({
      field: "body",
      message: "Body contains an HTML table. Heavy HTML looks like a marketing blast.",
    });
  }
  if (/<button\b/i.test(body) || /style=["'][^"']*background/i.test(body)) {
    warnings.push({
      field: "body",
      message: "Body contains a styled button. A plain text link reads as more personal.",
    });
  }
  const links = countLinks(body);
  if (links > 2) {
    warnings.push({
      field: "body",
      message: `Body has ${links} links. Cold emails should have at most 1-2.`,
    });
  }
  if (hasShortener(body)) {
    warnings.push({
      field: "body",
      message: "Body uses a link shortener (bit.ly, etc.), a strong spam signal.",
    });
  }
  for (const phrase of spamHits(body)) {
    warnings.push({
      field: "body",
      message: `Body contains a spam-trigger word: "${phrase}".`,
    });
  }

  return warnings;
}
