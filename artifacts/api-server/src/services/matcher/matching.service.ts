import { and, asc, eq, isNotNull } from "drizzle-orm";
import {
  db,
  placementApplicationsTable,
  emailEventsTable,
  type EmailEvent,
} from "@workspace/db";
import {
  matchExtractedEmail,
  type MatcherApplication,
  type MatcherEmailInput,
  type MatcherContext,
} from "./application-matcher";
import { computeContentFingerprint } from "./normalizer";
import { ApplyService } from "./apply.service";
import { logger } from "../../lib/logger";

export interface ApplyResultCounts {
  applied: number;
  created: number;
  updated: number;
  historical: number;
  needsReview: number;
}

const userApplyLocks = new Map<string, Promise<void>>();

export class MatchingService {
  /**
   * Applies all 'extracted' emails for a given user in ascending received_at order.
   * Locked per user to prevent concurrent overlapping runs.
   */
  static async applyExtracted(userId: string): Promise<ApplyResultCounts> {
    while (userApplyLocks.has(userId)) {
      try {
        await userApplyLocks.get(userId);
      } catch {}
    }

    let resolveLock!: () => void;
    const lockPromise = new Promise<void>((res) => {
      resolveLock = res;
    });
    userApplyLocks.set(userId, lockPromise);

    try {
      return await this._doApplyExtracted(userId);
    } finally {
      userApplyLocks.delete(userId);
      resolveLock();
    }
  }

  private static async _doApplyExtracted(userId: string): Promise<ApplyResultCounts> {
    const counts: ApplyResultCounts = {
      applied: 0,
      created: 0,
      updated: 0,
      historical: 0,
      needsReview: 0,
    };

    // Query all email_events with status = 'extracted' ordered by received_at ASC
    const extractedEvents = await db
      .select()
      .from(emailEventsTable)
      .where(
        and(
          eq(emailEventsTable.userId, userId),
          eq(emailEventsTable.status, "extracted"),
        ),
      )
      .orderBy(asc(emailEventsTable.receivedAt), asc(emailEventsTable.createdAt));

    if (extractedEvents.length === 0) {
      return counts;
    }

    logger.info(
      { userId, count: extractedEvents.length },
      "MatchingService: starting matching for extracted emails",
    );

    for (const email of extractedEvents) {
      try {
        const aiResult = (email.aiResult as any) || {};

        // Compute fingerprint
        const fingerprint =
          email.contentFingerprint ||
          computeContentFingerprint({
            fromAddress: email.fromAddress,
            subject: email.subject,
            company: aiResult.company,
            role: aiResult.role,
            suggestedStatus: aiResult.suggested_status,
            stageDetail: aiResult.stage_detail,
            nextAt: aiResult.next_at,
          });

        // Pull fresh DB context for each email so earlier emails in run are visible
        const currentApps = await db
          .select({
            id: placementApplicationsTable.id,
            companyName: placementApplicationsTable.companyName,
            role: placementApplicationsTable.role,
            status: placementApplicationsTable.status,
            isSample: placementApplicationsTable.isSample,
            lastEmailAt: placementApplicationsTable.lastEmailAt,
            appliedDate: placementApplicationsTable.appliedDate,
            createdAt: placementApplicationsTable.createdAt,
          })
          .from(placementApplicationsTable)
          .where(
            and(
              eq(placementApplicationsTable.userId, userId),
              eq(placementApplicationsTable.isSample, false),
            ),
          );

        // Fetch thread mappings
        const threadRows = await db
          .select({
            threadId: emailEventsTable.threadId,
            applicationId: emailEventsTable.applicationId,
          })
          .from(emailEventsTable)
          .where(
            and(
              eq(emailEventsTable.userId, userId),
              isNotNull(emailEventsTable.threadId),
              isNotNull(emailEventsTable.applicationId),
            ),
          );

        const threadToAppIds = new Map<string, string[]>();
        for (const row of threadRows) {
          if (!row.threadId || !row.applicationId) continue;
          const list = threadToAppIds.get(row.threadId) || [];
          if (!list.includes(row.applicationId)) {
            list.push(row.applicationId);
          }
          threadToAppIds.set(row.threadId, list);
        }

        // Fetch applied fingerprints
        const appliedRows = await db
          .select({
            fingerprint: emailEventsTable.contentFingerprint,
            applicationId: emailEventsTable.applicationId,
          })
          .from(emailEventsTable)
          .where(
            and(
              eq(emailEventsTable.userId, userId),
              eq(emailEventsTable.status, "applied"),
              isNotNull(emailEventsTable.contentFingerprint),
            ),
          );

        const appliedFingerprints = new Map<string, string>();
        for (const row of appliedRows) {
          if (row.fingerprint && row.applicationId) {
            appliedFingerprints.set(row.fingerprint, row.applicationId);
          }
        }

        const matcherInput: MatcherEmailInput = {
          threadId: email.threadId,
          receivedAt: email.receivedAt || new Date(),
          fromAddress: email.fromAddress,
          contentFingerprint: fingerprint,
          aiResult,
        };

        const matcherContext: MatcherContext = {
          email: matcherInput,
          applications: currentApps as MatcherApplication[],
          threadToAppIds,
          appliedFingerprints,
        };

        const decision = matchExtractedEmail(matcherContext);

        const result = await ApplyService.applyDecision({
          userId,
          emailEvent: {
            ...email,
            contentFingerprint: fingerprint,
          },
          decision,
          appliedBy: "auto",
        });

        if (result.action === "create") {
          counts.created += 1;
          counts.applied += 1;
        } else if (result.action === "update") {
          counts.updated += 1;
          counts.applied += 1;
        } else if (result.action === "timeline_only") {
          counts.historical += 1;
          counts.applied += 1;
        } else if (result.action === "review") {
          counts.needsReview += 1;
        }
      } catch (err: any) {
        logger.error(
          { emailId: email.id, error: err?.message },
          "MatchingService: error matching and applying email",
        );
      }
    }

    return counts;
  }
}

