import { and, desc, eq, isNull, inArray } from "drizzle-orm";
import {
  db,
  placementApplicationsTable,
  applicationEventsTable,
  emailEventsTable,
} from "@workspace/db";
import { logger } from "../../lib/logger";

export class UndoError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "UndoError";
    this.statusCode = statusCode;
  }
}

export class UndoService {
  /**
   * Undoes the latest application event on the specified application.
   */
  static async undoEvent(opts: {
    userId: string;
    applicationId: string;
    eventId: string;
  }): Promise<{ message: string }> {
    const { userId, applicationId, eventId } = opts;

    return await db.transaction(async (tx) => {
      // 1. Verify application exists and belongs to user
      const [app] = await tx
        .select()
        .from(placementApplicationsTable)
        .where(
          and(
            eq(placementApplicationsTable.id, applicationId),
            eq(placementApplicationsTable.userId, userId),
          ),
        );

      if (!app) {
        throw new UndoError("Application not found.", 404);
      }

      // 2. Fetch non-undone auto or review events on this application
      const events = await tx
        .select()
        .from(applicationEventsTable)
        .where(
          and(
            eq(applicationEventsTable.applicationId, applicationId),
            eq(applicationEventsTable.userId, userId),
            isNull(applicationEventsTable.undoneAt),
            inArray(applicationEventsTable.appliedBy, ["auto", "review"]),
          ),
        )
        .orderBy(
          desc(applicationEventsTable.occurredAt),
          desc(applicationEventsTable.createdAt),
        );

      if (events.length === 0) {
        throw new UndoError("No undoable events found for this application.", 400);
      }

      const latestEvent = events[0];
      if (latestEvent.id !== eventId) {
        throw new UndoError("Only the latest event can be undone.", 400);
      }

      // 3. Conflict check against manual edits
      if (latestEvent.after && typeof latestEvent.after === "object") {
        const afterFields = latestEvent.after as Record<string, any>;
        const appUpdatedAt = app.updatedAt ? new Date(app.updatedAt).getTime() : 0;
        const eventCreatedAt = latestEvent.createdAt ? new Date(latestEvent.createdAt).getTime() : 0;

        // If updated after event, check if any after fields were changed manually
        if (appUpdatedAt > eventCreatedAt + 1000) {
          for (const [key, expectedVal] of Object.entries(afterFields)) {
            const currentVal = (app as any)[key];
            const currentSerialized = currentVal instanceof Date ? currentVal.toISOString() : currentVal;
            const expectedSerialized = expectedVal instanceof Date ? expectedVal.toISOString() : expectedVal;

            if (currentSerialized !== expectedSerialized) {
              throw new UndoError(
                "Cannot undo: application has been modified manually since this event.",
                409,
              );
            }
          }
        }
      }

      const now = new Date();

      // 4. Handle kind "created"
      if (latestEvent.kind === "created") {
        // First update email event to return to needs_review
        if (latestEvent.emailEventId) {
          await tx
            .update(emailEventsTable)
            .set({
              status: "needs_review",
              reviewReason: "undone",
              applicationId: null,
              resolvedAt: null,
            })
            .where(eq(emailEventsTable.id, latestEvent.emailEventId));
        }

        // Mark event undone
        await tx
          .update(applicationEventsTable)
          .set({ undoneAt: now })
          .where(eq(applicationEventsTable.id, latestEvent.id));

        // Delete the application
        await tx
          .delete(placementApplicationsTable)
          .where(eq(placementApplicationsTable.id, applicationId));

        logger.info(
          { userId, applicationId, eventId },
          "Undid application creation: application deleted",
        );

        return { message: "Application deleted and event returned to review queue." };
      }

      // 5. Handle kind "updated"
      if (latestEvent.kind === "updated") {
        const beforeFields = (latestEvent.before as Record<string, any>) || {};
        const restoredUpdates: Record<string, any> = {
          updatedAt: now,
        };

        for (const [key, val] of Object.entries(beforeFields)) {
          if (key === "nextAt" || key === "lastEmailAt") {
            restoredUpdates[key] = val ? new Date(val) : null;
          } else {
            restoredUpdates[key] = val;
          }
        }

        await tx
          .update(placementApplicationsTable)
          .set(restoredUpdates)
          .where(eq(placementApplicationsTable.id, applicationId));

        // Mark event undone
        await tx
          .update(applicationEventsTable)
          .set({ undoneAt: now })
          .where(eq(applicationEventsTable.id, latestEvent.id));

        // Return email event to needs_review
        if (latestEvent.emailEventId) {
          await tx
            .update(emailEventsTable)
            .set({
              status: "needs_review",
              reviewReason: "undone",
              applicationId: null,
              resolvedAt: null,
            })
            .where(eq(emailEventsTable.id, latestEvent.emailEventId));
        }

        logger.info(
          { userId, applicationId, eventId },
          "Undid application update: restored previous fields",
        );

        return { message: "Application changes reverted and event returned to review queue." };
      }

      // If kind is historical
      if (latestEvent.kind === "historical") {
        await tx
          .update(applicationEventsTable)
          .set({ undoneAt: now })
          .where(eq(applicationEventsTable.id, latestEvent.id));

        if (latestEvent.emailEventId) {
          await tx
            .update(emailEventsTable)
            .set({
              status: "needs_review",
              reviewReason: "undone",
              applicationId: null,
              resolvedAt: null,
            })
            .where(eq(emailEventsTable.id, latestEvent.emailEventId));
        }

        return { message: "Historical event undone and returned to review queue." };
      }

      throw new UndoError(`Cannot undo event of kind: ${latestEvent.kind}`, 400);
    });
  }
}

