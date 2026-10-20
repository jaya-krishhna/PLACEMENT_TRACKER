import { Router, type Request, type Response } from "express";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  placementUsersTable,
  placementSessionsTable,
  placementApplicationsTable,
  applicationEventsTable,
} from "@workspace/db";
import { GetCalendarEventsQueryParams } from "@workspace/api-zod";
import {
  deriveEventsForApplications,
  deriveUpcomingEvent,
  type DerivedCalendarEvent,
} from "../services/calendar/event-derivation";
import { generateIcs, generateSingleIcs } from "../services/calendar/ics-generator";
import { logger } from "../lib/logger";

const router = Router();

async function getSessionUser(req: Request) {
  const token = req.cookies?.placement_session;
  if (!token) return null;

  const crypto = await import("node:crypto");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const [session] = await db
    .select({
      id: placementSessionsTable.id,
      userId: placementSessionsTable.userId,
      expiresAt: placementSessionsTable.expiresAt,
    })
    .from(placementSessionsTable)
    .where(eq(placementSessionsTable.tokenHash, tokenHash))
    .limit(1);

  if (!session || new Date(session.expiresAt).getTime() <= Date.now()) {
    return null;
  }

  const [user] = await db
    .select({
      id: placementUsersTable.id,
      email: placementUsersTable.email,
    })
    .from(placementUsersTable)
    .where(eq(placementUsersTable.id, session.userId))
    .limit(1);

  return user || null;
}

// ─── GET /calendar/events?from=&to= ──────────────────────────────────────────
router.get("/calendar/events", async (req: Request, res: Response): Promise<void> => {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }

  const query = GetCalendarEventsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Missing or invalid 'from' and 'to' date parameters." });
    return;
  }

  const fromDate = new Date(query.data.from);
  const toDate = new Date(query.data.to);

  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    res.status(400).json({ error: "Invalid date format for 'from' or 'to'." });
    return;
  }

  // Max range: 92 days
  const rangeMs = toDate.getTime() - fromDate.getTime();
  const maxRangeMs = 92 * 24 * 60 * 60 * 1000;
  if (rangeMs < 0 || rangeMs > maxRangeMs) {
    res.status(400).json({ error: "Date range must be between 0 and 92 days." });
    return;
  }

  try {
    const apps = await db
      .select()
      .from(placementApplicationsTable)
      .where(
        and(
          eq(placementApplicationsTable.userId, user.id),
          eq(placementApplicationsTable.isSample, false),
        ),
      );

    const appIds = apps.map((a) => a.id);
    const latestSummaries: Record<string, string> = {};

    if (appIds.length > 0) {
      const events = await db
        .select({
          applicationId: applicationEventsTable.applicationId,
          summary: applicationEventsTable.summary,
          occurredAt: applicationEventsTable.occurredAt,
        })
        .from(applicationEventsTable)
        .where(
          and(
            eq(applicationEventsTable.userId, user.id),
            inArray(applicationEventsTable.applicationId, appIds),
            isNull(applicationEventsTable.undoneAt),
          ),
        );

      events.sort(
        (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
      );

      for (const ev of events) {
        if (!latestSummaries[ev.applicationId] && ev.summary) {
          latestSummaries[ev.applicationId] = ev.summary;
        }
      }
    }

    const now = new Date();
    const allEvents = deriveEventsForApplications(
      apps,
      latestSummaries,
      now,
      process.env.DEFAULT_TIMEZONE || "Asia/Kolkata",
    );

    // Filter events falling within [from, to] (inclusive of start/end)
    const filtered = allEvents.filter((ev) => {
      const eventTime = ev.startDate.getTime();
      const fromTime = fromDate.getTime();
      // Set toTime to end of day of toDate
      const toEndTime = toDate.getTime() + 24 * 60 * 60 * 1000;
      return eventTime >= fromTime && eventTime <= toEndTime;
    });

    const items = filtered.map((ev) => ({
      id: ev.id,
      applicationId: ev.applicationId,
      title: ev.title,
      kind: ev.kind,
      start: ev.start,
      end: ev.end,
      allDay: ev.allDay,
      company: ev.company,
      role: ev.role,
      status: ev.status,
      stageDetail: ev.stageDetail,
      actionRequired: ev.actionRequired,
      actionNote: ev.actionNote,
      source: ev.source,
      summary: ev.summary,
      isPast: ev.isPast,
    }));

    res.json(items);
  } catch (err: any) {
    logger.error({ error: err?.message }, "Failed to fetch calendar events");
    res.status(500).json({ error: "Failed to fetch calendar events." });
  }
});

// ─── GET /calendar/export.ics ────────────────────────────────────────────────
router.get("/calendar/export.ics", async (req: Request, res: Response): Promise<void> => {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }

  try {
    const apps = await db
      .select()
      .from(placementApplicationsTable)
      .where(
        and(
          eq(placementApplicationsTable.userId, user.id),
          eq(placementApplicationsTable.isSample, false),
        ),
      );

    const now = new Date();
    const allEvents = deriveEventsForApplications(
      apps,
      {},
      now,
      process.env.DEFAULT_TIMEZONE || "Asia/Kolkata",
    );

    // Upcoming events only
    const upcomingEvents = allEvents.filter((e) => !e.isPast);

    const icsContent = generateIcs(upcomingEvents, now);

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="placement-tracker-calendar.ics"',
    );
    res.send(icsContent);
  } catch (err: any) {
    logger.error({ error: err?.message }, "Failed to export calendar ics");
    res.status(500).json({ error: "Failed to export calendar ics." });
  }
});

// ─── GET /applications/:id/event.ics ─────────────────────────────────────────
router.get("/applications/:id/event.ics", async (req: Request, res: Response): Promise<void> => {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }

  const id = String(req.params.id);

  try {
    const [app] = await db
      .select()
      .from(placementApplicationsTable)
      .where(
        and(
          eq(placementApplicationsTable.id, id),
          eq(placementApplicationsTable.userId, user.id),
        ),
      )
      .limit(1);

    if (!app) {
      res.status(404).json({ error: "Application not found." });
      return;
    }

    const now = new Date();
    const event = deriveUpcomingEvent(
      app,
      null,
      now,
      process.env.DEFAULT_TIMEZONE || "Asia/Kolkata",
    );

    if (!event) {
      res.status(400).json({ error: "No upcoming event found for this application." });
      return;
    }

    const icsContent = generateSingleIcs(event, now);
    const sanitizedCompany = event.company.replace(/[^a-zA-Z0-9-_]/g, "_");

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${sanitizedCompany}-event.ics"`,
    );
    res.send(icsContent);
  } catch (err: any) {
    logger.error({ error: err?.message, applicationId: id }, "Failed to export single event ics");
    res.status(500).json({ error: "Failed to export event ics." });
  }
});

export default router;
