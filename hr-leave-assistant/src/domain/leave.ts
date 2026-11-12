import type { CompanyProfile } from "../config/default-profile";
import { addDays, compareIsoDates, isIsoCalendarDate } from "./time";

/** Possible error codes when leave date validation fails. */
export type LeaveRuleFailureCode = "invalid_input" | "out_of_policy";

/** Result of validating leave dates: either success with a day count, or failure with a reason. */
export type LeaveDateValidation =
  | { ok: true; workingDays: number }
  | { ok: false; code: LeaveRuleFailureCode; message: string };

/**
 * Determines whether a given ISO date is a working day.
 * A working day is Monday–Friday that is not a company holiday.
 *
 * @param isoDate - Date string in YYYY-MM-DD format.
 * @param holidays - Set of holiday date strings.
 * @returns `true` if the date is a working day.
 */
export function isWorkingDay(isoDate: string, holidays: ReadonlySet<string>): boolean {
  if (!isIsoCalendarDate(isoDate)) {
    return false;
  }

  const weekday = new Date(`${isoDate}T00:00:00.000Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !holidays.has(isoDate);
}

/**
 * Counts the number of working days inclusive between two ISO dates.
 *
 * @param startDate - Start of the range (inclusive).
 * @param endDate - End of the range (inclusive).
 * @param holidays - Array of holiday date strings.
 * @returns Number of working days in the range, or `0` if inputs are invalid.
 */
export function workingDaysInclusive(
  startDate: string,
  endDate: string,
  holidays: readonly string[],
): number {
  if (
    !isIsoCalendarDate(startDate) ||
    !isIsoCalendarDate(endDate) ||
    compareIsoDates(startDate, endDate) > 0
  ) {
    return 0;
  }

  const holidaySet = new Set(holidays);
  let count = 0;
  let current = startDate;

  while (compareIsoDates(current, endDate) <= 0) {
    if (isWorkingDay(current, holidaySet)) {
      count += 1;
    }
    current = addDays(current, 1);
  }

  return count;
}

/**
 * Checks whether two closed date ranges overlap.
 * Shared endpoints count as overlap.
 *
 * @param leftStart - Start of the first range.
 * @param leftEnd - End of the first range.
 * @param rightStart - Start of the second range.
 * @param rightEnd - End of the second range.
 * @returns `true` if the ranges overlap or touch.
 */
export function closedRangesOverlap(
  leftStart: string,
  leftEnd: string,
  rightStart: string,
  rightEnd: string,
): boolean {
  return leftStart <= rightEnd && rightStart <= leftEnd;
}

/**
 * Validates a leave request against company policy:
 * - Dates must be real and in order.
 * - Dates must fall within the leave year.
 * - Minimum notice period must be respected.
 * - The range must contain at least one working day.
 * - The range must not exceed the max request length.
 *
 * @param input - Object containing startDate, endDate, todayIso, and company profile.
 * @returns Validation result with working day count on success, or error details on failure.
 */
export function validateLeaveDates(input: {
  startDate: string;
  endDate: string;
  todayIso: string;
  profile: CompanyProfile;
}): LeaveDateValidation {
  const { startDate, endDate, todayIso, profile } = input;

  if (!isIsoCalendarDate(startDate) || !isIsoCalendarDate(endDate)) {
    return {
      ok: false,
      code: "invalid_input",
      message: "Use real calendar dates in year, month, day format.",
    };
  }

  if (compareIsoDates(startDate, endDate) > 0) {
    return {
      ok: false,
      code: "invalid_input",
      message: "The first day of leave must be on or before the last day.",
    };
  }

  if (
    compareIsoDates(startDate, profile.leaveYear.start) < 0 ||
    compareIsoDates(endDate, profile.leaveYear.end) > 0
  ) {
    return {
      ok: false,
      code: "out_of_policy",
      message: `Choose dates inside the leave year from ${profile.leaveYear.start} through ${profile.leaveYear.end}.`,
    };
  }

  const earliestStart = addDays(todayIso, profile.minNoticeDays);
  if (compareIsoDates(startDate, earliestStart) < 0) {
    return {
      ok: false,
      code: "out_of_policy",
      message: `The first day must be on or after ${earliestStart}.`,
    };
  }

  const workingDays = workingDaysInclusive(startDate, endDate, profile.holidays);
  if (workingDays === 0) {
    return {
      ok: false,
      code: "out_of_policy",
      message: "The requested range must include at least one working day.",
    };
  }

  if (workingDays > profile.maxRequestDays) {
    return {
      ok: false,
      code: "out_of_policy",
      message: `A request can contain at most ${profile.maxRequestDays} working days.`,
    };
  }

  return { ok: true, workingDays };
}
