import { Router, type Request, type Response } from "express";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  placementUsersTable,
  placementSessionsTable,
  placementApplicationsTable,
  applicationEventsTable,
  reminderDismissalsTable,
} from "@workspace/db";
import {
  GetRemindersResponse,
  DismissReminderBody,
  DismissReminderResponse,
  DismissAllRemindersResponse,
} from "@workspace/api-zod";
import { computeReminders } from "../services/calendar/reminder-engine";
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

// ─── GET /reminders ──────────────────────────────────────────────────────────
router.get("/reminders", async (req: Request, res: Response): Promise<void> => {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }

  try {
    // 1. Fetch user's non-sample applications
    const apps = await db
      .select()
      .from(placementApplicationsTable)
      .where(
        and(
          eq(placementApplicationsTable.userId, user.id),
          eq(placementApplicationsTable.isSample, false),
        ),
      );

    // 2. Fetch latest non-undone application events for summaries
    const appIds = apps.map((a) => a.id);
    const latestSummaries: Record<string, string> = {};

    if (appIds.length > 0) {
      const events = await db
        .select({
          applicationId: applicationEventsTable.applicationId,
          summary: applicationEventsTable.summary,
          occurredAt: applicationEventsTable.occurredAt,
          createdAt: applicationEventsTable.createdAt,
        })
        .from(applicationEventsTable)
        .where(
          and(
            eq(applicationEventsTable.userId, user.id),
            inArray(applicationEventsTable.applicationId, appIds),
            isNull(applicationEventsTable.undoneAt),
          ),
        );

      // Sort by occurredAt desc to find the latest
      events.sort(
        (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
      );

      for (const ev of events) {
        if (!latestSummaries[ev.applicationId] && ev.summary) {
          latestSummaries[ev.applicationId] = ev.summary;
        }
      }
    }

    // 3. Fetch dismissed keys
    const dismissals = await db
      .select({ reminderKey: reminderDismissalsTable.reminderKey })
      .from(reminderDismissalsTable)
      .where(eq(reminderDismissalsTable.userId, user.id));

    const dismissedKeys = new Set(dismissals.map((d) => d.reminderKey));

    // 4. Compute active reminders
    const now = new Date();
    const remindersResult = computeReminders({
      applications: apps,
      latestSummaries,
      dismissedKeys,
      now,
      timezone: process.env.DEFAULT_TIMEZONE || "Asia/Kolkata",
    });

    res.json(GetRemindersResponse.parse(remindersResult));
  } catch (err: any) {
    logger.error({ error: err?.message }, "Failed to get reminders");
    res.status(500).json({ error: "Failed to get reminders." });
  }
});

// ─── POST /reminders/dismiss ────────────────────────────────────────────────
router.post("/reminders/dismiss", async (req: Request, res: Response): Promise<void> => {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }

  const parsed = DismissReminderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid reminder dismissal input." });
    return;
  }

  try {
    const { key } = parsed.data;

    // Upsert into reminder_dismissals
    await db
      .insert(reminderDismissalsTable)
      .values({
        userId: user.id,
        reminderKey: key,
        dismissedAt: new Date(),
      })
      .onConflictDoNothing();

    res.json(DismissReminderResponse.parse({ success: true }));
  } catch (err: any) {
    logger.error({ error: err?.message }, "Failed to dismiss reminder");
    res.status(500).json({ error: "Failed to dismiss reminder." });
  }
});

// ─── POST /reminders/dismiss-all ─────────────────────────────────────────────
router.post("/reminders/dismiss-all", async (req: Request, res: Response): Promise<void> => {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }

  try {
    // 1. Fetch user's non-sample applications
    const apps = await db
      .select()
      .from(placementApplicationsTable)
      .where(
        and(
          eq(placementApplicationsTable.userId, user.id),
          eq(placementApplicationsTable.isSample, false),
        ),
      );

    // 2. Fetch dismissed keys
    const dismissals = await db
      .select({ reminderKey: reminderDismissalsTable.reminderKey })
      .from(reminderDismissalsTable)
      .where(eq(reminderDismissalsTable.userId, user.id));

    const dismissedKeys = new Set(dismissals.map((d) => d.reminderKey));

    // 3. Compute current active reminders
    const now = new Date();
    const remindersResult = computeReminders({
      applications: apps,
      dismissedKeys,
      now,
      timezone: process.env.DEFAULT_TIMEZONE || "Asia/Kolkata",
    });

    const activeKeys = remindersResult.items.map((item) => item.key);
    let count = 0;

    if (activeKeys.length > 0) {
      for (const key of activeKeys) {
        await db
          .insert(reminderDismissalsTable)
          .values({
            userId: user.id,
            reminderKey: key,
            dismissedAt: now,
          })
          .onConflictDoNothing();
        count++;
      }
    }

    res.json(DismissAllRemindersResponse.parse({ success: true, count }));
  } catch (err: any) {
    logger.error({ error: err?.message }, "Failed to dismiss all reminders");
    res.status(500).json({ error: "Failed to dismiss all reminders." });
  }
});

export default router;
