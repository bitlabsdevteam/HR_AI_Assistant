/**
 * Bundled company profile and the types that describe it.
 *
 * The live profile is read from KV (`profile/current`). `DEFAULT_PROFILE` below is the
 * non-sensitive fallback used when KV is missing, unreadable, or fails validation.
 * Keep the types here in step with `companyProfileSchema` in `../domain/profile.ts`.
 */

/** Topics the `get_leave_policy` tool can answer. Each one has a text entry in `CompanyProfile.policy`. */
export const POLICY_TOPICS = [
  "entitlement",
  "notice",
  "carry_over",
  "holidays",
  "process",
  "hours",
] as const;

/** One of the topics in `POLICY_TOPICS`. */
export type PolicyTopic = (typeof POLICY_TOPICS)[number];

/** Lowercase weekday names, Monday first. These are the keys of `CompanyProfile.hours`. */
export const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

/** One of the names in `WEEKDAYS`. */
export type Weekday = (typeof WEEKDAYS)[number];

/** Opening and closing time for one day, as 24-hour `HH:MM` strings in the company time zone. */
export interface OfficeHours {
  open: string;
  close: string;
}

/** The company settings and policy text the assistant relies on. */
export interface CompanyProfile {
  /** Name spoken to the caller. */
  companyName: string;
  /** IANA time zone used for "today" and for office hours. */
  timezone: string;
  /** Annual leave days per employee for the leave year. */
  entitlementDays: number;
  /** Office hours per weekday; `null` means the HR desk is closed that day. */
  hours: Record<Weekday, OfficeHours | null>;
  /** First and last day of the leave year (ISO `YYYY-MM-DD`, both inclusive). */
  leaveYear: { start: string; end: string };
  /** Company holidays (ISO dates) that do not count as working days. */
  holidays: string[];
  /** Minimum calendar days between today and the first day of leave. */
  minNoticeDays: number;
  /** Most working days one leave request may contain. */
  maxRequestDays: number;
  /** Spoken answer for each policy topic. */
  policy: Record<PolicyTopic, string>;
}

/**
 * Fallback profile for the fictional Cedar Group. Used whenever KV cannot supply a valid
 * profile; callers see `kv: "fallback"` in the logs. The numbers and dates in `policy`
 * are written out by hand, so update them together with the structured fields above.
 */
export const DEFAULT_PROFILE: CompanyProfile = {
  companyName: "Cedar Group",
  timezone: "America/New_York",
  entitlementDays: 14,
  hours: {
    monday: { open: "09:00", close: "17:00" },
    tuesday: { open: "09:00", close: "17:00" },
    wednesday: { open: "09:00", close: "17:00" },
    thursday: { open: "09:00", close: "17:00" },
    friday: { open: "09:00", close: "17:00" },
    saturday: null,
    sunday: null,
  },
  leaveYear: { start: "2026-07-01", end: "2027-06-30" },
  holidays: ["2026-11-26", "2026-12-25", "2027-01-01"],
  minNoticeDays: 1,
  maxRequestDays: 10,
  policy: {
    entitlement:
      "Full-time employees receive 14 days of annual leave for the leave year from July 1, 2026 through June 30, 2027.",
    notice:
      "Ask for annual leave at least one calendar day before the first day of leave. A request may contain up to 10 working days.",
    carry_over:
      "This phone service handles annual leave for the current leave year only. Please ask the HR team about carry-over.",
    holidays:
      "Annual leave counts Monday through Friday, excluding November 26, 2026, December 25, 2026, and January 1, 2027.",
    process:
      "After signing in, give the first and last day of your leave. The assistant reads the request back and asks for a clear yes before applying. Annual leave within your balance is approved immediately.",
    hours:
      "The Cedar Group HR desk is open Monday through Friday, from 9 AM to 5 PM Eastern Time.",
  },
};
