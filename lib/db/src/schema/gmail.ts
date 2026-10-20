import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { placementApplicationsTable, placementUsersTable } from "./placement-tracker";

export const connectedAccountsTable = pgTable(
  "connected_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => placementUsersTable.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    googleEmail: text("google_email"),
    encryptedRefreshToken: text("encrypted_refresh_token"),
    labelId: text("label_id"),
    labelName: text("label_name"),
    status: text("status").notNull().default("active"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("connected_accounts_user_provider_unique").on(
      table.userId,
      table.provider,
    ),
    index("connected_accounts_user_id_idx").on(table.userId),
  ],
);

export const senderRulesTable = pgTable(
  "sender_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => placementUsersTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // 'address' | 'domain'
    value: text("value").notNull(), // lowercased
    status: text("status").notNull().default("pending"), // 'pending' | 'approved' | 'excluded'
    source: text("source").notNull().default("detected"), // 'detected' | 'manual'
    messageCount: integer("message_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("sender_rules_user_kind_value_unique").on(
      table.userId,
      table.kind,
      table.value,
    ),
    index("sender_rules_user_id_idx").on(table.userId),
    index("sender_rules_user_status_idx").on(table.userId, table.status),
  ],
);

export const emailEventsTable = pgTable(
  "email_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => placementUsersTable.id, { onDelete: "cascade" }),
    gmailMessageId: text("gmail_message_id").notNull(),
    threadId: text("thread_id"),
    fromAddress: text("from_address"),
    fromDomain: text("from_domain"),
    subject: text("subject"),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    status: text("status").notNull().default("pending_sender"), // 'pending_sender' | 'queued' | 'processing' | 'applied' | 'needs_review' | 'ignored' | 'failed'
    aiResult: jsonb("ai_result"),
    confidence: numeric("confidence"),
    retryCount: integer("retry_count").notNull().default(0),
    contentFingerprint: text("content_fingerprint"),
    matchMethod: text("match_method"),
    reviewReason: text("review_reason"),
    candidateApplicationIds: jsonb("candidate_application_ids"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    applicationId: uuid("application_id").references(
      () => placementApplicationsTable.id,
      { onDelete: "set null" },
    ),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("email_events_gmail_message_id_unique").on(table.gmailMessageId),
    index("email_events_user_thread_idx").on(table.userId, table.threadId),
    index("email_events_user_status_idx").on(table.userId, table.status),
    index("email_events_user_status_received_idx").on(
      table.userId,
      table.status,
      table.receivedAt,
    ),
    index("email_events_user_fingerprint_idx").on(
      table.userId,
      table.contentFingerprint,
    ),
  ],
);

export const applicationEventsTable = pgTable(
  "application_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => placementUsersTable.id, { onDelete: "cascade" }),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => placementApplicationsTable.id, { onDelete: "cascade" }),
    emailEventId: uuid("email_event_id").references(
      () => emailEventsTable.id,
      { onDelete: "set null" },
    ),
    kind: text("kind").notNull(), // 'created' | 'updated' | 'historical' | 'undone'
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    stageDetail: text("stage_detail"),
    summary: text("summary"),
    before: jsonb("before"),
    after: jsonb("after"),
    appliedBy: text("applied_by").notNull(), // 'auto' | 'review'
    undoneAt: timestamp("undone_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("application_events_app_occurred_idx").on(
      table.applicationId,
      table.occurredAt,
    ),
    index("application_events_user_idx").on(table.userId),
  ],
);

export type ConnectedAccount = typeof connectedAccountsTable.$inferSelect;
export type SenderRule = typeof senderRulesTable.$inferSelect;
export type EmailEvent = typeof emailEventsTable.$inferSelect;
export type ApplicationEvent = typeof applicationEventsTable.$inferSelect;

