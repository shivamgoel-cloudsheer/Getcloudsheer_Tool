// Shared cold-email metric definitions, used by the analytics UI and the
// overview/insights endpoints so the funnel and rates mean the same thing
// everywhere. Pure functions only - safe to import from client or server.

// Statuses that mean "we actually emailed this person". Includes the Resend-era
// delivered/opened/clicked so historical rows still count as reached.
export const REACHED_STATUSES = [
  "sent",
  "delivered",
  "opened",
  "clicked",
  "replied",
  "bounced",
] as const;

// Reply intents that count as a positive outcome. "positive" is a legacy tag
// kept so rows classified before the taxonomy change still count.
export const POSITIVE_CATEGORIES = ["interested", "meeting", "positive"] as const;

export const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

export type MetricInput = {
  recipients: number;
  byStatus: Record<string, number>;
  byCategory: Record<string, number>;
};

export type Metrics = {
  recipients: number;
  reached: number; // actually emailed
  delivered: number; // reached minus bounced (landed without bouncing)
  bounced: number;
  replied: number;
  positive: number; // interested + meeting
  meetings: number;
  notInterested: number;
  unsubscribed: number;
  outOfOffice: number;
  later: number;
  wrongPerson: number;
  neutral: number;
  queued: number;
  suppressed: number;
  failed: number;
  // Rates as whole-number percentages.
  replyRate: number; // replied / delivered
  positiveRate: number; // positive / delivered
  meetingRate: number; // meetings / delivered
  bounceRate: number; // bounced / reached
};

export function computeMetrics(input: MetricInput): Metrics {
  const s = input.byStatus;
  const c = input.byCategory;
  const g = (o: Record<string, number>, k: string) => o[k] ?? 0;

  const bounced = g(s, "bounced") + g(s, "complained");
  const reached = REACHED_STATUSES.reduce((sum, k) => sum + g(s, k), 0);
  const delivered = Math.max(reached - bounced, 0);
  const replied = g(s, "replied");
  const positive = POSITIVE_CATEGORIES.reduce((sum, k) => sum + g(c, k), 0);
  const meetings = g(c, "meeting");

  return {
    recipients: input.recipients,
    reached,
    delivered,
    bounced,
    replied,
    positive,
    meetings,
    notInterested: g(c, "not_interested") + g(c, "negative"),
    unsubscribed: g(c, "unsubscribe"),
    outOfOffice: g(c, "out_of_office"),
    later: g(c, "later"),
    wrongPerson: g(c, "wrong_person"),
    neutral: g(c, "neutral"),
    queued: g(s, "scheduled") + g(s, "pending"),
    suppressed: g(s, "suppressed"),
    failed: g(s, "failed"),
    replyRate: pct(replied, delivered),
    positiveRate: pct(positive, delivered),
    meetingRate: pct(meetings, delivered),
    bounceRate: pct(bounced, reached),
  };
}
