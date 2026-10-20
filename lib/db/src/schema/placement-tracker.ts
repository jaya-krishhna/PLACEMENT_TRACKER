import {
  boolean,
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const placementUsersTable = pgTable(
  "placement_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 254 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("placement_users_email_idx").on(table.email)],
);

export const placementSessionsTable = pgTable(
  "placement_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => placementUsersTable.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("placement_sessions_token_hash_idx").on(table.tokenHash),
    index("placement_sessions_user_id_idx").on(table.userId),
  ],
);

export const placementApplicationsTable = pgTable(
  "placement_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => placementUsersTable.id, { onDelete: "cascade" }),
    companyName: varchar("company_name", { length: 160 }).notNull(),
    role: varchar("role", { length: 160 }),
    packageLpa: numeric("package_lpa", {
      precision: 8,
      scale: 2,
      mode: "number",
    }),
    location: varchar("location", { length: 160 }),
    appliedDate: date("applied_date", { mode: "string" }).notNull(),
    mode: varchar("mode", { length: 32 }).notNull(),
    status: varchar("status", { length: 24 }).notNull(),
    nextDate: date("next_date", { mode: "string" }),
    contactName: varchar("contact_name", { length: 160 }),
    contactEmailOrPhone: varchar("contact_email_or_phone", { length: 254 }),
    jobLink: varchar("job_link", { length: 2048 }),
    notes: text("notes"),
    rejectionRound: varchar("rejection_round", { length: 64 }),
    rejectionDate: date("rejection_date", { mode: "string" }),
    rejectionReason: text("rejection_reason"),
    stageDetail: text("stage_detail"),
    source: varchar("source", { length: 32 }).notNull().default("manual"),
    lastEmailAt: timestamp("last_email_at", { withTimezone: true }),
    nextAt: timestamp("next_at", { withTimezone: true }),
    nextAtHasTime: boolean("next_at_has_time").notNull().default(false),
    nextType: text("next_type"),
    actionRequired: boolean("action_required").notNull().default(false),
    actionNote: text("action_note"),
    isSample: boolean("is_sample").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("placement_applications_user_id_idx").on(table.userId),
    index("placement_applications_user_next_date_idx").on(
      table.userId,
      table.nextDate,
    ),
    index("placement_applications_user_status_idx").on(
      table.userId,
      table.status,
    ),
  ],
);

export const reminderDismissalsTable = pgTable(
  "reminder_dismissals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => placementUsersTable.id, { onDelete: "cascade" }),
    reminderKey: text("reminder_key").notNull(),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("reminder_dismissals_user_key_idx").on(
      table.userId,
      table.reminderKey,
    ),
    index("reminder_dismissals_user_id_idx").on(table.userId),
  ],
);

export type PlacementUser = typeof placementUsersTable.$inferSelect;
export type PlacementApplication =
  typeof placementApplicationsTable.$inferSelect;
export type ReminderDismissal = typeof reminderDismissalsTable.$inferSelect;
