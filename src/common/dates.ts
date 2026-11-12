// en-CA formats as YYYY-MM-DD, so dates compare as plain strings.
const lagosDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Lagos',
});

/** The Africa/Lagos calendar date of an instant, as YYYY-MM-DD. */
export function lagosDay(instant: Date): string {
  return lagosDate.format(instant);
}

export function lagosToday(now: Date = new Date()): string {
  return lagosDay(now);
}

export function addDays(date: string, days: number): string {
  const day = toDateColumn(date);
  day.setUTCDate(day.getUTCDate() + days);
  return fromDateColumn(day);
}

/** A YYYY-MM-DD string as the UTC midnight a @db.Date column stores. */
export function toDateColumn(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

// A @db.Date column comes back as UTC midnight; the calendar date is its ISO prefix.
export function fromDateColumn(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Lagos is UTC+1 all year, so a WAT day starts at 23:00 UTC the day before.
const LAGOS_OFFSET_HOURS = 1;

/** The instant a YYYY-MM-DD calendar day starts in Africa/Lagos. */
export function lagosDayStart(date: string): Date {
  const start = toDateColumn(date);
  start.setUTCHours(-LAGOS_OFFSET_HOURS);
  return start;
}
