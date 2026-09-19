/**
 * Public Discover date range display for tourism event occurrences.
 * Short: Nov 5–6
 * Long same year: May 1 – Jun 30
 * Cross-year: Dec 28 – Jan 5
 */
const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export function formatTourismEventDateRange(
  startsAt: string | Date,
  endsAt: string | Date,
): string {
  const start = startsAt instanceof Date ? startsAt : new Date(startsAt);
  const end = endsAt instanceof Date ? endsAt : new Date(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return '';
  }

  const startMonth = MONTH_SHORT[start.getUTCMonth()]!;
  const endMonth = MONTH_SHORT[end.getUTCMonth()]!;
  const startDay = start.getUTCDate();
  const endDay = end.getUTCDate();
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const sameMonth = sameYear && start.getUTCMonth() === end.getUTCMonth();
  const durationDays =
    (Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()) -
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())) /
    86_400_000;

  if (sameMonth) {
    if (startDay === endDay) {
      return `${startMonth} ${startDay}`;
    }
    // Short multi-day within one month: Nov 5–6
    if (durationDays <= 3) {
      return `${startMonth} ${startDay}–${endDay}`;
    }
    return `${startMonth} ${startDay} – ${endMonth} ${endDay}`;
  }

  if (!sameYear) {
    return `${startMonth} ${startDay} – ${endMonth} ${endDay}`;
  }

  return `${startMonth} ${startDay} – ${endMonth} ${endDay}`;
}
