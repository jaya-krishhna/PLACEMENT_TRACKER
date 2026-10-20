import { and, asc, count, eq, inArray } from "drizzle-orm";
import { db, emailEventsTable } from "@workspace/db";
import { GmailAuthService } from "./gmail-auth.service";
import { GmailClient } from "../lib/gmail-client";
import { EmailExtractionService } from "./email-extraction.service";
import { ProviderFactory } from "../ai/provider-factory";
import { RateLimitError } from "../ai/types";
import { logger } from "../lib/logger";

export interface ProcessQueuedResult {
  extracted: number;
  ignored: number;
  failed: number;
  remaining: number;
  rateLimited?: boolean;
}

export class ProcessingService {
  private static userLocks = new Set<string>();

  /**
   * Processes queued emails for a given user.
   * Concurrency 1 per user, ascending received_at order.
   * Email bodies are fetched only in-memory and NEVER stored or logged.
   */
  static async processQueued(
    userId: string,
    limit = 50,
  ): Promise<ProcessQueuedResult> {
    if (this.userLocks.has(userId)) {
      logger.info({ userId }, "ProcessingService: run already in progress for user, skipping");
      return { extracted: 0, ignored: 0, failed: 0, remaining: 0 };
    }

    this.userLocks.add(userId);
    let extracted = 0;
    let ignored = 0;
    let failed = 0;
    let rateLimited = false;

    try {
      // 1. Fetch queued email events (and failed events with retry_count < 3) in ascending received_at order
      const events = await db
        .select()
        .from(emailEventsTable)
        .where(
          and(
            eq(emailEventsTable.userId, userId),
            inArray(emailEventsTable.status, ["queued"]),
          ),
        )
        .orderBy(asc(emailEventsTable.receivedAt), asc(emailEventsTable.createdAt))
        .limit(limit);

      if (events.length === 0) {
        return { extracted: 0, ignored: 0, failed: 0, remaining: 0 };
      }

      logger.info(
        { userId, count: events.length },
        "ProcessingService: starting batch email processing",
      );

      // 2. Initialize extraction service with configured provider chain
      const provider = ProviderFactory.getProvider();
      const extractionService = new EmailExtractionService(provider);

      // Get Gmail OAuth client for user
      const auth = await GmailAuthService.getAuthorizedClient(userId);

      for (let i = 0; i < events.length; i++) {
        const event = events[i];
        const eventId = event.id;
        const startTime = Date.now();

        // Mark as processing
        await db
          .update(emailEventsTable)
          .set({ status: "processing" })
          .where(eq(emailEventsTable.id, eventId));

        let bodyText = "";
        try {
          // Fetch body in memory (never logged, never persisted)
          bodyText = await GmailClient.getMessageBody(auth, event.gmailMessageId);
        } catch (fetchErr: any) {
          const is404 =
            fetchErr?.status === 404 ||
            fetchErr?.code === 404 ||
            fetchErr?.message?.includes("404") ||
            fetchErr?.message?.includes("Not Found");

          if (is404) {
            logger.info(
              { eventId, status: "ignored", reason: "gmail_404" },
              "Gmail message not found on server; marking ignored",
            );
            await db
              .update(emailEventsTable)
              .set({
                status: "ignored",
                error: "Gmail message not found (404)",
              })
              .where(eq(emailEventsTable.id, eventId));
            ignored++;
            continue;
          }

          // Other Gmail API error (e.g. auth revoked, network)
          const newRetryCount = (event.retryCount || 0) + 1;
          const status = newRetryCount >= 3 ? "failed" : "queued";
          await db
            .update(emailEventsTable)
            .set({
              status,
              retryCount: newRetryCount,
              error: `Gmail fetch error: ${fetchErr?.message || "Unknown error"}`,
            })
            .where(eq(emailEventsTable.id, eventId));

          if (status === "failed") failed++;
          continue;
        }

        try {
          // AI extraction
          const extractionResult = await extractionService.extract({
            sender: event.fromAddress || event.fromDomain || "unknown",
            subject: event.subject || "(no subject)",
            receivedAt: event.receivedAt
              ? event.receivedAt.toISOString()
              : new Date().toISOString(),
            body: bodyText,
          });

          const isJobRelated = extractionResult.is_job_related;
          const finalStatus = isJobRelated ? "extracted" : "ignored";
          const duration = Date.now() - startTime;

          await db
            .update(emailEventsTable)
            .set({
              status: finalStatus,
              aiResult: extractionResult,
              confidence: extractionResult.confidence.toString(),
              error: null,
            })
            .where(eq(emailEventsTable.id, eventId));

          logger.info(
            {
              eventId,
              status: finalStatus,
              model: extractionResult._meta?.model,
              duration,
            },
            "Successfully extracted email event",
          );

          if (isJobRelated) {
            extracted++;
          } else {
            ignored++;
          }
        } catch (extractErr: any) {
          const duration = Date.now() - startTime;
          const isRateLimit =
            extractErr instanceof RateLimitError ||
            extractErr?.status === 429 ||
            extractErr?.message?.includes("429") ||
            extractErr?.message?.includes("rate limit") ||
            extractErr?.message?.includes("cooling down");

          if (isRateLimit) {
            // Rate limit hit: put this email back to queued and stop the run so remaining emails stay queued!
            await db
              .update(emailEventsTable)
              .set({ status: "queued" })
              .where(eq(emailEventsTable.id, eventId));

            logger.warn(
              { eventId, duration, error: extractErr.message },
              "Processing halted due to AI provider rate limit / cooldown",
            );

            rateLimited = true;
            break;
          }

          // Other extraction failure (validation exhausted, 5xx after retries, etc.)
          const newRetryCount = (event.retryCount || 0) + 1;
          const status = newRetryCount >= 3 ? "failed" : "queued";

          await db
            .update(emailEventsTable)
            .set({
              status,
              retryCount: newRetryCount,
              error: extractErr?.message || "AI extraction failure",
            })
            .where(eq(emailEventsTable.id, eventId));

          logger.error(
            {
              eventId,
              status,
              retryCount: newRetryCount,
              duration,
              errorClass: extractErr?.name || "Error",
            },
            "Email extraction failed",
          );

          if (status === "failed") {
            failed++;
          }
        }
      }

      // Count remaining queued
      const remainingRows = await db
        .select({ count: count() })
        .from(emailEventsTable)
        .where(
          and(
            eq(emailEventsTable.userId, userId),
            eq(emailEventsTable.status, "queued"),
          ),
        );

      const remaining = Number(remainingRows?.[0]?.count || 0);

      return {
        extracted,
        ignored,
        failed,
        remaining,
        rateLimited,
      };
    } finally {
      this.userLocks.delete(userId);
    }
  }

  /**
   * Reprocesses a single email event.
   * Allowed only for 'extracted', 'failed', or 'ignored' events.
   */
  static async reprocessEvent(userId: string, eventId: string) {
    const [event] = await db
      .select()
      .from(emailEventsTable)
      .where(
        and(
          eq(emailEventsTable.id, eventId),
          eq(emailEventsTable.userId, userId),
        ),
      )
      .limit(1);

    if (!event) {
      throw new Error("Email event not found");
    }

    const allowedStatuses = ["extracted", "failed", "ignored"];
    if (!allowedStatuses.includes(event.status)) {
      throw new Error(
        `Cannot reprocess email with status '${event.status}'. Only extracted, failed, or ignored emails can be reprocessed.`,
      );
    }

    const [updated] = await db
      .update(emailEventsTable)
      .set({
        status: "queued",
        error: null,
        retryCount: 0,
      })
      .where(eq(emailEventsTable.id, eventId))
      .returning();

    return updated;
  }
}
