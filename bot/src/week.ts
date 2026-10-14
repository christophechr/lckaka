import { DateTime } from "luxon";

export const PARIS_TIME_ZONE = "Europe/Paris";

export interface WeekRange {
  start: Date;
  endExclusive: Date;
  label: string;
}

export function getParisWeekRange(now: Date): WeekRange {
  const start = DateTime.fromJSDate(now, { zone: PARIS_TIME_ZONE }).startOf("week");
  const endExclusive = start.plus({ weeks: 1 });
  const endInclusive = endExclusive.minus({ days: 1 });

  const startLabel = start.setLocale("fr").toFormat(
    start.month === endInclusive.month ? "d" : "d MMMM",
  );
  const endLabel = endInclusive.setLocale("fr").toFormat("d MMMM yyyy");

  return {
    start: start.toUTC().toJSDate(),
    endExclusive: endExclusive.toUTC().toJSDate(),
    label: `du ${startLabel} au ${endLabel}`,
  };
}
