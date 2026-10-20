import { eq } from "drizzle-orm";
import {
  db,
  placementApplicationsTable,
  applicationEventsTable,
  emailEventsTable,
  type PlacementApplication,
  type EmailEvent,
} from "@workspace/db";
import { isGenericContact, computeContentFingerprint } from "./normalizer";
import { TERMINAL_STATUSES, type MatchDecision } from "./application-matcher";
import { logger } from "../../lib/logger";

export function formatDateInTimezone(
  dateInput: Date | string | null | undefined,
  timeZone: string = process.env.DEFAULT_TIMEZONE || "Asia/Kolkata",
): string | null {
  if (!dateInput) return null;
  const d = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (Number.isNaN(d.getTime())) return null;

  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(d);
  } catch {
    // Fallback if timezone string is invalid
    return d.toISOString().slice(0, 10);
  }
}

export function mapRejectionRound(
  prevStatus?: string | null,
  stageDetail?: string | null,
): string | null {
  if (!prevStatus) return null;
  const s = prevStatus.toUpperCase();
  const detail = (stageDetail || "").toLowerCase();

  if (s === "APPLIED" || s === "SCREENING") {
    return "Resume shortlisting";
  }
  if (s === "TEST") {
    if (detail.includes("coding") || detail.includes("hackerrank") || detail.includes("leetcode")) {
      return "Coding round";
    }
    if (
      detail.includes("aptitude") ||
      detail.includes("online test") ||
      detail.includes("assessment")
    ) {
      return "Aptitude/online test";
    }
    return "Coding round";
  }
  if (s === "INTERVIEW") {
    if (
      detail.includes("hr") ||
      detail.includes("behavioural") ||
      detail.includes("behavioral") ||
      detail.includes("culture") ||
      detail.includes("manager")
    ) {
      return "HR interview";
    }
    return "Technical interview";
  }
  return "Other";
}

export class ApplyService {
  /**
   * Applies a matcher decision to the database within a transaction.
   */
  static async applyDecision(opts: {
    userId: string;
    emailEvent: EmailEvent;
    decision: MatchDecision;
    appliedBy?: "auto" | "review";
    overrideApplicationId?: string; // used when user manually links in review queue
  }): Promise<{ action: string; applicationId?: string }> {
    const { userId, emailEvent, appliedBy = "auto", overrideApplicationId } = opts;
    const aiResult = (emailEvent.aiResult as any) || {};
    const receivedAt = emailEvent.receivedAt ? new Date(emailEvent.receivedAt) : new Date();
    const timezone = process.env.DEFAULT_TIMEZONE || "Asia/Kolkata";

    const fingerprint =
      emailEvent.contentFingerprint ||
      computeContentFingerprint({
        fromAddress: emailEvent.fromAddress,
        subject: emailEvent.subject,
        company: aiResult.company,
        role: aiResult.role,
        suggestedStatus: aiResult.suggested_status,
        stageDetail: aiResult.stage_detail,
        nextAt: aiResult.next_at,
      });

    return await db.transaction(async (tx) => {
      // 1. Review action
      if (opts.decision.action === "review" && !overrideApplicationId) {
        await tx
          .update(emailEventsTable)
          .set({
            status: "needs_review",
            matchMethod: opts.decision.matchMethod,
            reviewReason: opts.decision.reviewReason,
            candidateApplicationIds: opts.decision.candidateIds ?? null,
            contentFingerprint: fingerprint,
          })
          .where(eq(emailEventsTable.id, emailEvent.id));

        return { action: "review" };
      }

      // 2. Timeline only (stale email)
      const targetAppId = overrideApplicationId || opts.decision.applicationId;

      if (opts.decision.action === "timeline_only" && targetAppId) {
        await tx.insert(applicationEventsTable).values({
          userId,
          applicationId: targetAppId,
          emailEventId: emailEvent.id,
          kind: "historical",
          occurredAt: receivedAt,
          fromStatus: null,
          toStatus: aiResult.suggested_status ? aiResult.suggested_status.toUpperCase() : null,
          stageDetail: aiResult.stage_detail ?? null,
          summary: aiResult.summary ?? null,
          before: null,
          after: null,
          appliedBy,
        });

        await tx
          .update(emailEventsTable)
          .set({
            status: "applied",
            applicationId: targetAppId,
            matchMethod: opts.decision.matchMethod,
            resolvedAt: new Date(),
            contentFingerprint: fingerprint,
          })
          .where(eq(emailEventsTable.id, emailEvent.id));

        return { action: "timeline_only", applicationId: targetAppId };
      }

      // 3. Create new application
      if (opts.decision.action === "create") {
        const companyName = (aiResult.company || "Unknown Company").trim().slice(0, 160);
        const role = aiResult.role ? aiResult.role.trim().slice(0, 160) : null;
        const status = (aiResult.suggested_status || "APPLIED").toUpperCase();
        const isTerminal = TERMINAL_STATUSES.has(status);

        let nextAt: Date | null = null;
        let nextAtHasTime = false;
        let nextType: string | null = null;
        let nextDate: string | null = null;
        let actionRequired = false;
        let actionNote: string | null = null;

        if (!isTerminal) {
          if (aiResult.next_at) {
            nextAt = new Date(aiResult.next_at);
            nextAtHasTime = Boolean(aiResult.next_at_has_time);
            nextType = aiResult.next_type ?? null;
            nextDate = formatDateInTimezone(nextAt, timezone);
          }
          actionRequired = Boolean(aiResult.action_required);
          actionNote = aiResult.action_note ?? null;
        }

        let rejectionDate: string | null = null;
        let rejectionReason: string | null = null;
        if (status === "REJECTED") {
          rejectionDate = formatDateInTimezone(receivedAt, timezone);
          rejectionReason = aiResult.rejection_reason ?? null;
        }

        const appliedDate = formatDateInTimezone(receivedAt, timezone) || new Date().toISOString().slice(0, 10);

        // Contact info if not generic
        const contactName =
          aiResult.contact_name && !isGenericContact(aiResult.contact_name, null)
            ? aiResult.contact_name.trim().slice(0, 160)
            : null;
        const contactEmailOrPhone =
          aiResult.contact_email && !isGenericContact(null, aiResult.contact_email)
            ? aiResult.contact_email.trim().slice(0, 254)
            : emailEvent.fromAddress && !isGenericContact(null, emailEvent.fromAddress)
              ? emailEvent.fromAddress.trim().slice(0, 254)
              : null;
        const location = aiResult.location ? aiResult.location.trim().slice(0, 160) : null;

        const [createdApp] = await tx
          .insert(placementApplicationsTable)
          .values({
            userId,
            companyName,
            role,
            status,
            appliedDate,
            mode: "Unknown",
            source: "email",
            stageDetail: aiResult.stage_detail ?? null,
            nextAt,
            nextAtHasTime,
            nextType,
            nextDate,
            actionRequired,
            actionNote,
            lastEmailAt: receivedAt,
            location,
            contactName,
            contactEmailOrPhone,
            rejectionRound: null, // First email rejection has no prior round
            rejectionDate,
            rejectionReason,
            notes: null,
            isSample: false,
          })
          .returning();

        // Create after snapshot (all set non-null fields)
        const afterSnapshot: Record<string, any> = {
          companyName: createdApp.companyName,
          role: createdApp.role,
          status: createdApp.status,
          appliedDate: createdApp.appliedDate,
          mode: createdApp.mode,
          source: createdApp.source,
          stageDetail: createdApp.stageDetail,
          nextAt: createdApp.nextAt ? createdApp.nextAt.toISOString() : null,
          nextAtHasTime: createdApp.nextAtHasTime,
          nextType: createdApp.nextType,
          nextDate: createdApp.nextDate,
          actionRequired: createdApp.actionRequired,
          actionNote: createdApp.actionNote,
          lastEmailAt: createdApp.lastEmailAt ? createdApp.lastEmailAt.toISOString() : null,
          location: createdApp.location,
          contactName: createdApp.contactName,
          contactEmailOrPhone: createdApp.contactEmailOrPhone,
          rejectionRound: createdApp.rejectionRound,
          rejectionDate: createdApp.rejectionDate,
          rejectionReason: createdApp.rejectionReason,
        };

        await tx.insert(applicationEventsTable).values({
          userId,
          applicationId: createdApp.id,
          emailEventId: emailEvent.id,
          kind: "created",
          occurredAt: receivedAt,
          fromStatus: null,
          toStatus: createdApp.status,
          stageDetail: createdApp.stageDetail,
          summary: aiResult.summary ?? null,
          before: null,
          after: afterSnapshot,
          appliedBy,
        });

        await tx
          .update(emailEventsTable)
          .set({
            status: "applied",
            applicationId: createdApp.id,
            matchMethod: opts.decision.matchMethod,
            resolvedAt: new Date(),
            contentFingerprint: fingerprint,
          })
          .where(eq(emailEventsTable.id, emailEvent.id));

        return { action: "create", applicationId: createdApp.id };
      }

      // 4. Update existing application
      if (opts.decision.action === "update" || overrideApplicationId) {
        if (!targetAppId) {
          throw new Error("Update decision missing applicationId");
        }

        const [existingApp] = await tx
          .select()
          .from(placementApplicationsTable)
          .where(eq(placementApplicationsTable.id, targetAppId));

        if (!existingApp) {
          throw new Error(`Application ${targetAppId} not found`);
        }

        // Stale check if manual resolution
        if (overrideApplicationId && existingApp.lastEmailAt) {
          const lastTime = new Date(existingApp.lastEmailAt).getTime();
          if (!Number.isNaN(lastTime) && receivedAt.getTime() <= lastTime) {
            // Apply as timeline_only
            await tx.insert(applicationEventsTable).values({
              userId,
              applicationId: targetAppId,
              emailEventId: emailEvent.id,
              kind: "historical",
              occurredAt: receivedAt,
              fromStatus: null,
              toStatus: aiResult.suggested_status ? aiResult.suggested_status.toUpperCase() : null,
              stageDetail: aiResult.stage_detail ?? null,
              summary: aiResult.summary ?? null,
              before: null,
              after: null,
              appliedBy,
            });

            await tx
              .update(emailEventsTable)
              .set({
                status: "applied",
                applicationId: targetAppId,
                matchMethod: "user_link",
                resolvedAt: new Date(),
                contentFingerprint: fingerprint,
              })
              .where(eq(emailEventsTable.id, emailEvent.id));

            return { action: "timeline_only", applicationId: targetAppId };
          }
        }

        const newStatus = (aiResult.suggested_status || existingApp.status).toUpperCase();
        const isTerminal = TERMINAL_STATUSES.has(newStatus);
        const statusChanged = newStatus !== existingApp.status;

        const updates: Partial<PlacementApplication> = {};
        const beforeDiff: Record<string, any> = {};
        const afterDiff: Record<string, any> = {};

        // Helper to track diffs
        const setField = (field: keyof PlacementApplication, val: any) => {
          const current = (existingApp as any)[field];
          const currSerialized = current instanceof Date ? current.toISOString() : current;
          const valSerialized = val instanceof Date ? val.toISOString() : val;

          if (currSerialized !== valSerialized) {
            beforeDiff[field] = currSerialized;
            afterDiff[field] = valSerialized;
            (updates as any)[field] = val;
          }
        };

        // Status
        setField("status", newStatus);

        // Stage detail if provided
        if (aiResult.stage_detail) {
          setField("stageDetail", aiResult.stage_detail);
        }

        // lastEmailAt
        setField("lastEmailAt", receivedAt);

        // next_* and action_* logic
        if (isTerminal) {
          setField("nextAt", null);
          setField("nextAtHasTime", false);
          setField("nextType", null);
          setField("nextDate", null);
          setField("actionRequired", false);
          if (aiResult.action_note !== undefined) {
            setField("actionNote", aiResult.action_note ?? null);
          }
          if (newStatus === "REJECTED") {
            setField("rejectionDate", formatDateInTimezone(receivedAt, timezone));
            setField("rejectionReason", aiResult.rejection_reason ?? null);
            const round = mapRejectionRound(existingApp.status, existingApp.stageDetail || aiResult.stage_detail);
            setField("rejectionRound", round);
          }
        } else {
          // Newer email replaces action state
          setField("actionRequired", Boolean(aiResult.action_required));
          setField("actionNote", aiResult.action_note ?? null);

          if (aiResult.next_at) {
            const nextAt = new Date(aiResult.next_at);
            setField("nextAt", nextAt);
            setField("nextAtHasTime", Boolean(aiResult.next_at_has_time));
            setField("nextType", aiResult.next_type ?? null);
            setField("nextDate", formatDateInTimezone(nextAt, timezone));
          } else if (statusChanged) {
            // Status changed and email gives none -> clear them
            setField("nextAt", null);
            setField("nextAtHasTime", false);
            setField("nextType", null);
            setField("nextDate", null);
          }
          // If status unchanged and email gives none -> keep existing
        }

        // Fill-only-if-empty
        if (!existingApp.role && aiResult.role) {
          setField("role", aiResult.role.trim().slice(0, 160));
        }
        if (!existingApp.location && aiResult.location) {
          setField("location", aiResult.location.trim().slice(0, 160));
        }
        if (!existingApp.contactName && aiResult.contact_name && !isGenericContact(aiResult.contact_name, null)) {
          setField("contactName", aiResult.contact_name.trim().slice(0, 160));
        }
        const incomingEmail = aiResult.contact_email || emailEvent.fromAddress;
        if (!existingApp.contactEmailOrPhone && incomingEmail && !isGenericContact(null, incomingEmail)) {
          setField("contactEmailOrPhone", incomingEmail.trim().slice(0, 254));
        }

        // Lower appliedDate for source=email applications if older
        if (existingApp.source === "email") {
          const emailDateStr = formatDateInTimezone(receivedAt, timezone);
          if (emailDateStr && existingApp.appliedDate && emailDateStr < existingApp.appliedDate) {
            setField("appliedDate", emailDateStr);
          }
        }

        // Update database if there are any changes
        if (Object.keys(updates).length > 0) {
          updates.updatedAt = new Date();
          await tx
            .update(placementApplicationsTable)
            .set(updates)
            .where(eq(placementApplicationsTable.id, targetAppId));
        }

        // Record application event
        await tx.insert(applicationEventsTable).values({
          userId,
          applicationId: targetAppId,
          emailEventId: emailEvent.id,
          kind: "updated",
          occurredAt: receivedAt,
          fromStatus: existingApp.status,
          toStatus: newStatus,
          stageDetail: updates.stageDetail || existingApp.stageDetail,
          summary: aiResult.summary ?? null,
          before: Object.keys(beforeDiff).length > 0 ? beforeDiff : null,
          after: Object.keys(afterDiff).length > 0 ? afterDiff : null,
          appliedBy,
        });

        await tx
          .update(emailEventsTable)
          .set({
            status: "applied",
            applicationId: targetAppId,
            matchMethod: overrideApplicationId ? "user_link" : opts.decision.matchMethod,
            resolvedAt: new Date(),
            contentFingerprint: fingerprint,
          })
          .where(eq(emailEventsTable.id, emailEvent.id));

        return { action: "update", applicationId: targetAppId };
      }

      throw new Error(`Unhandled action: ${opts.decision.action}`);
    });
  }
}
