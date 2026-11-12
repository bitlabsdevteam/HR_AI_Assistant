import type { CompanyProfile, Weekday } from "../config/default-profile";

/** Regular expression for validating ISO-8601 calendar dates (YYYY-MM-DD). */
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Mapping from short weekday abbreviations (as produced by Intl.DateTimeFormat)
 * to the full lowercase weekday names used in the codebase.
 */
const SHORT_WEEKDAYS: Record<string, Weekday> = {
  Mon: "monday",
  Tue: "tuesday",
  Wed: "wednesday",
  Thu: "thursday",
  Fri: "friday",
  Sat: "saturday",
  Sun: "sunday",
};

/**
 * Parses an ISO-8601 date string into a UTC Date object.
 * Returns `null` if the string is malformed or represents a non-existent date
 * (e.g. February 30th).
 *
 * @param isoDate - Date string in YYYY-MM-DD format.
 * @returns A UTC Date, or `null` if invalid.
 */
function utcDateFor(isoDate: string): Date | null {
  const match = ISO_DATE_PATTERN.exec(isoDate);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  // Defensive check: reject overflow dates like 2026-02-29.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

/**
 * Formats a UTC Date object back into an ISO-8601 calendar date string.
 *
 * @param date - A Date assumed to be in UTC.
 * @returns String in YYYY-MM-DD format.
 */
function toIsoDate(date: Date): string {
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

/**
 * Extracts a required part from an Intl.DateTimeFormat parts array.
 * Throws if the requested part type is missing.
 *
 * @param parts - Array returned by `formatToParts()`.
 * @param type - The part type to look for (e.g. "year", "month", "day").
 * @returns The string value of that part.
 * @throws Error if the part is not found.
 */
function requiredPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  const value = parts.find((part) => part.type === type)?.value;
  if (value === undefined) {
    throw new Error(`Missing date-time part: ${type}`);
  }
  return value;
}

/**
 * Checks whether a string is a valid ISO-8601 calendar date.
 *
 * @param value - The string to test.
 * @returns `true` if the string is a real calendar date.
 */
export function isIsoCalendarDate(value: string): boolean {
  return utcDateFor(value) !== null;
}

/**
 * Adds a number of days to an ISO-8601 date, returning a new ISO-8601 date.
 *
 * @param isoDate - Starting date in YYYY-MM-DD format.
 * @param amount - Number of days to add (can be negative).
 * @returns The resulting date string.
 * @throws Error if the input date or amount is invalid.
 */
export function addDays(isoDate: string, amount: number): string {
  const date = utcDateFor(isoDate);
  if (!date || !Number.isInteger(amount)) {
    throw new Error("Invalid calendar date or day increment");
  }
  date.setUTCDate(date.getUTCDate() + amount);
  return toIsoDate(date);
}

/**
 * Compares two ISO-8601 date strings.
 *
 * @param left - First date string.
 * @param right - Second date string.
 * @returns `-1` if left < right, `1` if left > right, `0` if equal.
 */
export function compareIsoDates(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Returns today's date as an ISO-8601 string in the given time zone.
 *
 * @param now - A Date object representing the current instant.
 * @param timeZone - An IANA time zone name (e.g. "America/New_York").
 * @returns Today's date in YYYY-MM-DD format relative to that zone.
 */
export function todayIsoInTimeZone(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  return `${requiredPart(parts, "year")}-${requiredPart(parts, "month")}-${requiredPart(parts, "day")}`;
}

/**
 * Returns a human-readable spoken form of today's date in the given time zone.
 *
 * @param now - A Date object representing the current instant.
 * @param timeZone - An IANA time zone name.
 * @returns Spoken date like "Thursday, November 12".
 */
export function todaySpokenInTimeZone(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(now);
}

/**
 * Converts an ISO-8601 date into a spoken, long-form English date string.
 *
 * @param isoDate - Date string in YYYY-MM-DD format.
 * @returns Spoken date like "Thursday, November 12".
 * @throws Error if the date is invalid.
 */
export function spokenIsoDate(isoDate: string): string {
  const date = utcDateFor(isoDate);
  if (!date) {
    throw new Error("Invalid calendar date");
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(date);
}

/**
 * Determines whether the HR desk is currently open based on the company profile.
 *
 * @param now - The current instant.
 * @param profile - Company profile containing office hours and time zone.
 * @returns `true` if the current time falls within office hours for that weekday.
 */
export function isOpenNow(now: Date, profile: CompanyProfile): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: profile.timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);

  const weekday = SHORT_WEEKDAYS[requiredPart(parts, "weekday")];
  if (!weekday) {
    throw new Error("Unrecognized weekday");
  }

  const hours = profile.hours[weekday];
  if (!hours) {
    return false;
  }

  const hour = Number(requiredPart(parts, "hour"));
  const minute = Number(requiredPart(parts, "minute"));
  const currentMinutes = hour * 60 + minute;
  const [openHour = 0, openMinute = 0] = hours.open.split(":").map(Number);
  const [closeHour = 0, closeMinute = 0] = hours.close.split(":").map(Number);

  return (
    currentMinutes >= openHour * 60 + openMinute &&
    currentMinutes < closeHour * 60 + closeMinute
  );
}
