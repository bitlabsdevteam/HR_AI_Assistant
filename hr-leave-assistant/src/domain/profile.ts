import { z } from "zod";
import {
  POLICY_TOPICS,
  WEEKDAYS,
  type CompanyProfile,
  type PolicyTopic,
} from "../config/default-profile";
import { isIsoCalendarDate } from "./time";

/** Zod schema for a valid ISO-8601 calendar date string. */
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isIsoCalendarDate, "Invalid calendar date");

/** Zod schema for a 24-hour clock time string (HH:MM). */
const timeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);

/** Zod schema for a single day's office hours (open and close times). */
const officeHoursSchema = z.object({ open: timeSchema, close: timeSchema }).strict();

/** Zod schema for the weekly office-hours map. Each weekday is nullable. */
const hoursSchema = z.object({
  monday: officeHoursSchema.nullable(),
  tuesday: officeHoursSchema.nullable(),
  wednesday: officeHoursSchema.nullable(),
  thursday: officeHoursSchema.nullable(),
  friday: officeHoursSchema.nullable(),
  saturday: officeHoursSchema.nullable(),
  sunday: officeHoursSchema.nullable(),
}).strict();

/** Zod schema for the policy text object, with one entry per topic. */
const policySchema = z.object({
  entitlement: z.string().min(1).max(2_000),
  notice: z.string().min(1).max(2_000),
  carry_over: z.string().min(1).max(2_000),
  holidays: z.string().min(1).max(2_000),
  process: z.string().min(1).max(2_000),
  hours: z.string().min(1).max(2_000),
}).strict();

/** Zod schema for the full company profile. */
export const companyProfileSchema = z.object({
  companyName: z.string().min(1).max(80),
  timezone: z.string().min(1).max(80),
  entitlementDays: z.number().int().min(1).max(366),
  hours: hoursSchema,
  leaveYear: z.object({ start: isoDateSchema, end: isoDateSchema }).strict(),
  holidays: z.array(isoDateSchema).max(100),
  minNoticeDays: z.number().int().min(0).max(365),
  maxRequestDays: z.number().int().min(1).max(366),
  policy: policySchema,
}).strict();

/** Zod enum schema for valid policy topics. */
export const policyTopicSchema = z.enum(POLICY_TOPICS);

/**
 * Parses and validates an unknown value into a `CompanyProfile`.
 * Accepts either a JSON string or an object. Returns `null` if validation fails,
 * the leave year is inverted, office hours are invalid, or the time zone is unknown.
 *
 * @param value - Unknown value to parse.
 * @returns A valid `CompanyProfile`, or `null` if invalid.
 */
export function parseCompanyProfile(value: unknown): CompanyProfile | null {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }

  const result = companyProfileSchema.safeParse(value);
  if (!result.success || result.data.leaveYear.start > result.data.leaveYear.end) {
    return null;
  }

  // Validate that open time is strictly before close time for each weekday.
  for (const weekday of WEEKDAYS) {
    const hours = result.data.hours[weekday];
    if (hours && hours.open >= hours.close) {
      return null;
    }
  }

  // Validate that the time zone is recognized by the runtime.
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: result.data.timezone }).format();
  } catch {
    return null;
  }

  return result.data;
}

/**
 * Returns the policy text for a specific topic from the company profile.
 *
 * @param profile - The company profile.
 * @param topic - The policy topic to look up.
 * @returns The human-readable policy text.
 */
export function policyAnswer(profile: CompanyProfile, topic: PolicyTopic): string {
  return profile.policy[topic];
}
