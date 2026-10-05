/**
 * Date helpers.
 *
 * Everything is stored as TIMESTAMPTZ in UTC, but the business operates in a
 * fixed business timezone (Africa/Lagos, UTC+1, no DST). Daily reports are keyed
 * by a bare DATE, so converting a `reportDate` into a UTC window needs an
 * explicit, tested day-boundary rule (docs/08 §72, docs/03 §57).
 */

const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const isBareDate = (value: string): boolean => BARE_DATE.test(value.trim());

/** Offset of `timeZone` from UTC, in milliseconds, at the given instant. */
export function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts = formatter.formatToParts(instant);
  const lookup = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  // `hour` can come back as 24 at midnight in some ICU versions.
  const hour = lookup('hour') % 24;

  const asUtc = Date.UTC(
    lookup('year'),
    lookup('month') - 1,
    lookup('day'),
    hour,
    lookup('minute'),
    lookup('second'),
  );

  return asUtc - instant.getTime();
}

/** Start of the given calendar day in `timeZone`, expressed in UTC. */
export function startOfDayInTimeZone(dateOnly: string, timeZone: string): Date {
  const [year, month, day] = dateOnly.split('-').map(Number);
  // First guess: treat midnight as if it were UTC, then correct by the offset.
  let instant = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const offset = timeZoneOffsetMs(instant, timeZone);
    const corrected = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0) - offset);
    if (corrected.getTime() === instant.getTime()) break;
    instant = corrected;
  }
  return instant;
}

/** Exclusive end of the given calendar day in `timeZone`, expressed in UTC. */
export function endOfDayInTimeZone(dateOnly: string, timeZone: string): Date {
  return new Date(startOfDayInTimeZone(dateOnly, timeZone).getTime() + 24 * 60 * 60 * 1000);
}

/** `YYYY-MM-DD` for an instant, rendered in the business timezone. */
export function toDateOnlyInTimeZone(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
  return parts;
}

export interface DateRange {
  start: Date;
  end: Date;
}

/**
 * Resolves `from`/`to` query parameters into an inclusive UTC window.
 *
 * A bare date means that whole business day. An explicit datetime is used as
 * given, with `to` extended to the end of its day when it was a bare date so
 * that `?from=2026-10-01&to=2026-10-31` includes all of the 31st (docs/04 §91).
 */
export function resolveDateRange(
  from: string | undefined,
  to: string | undefined,
  timeZone: string,
): DateRange | undefined {
  if (!from && !to) return undefined;

  const start =
    from === undefined
      ? new Date(0)
      : isBareDate(from)
        ? startOfDayInTimeZone(from, timeZone)
        : new Date(from);

  const end =
    to === undefined
      ? new Date(8640000000000000)
      : isBareDate(to)
        ? endOfDayInTimeZone(to, timeZone)
        : new Date(to);

  return { start, end };
}
