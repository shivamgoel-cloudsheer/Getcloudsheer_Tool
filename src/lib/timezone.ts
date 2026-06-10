export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Converts a wall-clock date + time in a given IANA timezone to a UTC Date,
 * using Intl only (no timezone library). Iterates to converge across DST.
 */
export function zonedTimeToUtc(
  date: string, // "2026-06-15"
  time: string, // "09:00"
  timeZone: string
): Date | null {
  if (!isValidTimeZone(timeZone)) return null;

  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  if ([y, m, d, hh, mm].some((n) => Number.isNaN(n))) return null;

  const desired = Date.UTC(y, m - 1, d, hh, mm);
  let utc = desired;

  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  for (let i = 0; i < 4; i++) {
    const parts = fmt.formatToParts(new Date(utc));
    const get = (type: string) =>
      Number(parts.find((p) => p.type === type)?.value ?? NaN);
    const shown = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute")
    );
    const diff = desired - shown;
    if (diff === 0) break;
    utc += diff;
  }

  return new Date(utc);
}

const TZ_HEADER_CANDIDATES = ["timezone", "time zone", "tz"];

export function findTimezoneColumn(headers: string[]): string | null {
  for (const candidate of TZ_HEADER_CANDIDATES) {
    const hit = headers.find((h) => h.trim().toLowerCase() === candidate);
    if (hit) return hit;
  }
  return null;
}
