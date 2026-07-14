/**
 * IST (UTC+5:30, no DST) calendar-day math. Timestamps are stored UTC; "today"
 * KPIs (staff summary, admin overview) bucket by the Indian business day.
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Start of the IST calendar day containing `at`, as a UTC instant. */
export function istDayStart(at: Date = new Date()): Date {
  const shifted = new Date(at.getTime() + IST_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - IST_OFFSET_MS);
}

/** IST calendar-day key (`YYYY-MM-DD`) for grouping. */
export function istDayKey(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}
