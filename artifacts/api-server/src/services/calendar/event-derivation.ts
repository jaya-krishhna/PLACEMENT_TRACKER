import { TERMINAL_STATUSES } from "../matcher/application-matcher";
import type { PlacementApplication } from "@workspace/db";

export interface DerivedCalendarEvent {
  id: string;
  applicationId: string;
  title: string;
  kind: "interview" | "assessment" | "screening" | "deadline";
  start: string; // ISO string or YYYY-MM-DD
  end: string | null;
  allDay: boolean;
  dateStr: string; // YYYY-MM-DD in DEFAULT_TIMEZONE
  company: string;
  role: string | null;
  status: string;
  stageDetail: string | null;
  actionRequired: boolean;
  actionNote: string | null;
  source: "manual" | "email";
  summary: string | null;
  isPast: boolean;
  startDate: Date;
  endDate: Date;
}

/**
 * Returns YYYY-MM-DD for a given date in the target timezone
 */
export function getDateStringInTimezone(
  date: Date,
  timeZone: string = process.env.DEFAULT_TIMEZONE || "Asia/Kolkata",
): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/**
 * Given a YYYY-MM-DD date string, returns the exact UTC Date boundaries for that local day in timeZone.
 */
export function getDayBoundariesInTimezone(
  dateStr: string,
  timeZone: string = process.env.DEFAULT_TIMEZONE || "Asia/Kolkata",
): { startOfDay: Date; endOfDay: Date } {
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  
  // Format reference in timezone to get offset
  // We probe with a UTC date for y-m-d 12:00
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const tzParts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  }).formatToParts(probe);

  const partMap: Record<string, number> = {};
  for (const part of tzParts) {
    if (part.type !== "literal") {
      partMap[part.type] = Number(part.value);
    }
  }

  // Calculate timezone offset at that date in minutes: tzTime - probeTime
  const tzAsUtc = Date.UTC(
    partMap.year,
    partMap.month - 1,
    partMap.day,
    partMap.hour,
    partMap.minute,
    partMap.second,
  );
  const offsetMs = tzAsUtc - probe.getTime();

  // startOfDay in local timezone is 00:00:00.000 local = Date.UTC(y, m-1, d, 0, 0, 0) - offsetMs
  const startMs = Date.UTC(y, m - 1, d, 0, 0, 0) - offsetMs;
  const startOfDay = new Date(startMs);
  const endOfDay = new Date(startMs + 24 * 60 * 60 * 1000 - 1);

  return { startOfDay, endOfDay };
}

/**
 * Returns a specific local hour/minute on a date string in the target timezone
 */
export function getTimeOnDateInTimezone(
  dateStr: string,
  hour: number,
  minute: number,
  timeZone: string = process.env.DEFAULT_TIMEZONE || "Asia/Kolkata",
): Date {
  const { startOfDay } = getDayBoundariesInTimezone(dateStr, timeZone);
  return new Date(startOfDay.getTime() + (hour * 60 + minute) * 60 * 1000);
}

/**
 * Map status to event kind:
 * INTERVIEW -> "interview", TEST -> "assessment", SCREENING -> "screening", otherwise -> "deadline"
 */
export function mapStatusToEventKind(
  status: string,
): "interview" | "assessment" | "screening" | "deadline" {
  const s = status.toUpperCase();
  if (s === "INTERVIEW") return "interview";
  if (s === "TEST") return "assessment";
  if (s === "SCREENING") return "screening";
  return "deadline";
}

/**
 * Derives a calendar event from a single PlacementApplication.
 * Returns null if the application is a sample, in terminal status, or has no next date/time.
 */
export function deriveUpcomingEvent(
  app: PlacementApplication,
  latestSummary?: string | null,
  now: Date = new Date(),
  timeZone: string = process.env.DEFAULT_TIMEZONE || "Asia/Kolkata",
): DerivedCalendarEvent | null {
  // Exclude sample applications
  if (app.isSample) return null;

  // Exclude terminal status applications
  if (TERMINAL_STATUSES.has(app.status.toUpperCase() as any)) return null;

  let allDay = false;
  let startDate: Date;
  let endDate: Date;
  let dateStr: string;

  if (app.nextAt) {
    const rawNextAt = new Date(app.nextAt);
    if (Number.isNaN(rawNextAt.getTime())) return null;

    if (app.nextAtHasTime) {
      allDay = false;
      startDate = rawNextAt;
      // Default 1 hour duration
      endDate = new Date(rawNextAt.getTime() + 60 * 60 * 1000);
      dateStr = getDateStringInTimezone(rawNextAt, timeZone);
    } else {
      allDay = true;
      dateStr = getDateStringInTimezone(rawNextAt, timeZone);
      const boundaries = getDayBoundariesInTimezone(dateStr, timeZone);
      startDate = boundaries.startOfDay;
      endDate = boundaries.endOfDay;
    }
  } else if (app.nextDate) {
    allDay = true;
    dateStr = app.nextDate.slice(0, 10);
    const boundaries = getDayBoundariesInTimezone(dateStr, timeZone);
    startDate = boundaries.startOfDay;
    endDate = boundaries.endOfDay;
  } else {
    // No event date set
    return null;
  }

  const kind = mapStatusToEventKind(app.status);

  // Title: uses nextType text when present, else kind label capitalized
  const kindLabels: Record<string, string> = {
    interview: "Interview",
    assessment: "Assessment",
    screening: "Screening",
    deadline: "Deadline",
  };
  const title = (app.nextType && app.nextType.trim()) || kindLabels[kind] || "Deadline";

  // Check if past
  const isPast = allDay
    ? now.getTime() > endDate.getTime()
    : now.getTime() > startDate.getTime();

  return {
    id: `event-${app.id}`,
    applicationId: app.id,
    title,
    kind,
    start: allDay ? dateStr : startDate.toISOString(),
    end: allDay ? null : endDate.toISOString(),
    allDay,
    dateStr,
    company: app.companyName,
    role: app.role || null,
    status: app.status,
    stageDetail: app.stageDetail || null,
    actionRequired: Boolean(app.actionRequired),
    actionNote: app.actionNote || null,
    source: (app.source as "manual" | "email") || "manual",
    summary: latestSummary || null,
    isPast,
    startDate,
    endDate,
  };
}

/**
 * Derives upcoming events for a list of applications.
 */
export function deriveEventsForApplications(
  apps: PlacementApplication[],
  latestSummaries: Record<string, string> = {},
  now: Date = new Date(),
  timeZone: string = process.env.DEFAULT_TIMEZONE || "Asia/Kolkata",
): DerivedCalendarEvent[] {
  const events: DerivedCalendarEvent[] = [];
  for (const app of apps) {
    const event = deriveUpcomingEvent(app, latestSummaries[app.id], now, timeZone);
    if (event) {
      events.push(event);
    }
  }
  return events;
}
