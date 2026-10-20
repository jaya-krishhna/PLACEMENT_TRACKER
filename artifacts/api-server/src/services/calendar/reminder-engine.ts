import crypto from "node:crypto";
import type { PlacementApplication } from "@workspace/db";
import { TERMINAL_STATUSES } from "../matcher/application-matcher";
import {
  deriveUpcomingEvent,
  getDateStringInTimezone,
  getTimeOnDateInTimezone,
  type DerivedCalendarEvent,
} from "./event-derivation";

export interface ReminderItem {
  key: string;
  kind: "day_before" | "two_hours" | "morning_of" | "action_required" | "digest";
  severity: "urgent" | "soon" | "info";
  title: string;
  body: string;
  eventAt: string | null;
  hasTime: boolean;
  dueAt: string;
  applicationId: string | null;
  company: string | null;
  role: string | null;
  status: string | null;
}

export interface ComputeRemindersOptions {
  applications: PlacementApplication[];
  latestSummaries?: Record<string, string>;
  dismissedKeys?: Set<string> | string[];
  now: Date;
  timezone?: string;
}

const SEVERITY_ORDER: Record<string, number> = {
  urgent: 0,
  soon: 1,
  info: 2,
};

function formatEventTime(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date);
  } catch {
    return date.toISOString().slice(11, 16);
  }
}

function hashString(val: string): string {
  return crypto.createHash("sha256").update(val).digest("hex").slice(0, 10);
}

/**
 * Pure function to compute all active reminders for a user's applications.
 */
export function computeReminders(opts: ComputeRemindersOptions): {
  items: ReminderItem[];
  count: number;
  now: string;
} {
  const {
    applications,
    latestSummaries = {},
    dismissedKeys = new Set(),
    now,
    timezone = process.env.DEFAULT_TIMEZONE || "Asia/Kolkata",
  } = opts;

  const dismissedSet =
    dismissedKeys instanceof Set ? dismissedKeys : new Set(dismissedKeys);

  const activeReminders: ReminderItem[] = [];
  const todayStr = getDateStringInTimezone(now, timezone);

  // Group events by day to build digest
  const eventsToday: DerivedCalendarEvent[] = [];

  for (const app of applications) {
    // Non-sample and non-terminal check
    if (app.isSample) continue;
    if (TERMINAL_STATUSES.has(app.status.toUpperCase() as any)) continue;

    // 1. Check upcoming event reminders
    const event = deriveUpcomingEvent(app, latestSummaries[app.id], now, timezone);

    if (event) {
      if (event.dateStr === todayStr) {
        eventsToday.push(event);
      }

      // Check if event has passed
      const eventPassed = event.allDay
        ? now.getTime() > event.endDate.getTime()
        : now.getTime() >= event.startDate.getTime();

      if (!eventPassed) {
        // Collect candidate reminders for this event
        const candidateReminders: ReminderItem[] = [];

        if (event.allDay) {
          // All-day: "day_before" triggers at 09:00 timezone on previous day
          const [y, m, d] = event.dateStr.split("-").map(Number);
          const prevDate = new Date(Date.UTC(y, m - 1, d - 1, 12, 0, 0));
          const prevDateStr = getDateStringInTimezone(prevDate, timezone);
          const dayBeforeTrigger = getTimeOnDateInTimezone(prevDateStr, 9, 0, timezone);

          // All-day: "morning_of" triggers at 08:00 timezone on event day
          const morningOfTrigger = getTimeOnDateInTimezone(event.dateStr, 8, 0, timezone);

          // Morning of reminder
          if (now.getTime() >= morningOfTrigger.getTime() && now.getTime() <= event.endDate.getTime()) {
            const key = `rem-${app.id}-${event.start}-morning_of`;
            candidateReminders.push({
              key,
              kind: "morning_of",
              severity: "soon",
              title: `Today: ${event.company} - ${event.title}`,
              body: event.role
                ? `${event.title} for ${event.role} (${event.company})`
                : `${event.title} (${event.company})`,
              eventAt: event.startDate.toISOString(),
              hasTime: false,
              dueAt: morningOfTrigger.toISOString(),
              applicationId: app.id,
              company: event.company,
              role: event.role,
              status: event.status,
            });
          }

          // Day before reminder (active from 09:00 previous day until end of event day)
          if (now.getTime() >= dayBeforeTrigger.getTime() && now.getTime() <= event.endDate.getTime()) {
            const key = `rem-${app.id}-${event.start}-day_before`;
            candidateReminders.push({
              key,
              kind: "day_before",
              severity: "soon",
              title: `Tomorrow: ${event.company} - ${event.title}`,
              body: event.role
                ? `Upcoming ${event.kind} for ${event.role}`
                : `Upcoming ${event.kind}`,
              eventAt: event.startDate.toISOString(),
              hasTime: false,
              dueAt: dayBeforeTrigger.toISOString(),
              applicationId: app.id,
              company: event.company,
              role: event.role,
              status: event.status,
            });
          }
        } else {
          // Timed event:
          // "two_hours": triggers 2 hours before start
          const twoHoursTrigger = new Date(event.startDate.getTime() - 2 * 60 * 60 * 1000);
          // "day_before": triggers 24 hours before start
          const dayBeforeTrigger = new Date(event.startDate.getTime() - 24 * 60 * 60 * 1000);

          const timeFormatted = formatEventTime(event.startDate, timezone);

          if (now.getTime() >= twoHoursTrigger.getTime() && now.getTime() < event.startDate.getTime()) {
            const key = `rem-${app.id}-${event.start}-two_hours`;
            candidateReminders.push({
              key,
              kind: "two_hours",
              severity: "urgent",
              title: `${event.company}: ${event.title} in 2 hours`,
              body: `${event.title} begins at ${timeFormatted}`,
              eventAt: event.startDate.toISOString(),
              hasTime: true,
              dueAt: twoHoursTrigger.toISOString(),
              applicationId: app.id,
              company: event.company,
              role: event.role,
              status: event.status,
            });
          }

          if (now.getTime() >= dayBeforeTrigger.getTime() && now.getTime() < event.startDate.getTime()) {
            const key = `rem-${app.id}-${event.start}-day_before`;
            candidateReminders.push({
              key,
              kind: "day_before",
              severity: "soon",
              title: `${event.company}: ${event.title} tomorrow`,
              body: `${event.title} at ${timeFormatted}`,
              eventAt: event.startDate.toISOString(),
              hasTime: true,
              dueAt: dayBeforeTrigger.toISOString(),
              applicationId: app.id,
              company: event.company,
              role: event.role,
              status: event.status,
            });
          }
        }

        // When multiple reminders for the same event are active, show only the most urgent one!
        if (candidateReminders.length > 0) {
          candidateReminders.sort(
            (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
          );
          const mostUrgent = candidateReminders[0];
          if (!dismissedSet.has(mostUrgent.key)) {
            activeReminders.push(mostUrgent);
          }
        }
      }
    }

    // 2. Action Required Reminders
    if (app.actionRequired) {
      const noteHash = hashString(app.actionNote || "");
      const key = `rem-${app.id}-action-${noteHash}`;

      if (!dismissedSet.has(key)) {
        // Determine severity: urgent if within 2 hours or overdue, soon if within 24h, info otherwise
        let severity: "urgent" | "soon" | "info" = "info";

        if (event) {
          const diffMs = event.startDate.getTime() - now.getTime();
          if (diffMs <= 0 || diffMs <= 2 * 60 * 60 * 1000) {
            severity = "urgent";
          } else if (diffMs <= 24 * 60 * 60 * 1000) {
            severity = "soon";
          }
        } else {
          // If no date and action is required, treat as info
          severity = "info";
        }

        activeReminders.push({
          key,
          kind: "action_required",
          severity,
          title: "Action needed",
          body: app.actionNote?.trim() || `Action required on your ${app.companyName} application`,
          eventAt: event ? event.startDate.toISOString() : null,
          hasTime: event ? !event.allDay : false,
          dueAt: event ? event.startDate.toISOString() : app.createdAt.toISOString(),
          applicationId: app.id,
          company: app.companyName,
          role: app.role || null,
          status: app.status,
        });
      }
    }
  }

  // 3. Daily Digest Reminder
  // Active from 08:00 timezone until end of day when at least one event falls today
  if (eventsToday.length > 0) {
    const digestTrigger = getTimeOnDateInTimezone(todayStr, 8, 0, timezone);
    const dayEnd = getTimeOnDateInTimezone(todayStr, 23, 59, timezone);

    if (now.getTime() >= digestTrigger.getTime() && now.getTime() <= dayEnd.getTime()) {
      const digestKey = `digest-${todayStr}`;
      if (!dismissedSet.has(digestKey)) {
        const count = eventsToday.length;
        const details = eventsToday
          .map((e) => {
            if (e.allDay) {
              return `${e.company} ${e.title}`;
            }
            return `${e.company} ${e.title} ${formatEventTime(e.startDate, timezone)}`;
          })
          .join(", ");

        activeReminders.push({
          key: digestKey,
          kind: "digest",
          severity: "info",
          title: `Today: ${count} event${count > 1 ? "s" : ""}`,
          body: details,
          eventAt: digestTrigger.toISOString(),
          hasTime: false,
          dueAt: digestTrigger.toISOString(),
          applicationId: null,
          company: null,
          role: null,
          status: null,
        });
      }
    }
  }

  // Sort by severity (urgent -> soon -> info), then by dueAt ascending
  activeReminders.sort((a, b) => {
    const sevDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sevDiff !== 0) return sevDiff;
    return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
  });

  return {
    items: activeReminders,
    count: activeReminders.length,
    now: now.toISOString(),
  };
}
