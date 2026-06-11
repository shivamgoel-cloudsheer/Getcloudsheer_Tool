import { zonedTimeToUtc } from "./timezone";

export type StaggerConfig = {
  gapMinutes: number; // average gap between emails (jittered ±25%)
  dailyCap: number; // max emails per calendar day (hard ceiling per sender)
  windowStart: string; // "09:00" - send window in the user's timezone
  windowEnd: string; // "17:00"
  skipWeekends: boolean;
  timeZone: string;
  warmup?: boolean; // ramp a new sender up to the cap over its first weeks
};

export type StaggerOptions = {
  // Sends already committed by this sender, keyed by "YYYY-MM-DD" in cfg's
  // timezone. Lets the daily cap span campaigns (per sender, not per campaign).
  committedByDay?: Map<string, number>;
  // Per-day cap override (e.g. the warm-up ramp). Falls back to cfg.dailyCap.
  capForDay?: (dayKey: string) => number;
};

function partsInZone(t: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(new Date(t));
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hhmm: `${get("hour")}:${get("minute")}`,
    weekday: get("weekday"),
  };
}

function nextDayWindowStart(t: number, cfg: StaggerConfig): number {
  const p = partsInZone(t + 24 * 60 * 60 * 1000, cfg.timeZone);
  return zonedTimeToUtc(p.date, cfg.windowStart, cfg.timeZone)!.getTime();
}

/** Moves a timestamp forward until it falls inside the send window. */
function intoWindow(t: number, cfg: StaggerConfig): number {
  for (let guard = 0; guard < 200; guard++) {
    const p = partsInZone(t, cfg.timeZone);
    if (cfg.skipWeekends && (p.weekday === "Sat" || p.weekday === "Sun")) {
      t = nextDayWindowStart(t, cfg);
      continue;
    }
    if (p.hhmm < cfg.windowStart) {
      t = zonedTimeToUtc(p.date, cfg.windowStart, cfg.timeZone)!.getTime();
      continue;
    }
    if (p.hhmm >= cfg.windowEnd) {
      t = nextDayWindowStart(t, cfg);
      continue;
    }
    return t;
  }
  return t;
}

/**
 * Computes one send time per recipient: jittered gaps so the pattern looks
 * human, clamped to the send window, capped per day, weekends optional.
 *
 * The daily cap counts sends already committed by the same sender (via
 * opts.committedByDay) so two campaigns from one mailbox can't double its
 * daily volume. opts.capForDay supplies a per-day ceiling (the warm-up ramp).
 */
export function computeStaggeredTimes(
  count: number,
  base: Date,
  cfg: StaggerConfig,
  opts: StaggerOptions = {}
): Date[] {
  const times: Date[] = [];
  const capOf = (day: string) => opts.capForDay?.(day) ?? cfg.dailyCap;
  const usedOf = (day: string) => opts.committedByDay?.get(day) ?? 0;
  const gapMs = cfg.gapMinutes * 60_000;

  let t = Math.max(base.getTime(), Date.now() + 5 * 60 * 1000);
  let dayKey = "";
  let sentThisDay = 0;

  for (let i = 0; i < count; i++) {
    t = intoWindow(t, cfg);
    let p = partsInZone(t, cfg.timeZone);
    if (p.date !== dayKey) {
      dayKey = p.date;
      sentThisDay = usedOf(dayKey);
    }
    // Skip forward over any days already at their cap (there can be several
    // in a row once existing commitments and the warm-up ramp are factored in).
    let guard = 0;
    while (sentThisDay >= capOf(dayKey) && guard++ < 400) {
      t = intoWindow(nextDayWindowStart(t, cfg), cfg);
      p = partsInZone(t, cfg.timeZone);
      dayKey = p.date;
      sentThisDay = usedOf(dayKey);
    }
    times.push(new Date(t));
    sentThisDay++;
    // ±25% jitter so gaps aren't perfectly uniform
    t += gapMs * (0.75 + Math.random() * 0.5);
  }

  return times;
}
