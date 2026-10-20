import { and, eq, isNotNull } from "drizzle-orm";
import { db, connectedAccountsTable } from "@workspace/db";
import { SyncService } from "./sync.service";
import { ProcessingService } from "./processing.service";
import { MatchingService } from "./matcher/matching.service";
import { logger } from "../lib/logger";

let isSyncRunning = false;
let intervalTimer: NodeJS.Timeout | null = null;

export class SchedulerService {
  /**
   * Runs syncMetadata for all active accounts that have a label selected.
   * Ensures runs never overlap.
   */
  static async runSyncAll(): Promise<void> {
    if (isSyncRunning) {
      logger.info("Scheduler: sync is already running, skipping overlapping execution.");
      return;
    }

    isSyncRunning = true;
    try {
      // Find all active connected accounts with a selected label
      const activeAccounts = await db
        .select({
          userId: connectedAccountsTable.userId,
          googleEmail: connectedAccountsTable.googleEmail,
        })
        .from(connectedAccountsTable)
        .where(
          and(
            eq(connectedAccountsTable.status, "active"),
            isNotNull(connectedAccountsTable.labelId),
          ),
        );

      logger.info(
        { count: activeAccounts.length },
        "Scheduler: starting background sync for active accounts",
      );

      for (const account of activeAccounts) {
        try {
          const result = await SyncService.syncMetadata(account.userId);
          logger.info(
            { email: account.googleEmail, result },
            "Scheduler: successfully synced account",
          );

          // Process queued emails after sync
          const processResult = await ProcessingService.processQueued(account.userId);
          logger.info(
            { email: account.googleEmail, processResult },
            "Scheduler: successfully processed queued emails",
          );

          // Apply extracted emails to applications
          const applyResult = await MatchingService.applyExtracted(account.userId);
          logger.info(
            { email: account.googleEmail, applyResult },
            "Scheduler: successfully applied extracted emails",
          );
        } catch (err: any) {
          logger.error(
            { email: account.googleEmail, error: err?.message },
            "Scheduler: failed syncing or processing account",
          );
        }
      }
    } catch (err: any) {
      logger.error({ error: err?.message }, "Scheduler: error querying accounts to sync");
    } finally {
      isSyncRunning = false;
    }
  }

  /**
   * Starts the background scheduler (runs once on startup, then every 10 minutes).
   */
  static start(): void {
    logger.info("Starting Gmail Sync background scheduler (10 min interval)...");
    // Run once on server startup (catch errors so startup never fails)
    void this.runSyncAll().catch((err) => {
      logger.error({ err }, "Initial scheduler sync run failed");
    });

    if (intervalTimer) {
      clearInterval(intervalTimer);
    }
    // 10 minutes = 10 * 60 * 1000 ms
    intervalTimer = setInterval(() => {
      void this.runSyncAll().catch((err) => {
        logger.error({ err }, "Periodic scheduler sync run failed");
      });
    }, 10 * 60 * 1000);
  }

  static stop(): void {
    if (intervalTimer) {
      clearInterval(intervalTimer);
      intervalTimer = null;
    }
  }
}

