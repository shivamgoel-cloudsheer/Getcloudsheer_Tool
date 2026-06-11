/**
 * Per-sender warm-up ramp. A brand-new sending address should not jump
 * straight to the full daily cap; it ramps up gradually to build reputation.
 *
 * Schedule: 10/day for the first 3 days, then +25% every 3 days, never
 * exceeding the campaign's configured daily cap. After WARMUP_WINDOW_DAYS of
 * sending history the address is considered warm and the ramp no longer
 * applies.
 */
export const WARMUP_BASE = 10;
export const WARMUP_STEP_DAYS = 3;
export const WARMUP_GROWTH = 1.25;
export const WARMUP_WINDOW_DAYS = 30;

/** Allowed sends on a given day of the ramp (0-based), clamped to the cap. */
export function warmupCapForDayIndex(dayIndex: number, ceiling: number): number {
  const idx = Math.max(0, dayIndex);
  const steps = Math.floor(idx / WARMUP_STEP_DAYS);
  const cap = Math.floor(WARMUP_BASE * Math.pow(WARMUP_GROWTH, steps));
  return Math.max(1, Math.min(cap, ceiling));
}

/** Whole-day difference between two "YYYY-MM-DD" calendar dates (a - b). */
export function dayDiff(dayA: string, dayB: string): number {
  const [ya, ma, da] = dayA.split("-").map(Number);
  const [yb, mb, db] = dayB.split("-").map(Number);
  const a = Date.UTC(ya, ma - 1, da);
  const b = Date.UTC(yb, mb - 1, db);
  return Math.round((a - b) / (24 * 60 * 60 * 1000));
}

/**
 * Builds a per-day cap function for the stagger allocator.
 *
 * @param ceiling     the campaign's configured daily cap (hard ceiling)
 * @param warmup      whether warm-up is enabled for this sender
 * @param startDayKey the sender's first-send calendar day ("YYYY-MM-DD"), or
 *                    the current day if the sender has never sent
 * @param warm        true if the sender is already past the warm-up window
 */
export function capForDayFn(
  ceiling: number,
  warmup: boolean,
  startDayKey: string,
  warm: boolean
): (dayKey: string) => number {
  if (!warmup || warm) return () => ceiling;
  return (dayKey: string) =>
    warmupCapForDayIndex(dayDiff(dayKey, startDayKey), ceiling);
}
