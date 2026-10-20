import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  connectedAccountsTable,
  emailEventsTable,
  senderRulesTable,
} from "@workspace/db";
import { GmailAuthService } from "./gmail-auth.service";
import { GmailClient } from "../lib/gmail-client";
import { parseFromHeader, SenderService } from "./sender.service";

export interface SyncResult {
  newMessages: number;
  new: number;
  queued: number;
  pendingSender: number;
  pending_sender: number;
  ignored: number;
}

// In-process lock per user
const activeUserSyncs = new Set<string>();

export class SyncService {
  /**
   * Synchronizes email metadata for a given user from their selected Gmail label.
   */
  static async syncMetadata(userId: string): Promise<SyncResult> {
    if (activeUserSyncs.has(userId)) {
      throw new Error("A sync operation is already in progress for this account.");
    }

    activeUserSyncs.add(userId);
    try {
      return await this._doSyncMetadata(userId);
    } finally {
      activeUserSyncs.delete(userId);
    }
  }

  private static async _doSyncMetadata(userId: string): Promise<SyncResult> {
    const [account] = await db
      .select()
      .from(connectedAccountsTable)
      .where(
        and(
          eq(connectedAccountsTable.userId, userId),
          eq(connectedAccountsTable.provider, "google"),
        ),
      )
      .limit(1);

    if (!account) {
      throw new Error("No connected Gmail account found for user.");
    }
    if (account.status === "needs_reconnect") {
      throw new Error("Account needs reconnection before sync can continue.");
    }
    if (!account.labelId) {
      throw new Error("No Gmail label has been selected for monitoring yet.");
    }

    const auth = await GmailAuthService.getAuthorizedClient(userId);

    // Verify label exists on Gmail
    let userLabels;
    try {
      userLabels = await GmailClient.listLabels(auth);
    } catch (err: any) {
      if (err?.code === 404 || String(err?.message || "").includes("Not Found")) {
        throw new Error("Label not found, please reselect.");
      }
      throw err;
    }

    const labelExists = userLabels.some((l) => l.id === account.labelId);
    if (!labelExists) {
      throw new Error("Label not found, please reselect.");
    }

    // Load existing message IDs for deduplication
    const existingRows = await db
      .select({ gmailMessageId: emailEventsTable.gmailMessageId })
      .from(emailEventsTable)
      .where(eq(emailEventsTable.userId, userId));

    const existingMessageIds = new Set(existingRows.map((r) => r.gmailMessageId));
    const isInitialSync = existingMessageIds.size === 0;

    let pageToken: string | undefined = undefined;
    let shouldStop = false;
    const messageIdsToFetch: string[] = [];

    // Paginate newest-first
    do {
      let pageResult;
      try {
        pageResult = await GmailClient.listMessageIds(auth, account.labelId, pageToken);
      } catch (err: any) {
        if (err?.code === 404 || String(err?.message || "").includes("Not Found")) {
          throw new Error("Label not found, please reselect.");
        }
        throw err;
      }

      for (const id of pageResult.messageIds) {
        if (existingMessageIds.has(id)) {
          // Reached already-known messages in newest-first feed
          if (!isInitialSync) {
            shouldStop = true;
            break;
          }
        } else {
          messageIdsToFetch.push(id);
        }
      }

      if (shouldStop) break;
      pageToken = pageResult.nextPageToken;
    } while (pageToken);

    let queuedCount = 0;
    let pendingSenderCount = 0;
    let ignoredCount = 0;
    const addressCounts = new Map<string, number>();

    // Fetch metadata for each new message and persist
    for (const msgId of messageIdsToFetch) {
      // Re-verify against set to avoid duplicates within same sync
      if (existingMessageIds.has(msgId)) continue;
      existingMessageIds.add(msgId);

      try {
        const metadata = await GmailClient.getMessageMetadata(auth, msgId);
        const { address, domain } = parseFromHeader(metadata.from);

        const { status: senderStatus } = await SenderService.resolveStatus(
          userId,
          address,
          domain,
        );

        let eventStatus: "queued" | "ignored" | "pending_sender";
        if (senderStatus === "approved") {
          eventStatus = "queued";
          queuedCount++;
        } else if (senderStatus === "excluded") {
          eventStatus = "ignored";
          ignoredCount++;
        } else {
          eventStatus = "pending_sender";
          pendingSenderCount++;
        }

        // Track address message count
        if (address) {
          addressCounts.set(address, (addressCounts.get(address) || 0) + 1);
        }

        await db
          .insert(emailEventsTable)
          .values({
            userId,
            gmailMessageId: metadata.id,
            threadId: metadata.threadId,
            fromAddress: address || null,
            fromDomain: domain || null,
            subject: metadata.subject || null,
            receivedAt: new Date(metadata.internalDate),
            status: eventStatus,
          })
          .onConflictDoNothing();
      } catch (err) {
        // Individual message error should not crash the entire sync batch
        console.error(`Error processing message metadata for ${msgId}:`, err);
      }
    }

    // Update message counts on sender_rules for detected/matching senders
    for (const [address, count] of addressCounts.entries()) {
      await db
        .update(senderRulesTable)
        .set({
          messageCount: sql`${senderRulesTable.messageCount} + ${count}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(senderRulesTable.userId, userId),
            eq(senderRulesTable.kind, "address"),
            eq(senderRulesTable.value, address),
          ),
        );
    }

    // Also update domain rule message counts if any
    const allDomainRules = await db
      .select({ id: senderRulesTable.id, value: senderRulesTable.value })
      .from(senderRulesTable)
      .where(
        and(
          eq(senderRulesTable.userId, userId),
          eq(senderRulesTable.kind, "domain"),
        ),
      );

    for (const domainRule of allDomainRules) {
      let domainTotal = 0;
      for (const [address, count] of addressCounts.entries()) {
        const atIdx = address.lastIndexOf("@");
        const domain = atIdx !== -1 ? address.slice(atIdx + 1) : "";
        if (domain === domainRule.value || domain.endsWith(`.${domainRule.value}`)) {
          domainTotal += count;
        }
      }
      if (domainTotal > 0) {
        await db
          .update(senderRulesTable)
          .set({
            messageCount: sql`${senderRulesTable.messageCount} + ${domainTotal}`,
            updatedAt: new Date(),
          })
          .where(eq(senderRulesTable.id, domainRule.id));
      }
    }

    // Update last_synced_at
    const now = new Date();
    await db
      .update(connectedAccountsTable)
      .set({ lastSyncedAt: now })
      .where(eq(connectedAccountsTable.id, account.id));

    const totalNew = messageIdsToFetch.length;

    return {
      newMessages: totalNew,
      new: totalNew,
      queued: queuedCount,
      pendingSender: pendingSenderCount,
      pending_sender: pendingSenderCount,
      ignored: ignoredCount,
    };
  }
}

