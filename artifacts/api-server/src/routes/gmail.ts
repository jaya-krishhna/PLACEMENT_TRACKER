import { Router, type IRouter } from "express";
import { and, count, desc, eq } from "drizzle-orm";
import {
  db,
  connectedAccountsTable,
  senderRulesTable,
  emailEventsTable,
} from "@workspace/db";
import { getSessionUser } from "../lib/placement-session";
import { GmailAuthService } from "../services/gmail-auth.service";
import { GmailClient } from "../lib/gmail-client";
import { SenderService } from "../services/sender.service";
import { SyncService } from "../services/sync.service";
import { ProcessingService } from "../services/processing.service";
import { MatchingService } from "../services/matcher/matching.service";

const router: IRouter = Router();

// Middleware helper to ensure session user is present
async function requireAuth(req: any, res: any) {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return null;
  }
  return user;
}

// ─── GET /gmail/status ────────────────────────────────────────────────────────
router.get("/gmail/status", async (req, res): Promise<void> => {
  const user = await requireAuth(req, res);
  if (!user) return;

  try {
    // Check env vars first so fail-fast behavior is honored
    GmailAuthService.getEnvConfig();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
    return;
  }

  const [account] = await db
    .select()
    .from(connectedAccountsTable)
    .where(
      and(
        eq(connectedAccountsTable.userId, user.id),
        eq(connectedAccountsTable.provider, "google"),
      ),
    )
    .limit(1);

  if (!account) {
    res.json({
      connected: false,
      googleEmail: null,
      google_email: null,
      label: null,
      lastSyncedAt: null,
      last_synced_at: null,
      accountStatus: null,
      status: null,
      senderCounts: { pending: 0, approved: 0, excluded: 0 },
      emailEventCounts: {
        pending_sender: 0,
        queued: 0,
        processing: 0,
        extracted: 0,
        applied: 0,
        needs_review: 0,
        ignored: 0,
        failed: 0,
      },
    });
    return;
  }

  // Sender counts
  const senderRows = await db
    .select({ status: senderRulesTable.status, count: count() })
    .from(senderRulesTable)
    .where(eq(senderRulesTable.userId, user.id))
    .groupBy(senderRulesTable.status);

  const senderCounts = { pending: 0, approved: 0, excluded: 0 };
  for (const row of senderRows) {
    if (row.status in senderCounts) {
      senderCounts[row.status as keyof typeof senderCounts] = Number(row.count);
    }
  }

  // Email event counts
  const eventRows = await db
    .select({ status: emailEventsTable.status, count: count() })
    .from(emailEventsTable)
    .where(eq(emailEventsTable.userId, user.id))
    .groupBy(emailEventsTable.status);

  const emailEventCounts = {
    pending_sender: 0,
    queued: 0,
    processing: 0,
    extracted: 0,
    applied: 0,
    needs_review: 0,
    ignored: 0,
    failed: 0,
  };
  for (const row of eventRows) {
    if (row.status in emailEventCounts) {
      emailEventCounts[row.status as keyof typeof emailEventCounts] = Number(row.count);
    }
  }

  const label =
    account.labelId && account.labelName
      ? { id: account.labelId, name: account.labelName }
      : null;

  const lastSyncedIso = account.lastSyncedAt
    ? account.lastSyncedAt.toISOString()
    : null;

  res.json({
    connected: true,
    googleEmail: account.googleEmail,
    google_email: account.googleEmail,
    label,
    lastSyncedAt: lastSyncedIso,
    last_synced_at: lastSyncedIso,
    accountStatus: account.status,
    status: account.status,
    senderCounts,
    emailEventCounts,
  });
});

// ─── GET /gmail/connect ───────────────────────────────────────────────────────
router.get("/gmail/connect", async (req, res): Promise<void> => {
  const user = await requireAuth(req, res);
  if (!user) return;

  try {
    const authUrl = GmailAuthService.getAuthorizationUrl(user.id);
    res.json({ url: authUrl });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /gmail/callback ──────────────────────────────────────────────────────
router.get("/gmail/callback", async (req, res): Promise<void> => {
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;

  let config;
  try {
    config = GmailAuthService.getEnvConfig();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
    return;
  }

  if (!code || !state) {
    res.status(400).json({ error: "Missing authorization code or state parameter." });
    return;
  }

  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: "Session expired or invalid. Please sign in." });
    return;
  }

  const isValidState = GmailAuthService.validateState(state, user.id);
  if (!isValidState) {
    res.status(400).json({
      error: "Invalid or expired state parameter. Please restart Google connection.",
    });
    return;
  }

  try {
    await GmailAuthService.handleAuthCallback(user.id, code);
    // Redirect to frontend Gmail settings page
    res.redirect(`${config.appBaseUrl}/settings/gmail`);
  } catch (err: any) {
    res.status(500).json({ error: `OAuth callback error: ${err.message}` });
  }
});

// ─── DELETE /gmail/connection ─────────────────────────────────────────────────
router.delete("/gmail/connection", async (req, res): Promise<void> => {
  const user = await requireAuth(req, res);
  if (!user) return;

  const deleteEmailData =
    String(req.query.deleteEmailData || "").toLowerCase() === "true";

  try {
    // Best effort revocation
    try {
      const auth = await GmailAuthService.getAuthorizedClient(user.id);
      await GmailClient.revokeCredentials(auth);
    } catch {
      // Continue even if Google revocation fails (e.g. already revoked)
    }

    // Delete connected account row
    await db
      .delete(connectedAccountsTable)
      .where(
        and(
          eq(connectedAccountsTable.userId, user.id),
          eq(connectedAccountsTable.provider, "google"),
        ),
      );

    if (deleteEmailData) {
      // Delete email_events and sender_rules for this user
      // Applications are ALWAYS kept as instructed
      await db
        .delete(emailEventsTable)
        .where(eq(emailEventsTable.userId, user.id));
      await db
        .delete(senderRulesTable)
        .where(eq(senderRulesTable.userId, user.id));
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /gmail/labels ────────────────────────────────────────────────────────
router.get("/gmail/labels", async (req, res): Promise<void> => {
  const user = await requireAuth(req, res);
  if (!user) return;

  try {
    const auth = await GmailAuthService.getAuthorizedClient(user.id);
    const labels = await GmailClient.listLabels(auth);
    res.json(labels);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /gmail/label ─────────────────────────────────────────────────────────
router.put("/gmail/label", async (req, res): Promise<void> => {
  const user = await requireAuth(req, res);
  if (!user) return;

  const labelId = req.body?.labelId || req.body?.label_id;
  if (!labelId || typeof labelId !== "string") {
    res.status(400).json({ error: "labelId is required." });
    return;
  }

  try {
    const auth = await GmailAuthService.getAuthorizedClient(user.id);
    const labels = await GmailClient.listLabels(auth);
    const selectedLabel = labels.find((l) => l.id === labelId.trim());

    if (!selectedLabel) {
      res.status(404).json({ error: "Label not found, please reselect." });
      return;
    }

    const [account] = await db
      .select()
      .from(connectedAccountsTable)
      .where(
        and(
          eq(connectedAccountsTable.userId, user.id),
          eq(connectedAccountsTable.provider, "google"),
        ),
      )
      .limit(1);

    if (!account) {
      res.status(404).json({ error: "No connected Gmail account found." });
      return;
    }

    // If the label changes, reset last_synced_at as instructed
    const hasChanged = account.labelId !== selectedLabel.id;
    await db
      .update(connectedAccountsTable)
      .set({
        labelId: selectedLabel.id,
        labelName: selectedLabel.name,
        ...(hasChanged ? { lastSyncedAt: null } : {}),
      })
      .where(eq(connectedAccountsTable.id, account.id));

    res.json({
      success: true,
      labelId: selectedLabel.id,
      labelName: selectedLabel.name,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /gmail/senders ───────────────────────────────────────────────────────
router.get("/gmail/senders", async (req, res): Promise<void> => {
  const user = await requireAuth(req, res);
  if (!user) return;

  const statusFilter = req.query.status as string | undefined;

  let query = db
    .select()
    .from(senderRulesTable)
    .where(
      statusFilter && ["pending", "approved", "excluded"].includes(statusFilter)
        ? and(
            eq(senderRulesTable.userId, user.id),
            eq(senderRulesTable.status, statusFilter),
          )
        : eq(senderRulesTable.userId, user.id),
    )
    .orderBy(desc(senderRulesTable.messageCount), desc(senderRulesTable.updatedAt));

  const senders = await query;
  res.json(senders);
});

// ─── POST /gmail/senders ──────────────────────────────────────────────────────
router.post("/gmail/senders", async (req, res): Promise<void> => {
  const user = await requireAuth(req, res);
  if (!user) return;

  const { kind, value } = req.body || {};
  if (!kind || !["address", "domain"].includes(kind)) {
    res.status(400).json({ error: "kind must be 'address' or 'domain'." });
    return;
  }
  if (!value || typeof value !== "string" || !value.trim()) {
    res.status(400).json({ error: "value is required." });
    return;
  }

  const cleanValue = value.trim().toLowerCase();

  try {
    const [rule] = await db
      .insert(senderRulesTable)
      .values({
        userId: user.id,
        kind,
        value: cleanValue,
        status: "approved",
        source: "manual",
        messageCount: 0,
      })
      .onConflictDoUpdate({
        target: [senderRulesTable.userId, senderRulesTable.kind, senderRulesTable.value],
        set: {
          status: "approved",
          source: "manual",
          updatedAt: new Date(),
        },
      })
      .returning();

    // Trigger update on matching email_events
    await SenderService.onRuleStatusChanged(user.id, rule, "approved");

    res.status(201).json(rule);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PATCH /gmail/senders/:id ─────────────────────────────────────────────────
router.patch("/gmail/senders/:id", async (req, res): Promise<void> => {
  const user = await requireAuth(req, res);
  if (!user) return;

  const ruleId = req.params.id;
  const { status } = req.body || {};

  if (!status || !["pending", "approved", "excluded"].includes(status)) {
    res.status(400).json({ error: "status must be 'pending', 'approved', or 'excluded'." });
    return;
  }

  const [rule] = await db
    .select()
    .from(senderRulesTable)
    .where(
      and(
        eq(senderRulesTable.id, ruleId),
        eq(senderRulesTable.userId, user.id),
      ),
    )
    .limit(1);

  if (!rule) {
    res.status(404).json({ error: "Sender rule not found." });
    return;
  }

  const [updated] = await db
    .update(senderRulesTable)
    .set({
      status,
      updatedAt: new Date(),
    })
    .where(eq(senderRulesTable.id, rule.id))
    .returning();

  // Update matching email_events
  await SenderService.onRuleStatusChanged(user.id, updated, status);

  res.json(updated);
});

// ─── POST /gmail/sync ─────────────────────────────────────────────────────────
router.post("/gmail/sync", async (req, res): Promise<void> => {
  const user = await requireAuth(req, res);
  if (!user) return;

  try {
    const result = await SyncService.syncMetadata(user.id);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ─── POST /gmail/process ──────────────────────────────────────────────────────
router.post("/gmail/process", async (req, res): Promise<void> => {
  const user = await requireAuth(req, res);
  if (!user) return;

  try {
    const limit = typeof req.body?.limit === "number" ? req.body.limit : 50;
    const result = await ProcessingService.processQueued(user.id, limit);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ─── POST /gmail/apply ─────────────────────────────────────────────────────────
router.post("/gmail/apply", async (req, res): Promise<void> => {
  const user = await requireAuth(req, res);
  if (!user) return;

  try {
    const result = await MatchingService.applyExtracted(user.id);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /gmail/events ────────────────────────────────────────────────────────
router.get("/gmail/events", async (req, res): Promise<void> => {
  const user = await requireAuth(req, res);
  if (!user) return;

  try {
    const statusFilter = typeof req.query.status === "string" && req.query.status.trim()
      ? req.query.status.trim()
      : undefined;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const whereClause = statusFilter && statusFilter !== "all"
      ? and(eq(emailEventsTable.userId, user.id), eq(emailEventsTable.status, statusFilter))
      : eq(emailEventsTable.userId, user.id);

    const [totalRow] = await db
      .select({ count: count() })
      .from(emailEventsTable)
      .where(whereClause);
    const total = Number(totalRow?.count || 0);

    const items = await db
      .select()
      .from(emailEventsTable)
      .where(whereClause)
      .orderBy(desc(emailEventsTable.receivedAt), desc(emailEventsTable.createdAt))
      .limit(limit)
      .offset(offset);

    const formattedItems = items.map((item) => ({
      id: item.id,
      gmailMessageId: item.gmailMessageId,
      threadId: item.threadId,
      fromAddress: item.fromAddress,
      fromDomain: item.fromDomain,
      subject: item.subject,
      receivedAt: item.receivedAt ? item.receivedAt.toISOString() : null,
      status: item.status,
      confidence: item.confidence ? String(item.confidence) : null,
      aiResult: item.aiResult ? (item.aiResult as any) : null,
      error: item.error,
      retryCount: item.retryCount || 0,
      createdAt: item.createdAt.toISOString(),
    }));

    res.json({
      items: formattedItems,
      total,
      page,
      limit,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /gmail/events/:id/reprocess ──────────────────────────────────────────
router.post("/gmail/events/:id/reprocess", async (req, res): Promise<void> => {
  const user = await requireAuth(req, res);
  if (!user) return;

  const eventId = req.params.id;
  try {
    const updated = await ProcessingService.reprocessEvent(user.id, eventId);
    res.json({
      id: updated.id,
      gmailMessageId: updated.gmailMessageId,
      threadId: updated.threadId,
      fromAddress: updated.fromAddress,
      fromDomain: updated.fromDomain,
      subject: updated.subject,
      receivedAt: updated.receivedAt ? updated.receivedAt.toISOString() : null,
      status: updated.status,
      confidence: updated.confidence ? String(updated.confidence) : null,
      aiResult: updated.aiResult ? (updated.aiResult as any) : null,
      error: updated.error,
      retryCount: updated.retryCount || 0,
      createdAt: updated.createdAt.toISOString(),
    });
  } catch (err: any) {
    const isNotFound = err.message?.includes("not found");
    const isBadStatus = err.message?.includes("Cannot reprocess");
    res.status(isNotFound ? 404 : isBadStatus ? 400 : 500).json({ error: err.message });
  }
});

export default router;
