import { Router, type IRouter } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  emailEventsTable,
  placementApplicationsTable,
  type EmailEvent,
} from "@workspace/db";
import {
  GetReviewQueueResponse,
  ResolveReviewItemBody,
  ResolveReviewItemParams,
  ResolveReviewItemResponse,
} from "@workspace/api-zod";
import { getSessionUser } from "../lib/placement-session";
import { ApplyService } from "../services/matcher/apply.service";
import { logger } from "../lib/logger";

const router: IRouter = Router();

async function requireAuth(req: any, res: any) {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return null;
  }
  return user;
}

// ─── GET /review ─────────────────────────────────────────────────────────────
router.get("/review", async (req, res): Promise<void> => {
  const user = await requireAuth(req, res);
  if (!user) return;

  try {
    const reviewEvents = await db
      .select()
      .from(emailEventsTable)
      .where(
        and(
          eq(emailEventsTable.userId, user.id),
          eq(emailEventsTable.status, "needs_review"),
        ),
      )
      .orderBy(desc(emailEventsTable.receivedAt), desc(emailEventsTable.createdAt));

    // Collect all candidate application ids
    const allCandidateIds = new Set<string>();
    for (const event of reviewEvents) {
      if (Array.isArray(event.candidateApplicationIds)) {
        for (const id of event.candidateApplicationIds) {
          if (typeof id === "string" && id.trim()) {
            allCandidateIds.add(id);
          }
        }
      }
    }

    // Fetch candidate applications
    const candidateAppMap = new Map<string, any>();
    if (allCandidateIds.size > 0) {
      const candidateApps = await db
        .select({
          id: placementApplicationsTable.id,
          companyName: placementApplicationsTable.companyName,
          role: placementApplicationsTable.role,
          status: placementApplicationsTable.status,
          stageDetail: placementApplicationsTable.stageDetail,
          appliedDate: placementApplicationsTable.appliedDate,
        })
        .from(placementApplicationsTable)
        .where(
          and(
            eq(placementApplicationsTable.userId, user.id),
            inArray(placementApplicationsTable.id, Array.from(allCandidateIds)),
          ),
        );

      for (const app of candidateApps) {
        candidateAppMap.set(app.id, app);
      }
    }

    const items = reviewEvents.map((event) => {
      const aiResult = (event.aiResult as any) || {};

      let candidateApps: any[] = [];
      if (Array.isArray(event.candidateApplicationIds)) {
        candidateApps = event.candidateApplicationIds
          .map((id) => candidateAppMap.get(id))
          .filter(Boolean);
      }

      return {
        id: event.id,
        gmailMessageId: event.gmailMessageId,
        threadId: event.threadId,
        subject: event.subject,
        from: event.fromAddress,
        fromDomain: event.fromDomain,
        receivedAt: event.receivedAt ? event.receivedAt.toISOString() : null,
        reviewReason: event.reviewReason || "needs_review",
        summary: aiResult.summary ?? null,
        company: aiResult.company ?? null,
        role: aiResult.role ?? null,
        suggestedStatus: aiResult.suggested_status ?? null,
        stageDetail: aiResult.stage_detail ?? null,
        nextAt: aiResult.next_at ?? null,
        nextAtHasTime: Boolean(aiResult.next_at_has_time),
        actionRequired: Boolean(aiResult.action_required),
        actionNote: aiResult.action_note ?? null,
        candidateApplications: candidateApps,
      };
    });

    res.json(GetReviewQueueResponse.parse(items));
  } catch (err: any) {
    logger.error({ error: err?.message }, "Failed to fetch review queue");
    res.status(500).json({ error: "Failed to fetch review queue." });
  }
});

// ─── POST /review/:emailEventId/resolve ───────────────────────────────────────
router.post("/review/:emailEventId/resolve", async (req, res): Promise<void> => {
  const user = await requireAuth(req, res);
  if (!user) return;

  const params = ResolveReviewItemParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid email event id." });
    return;
  }

  const body = ResolveReviewItemBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid resolve action." });
    return;
  }

  const emailEventId = params.data.emailEventId;

  const [emailEvent] = await db
    .select()
    .from(emailEventsTable)
    .where(
      and(
        eq(emailEventsTable.id, emailEventId),
        eq(emailEventsTable.userId, user.id),
      ),
    )
    .limit(1);

  if (!emailEvent) {
    res.status(404).json({ error: "Email event not found." });
    return;
  }

  try {
    const { action, applicationId } = body.data;

    if (action === "dismiss") {
      await db
        .update(emailEventsTable)
        .set({
          status: "ignored",
          reviewReason: null,
          resolvedAt: new Date(),
        })
        .where(eq(emailEventsTable.id, emailEvent.id));

      res.json(ResolveReviewItemResponse.parse({ success: true }));
      return;
    }

    if (action === "create") {
      await ApplyService.applyDecision({
        userId: user.id,
        emailEvent,
        decision: {
          action: "create",
          matchMethod: "user_create",
        },
        appliedBy: "review",
      });

      res.json(ResolveReviewItemResponse.parse({ success: true }));
      return;
    }

    if (action === "link") {
      if (!applicationId) {
        res.status(400).json({ error: "applicationId is required when linking." });
        return;
      }

      await ApplyService.applyDecision({
        userId: user.id,
        emailEvent,
        decision: {
          action: "update",
          matchMethod: "user_link",
        },
        overrideApplicationId: applicationId,
        appliedBy: "review",
      });

      res.json(ResolveReviewItemResponse.parse({ success: true }));
      return;
    }

    res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err: any) {
    logger.error({ error: err?.message, emailEventId }, "Failed to resolve review item");
    res.status(500).json({ error: err.message || "Failed to resolve review item." });
  }
});

export default router;

