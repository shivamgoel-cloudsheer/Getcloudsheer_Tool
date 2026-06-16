import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  uniqueIndex,
  index,
  primaryKey,
  uuid,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

// ---------------------------------------------------------------------------
// Auth.js adapter tables (shapes required by @auth/drizzle-adapter)
// ---------------------------------------------------------------------------

export const users = pgTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
  // Throttle for the reply-detection poller
  lastReplyCheckAt: timestamp("last_reply_check_at"),
});

export const accounts = pgTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [
    primaryKey({ columns: [account.provider, account.providerAccountId] }),
  ]
);

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })]
);

// ---------------------------------------------------------------------------
// App tables
// ---------------------------------------------------------------------------

export type CampaignStatus =
  | "draft"
  | "sending"
  | "scheduled"
  | "sent"
  | "failed";

export type RecipientStatus =
  | "pending"
  | "suppressed"
  | "scheduled"
  | "sent"
  | "delivered"
  | "opened"
  | "clicked"
  | "replied"
  | "bounced"
  | "complained"
  | "failed";

export type Variant = "A" | "B";

// Drip/stagger settings, persisted so background follow-ups reuse the same
// window, gap, daily cap, weekend rule, and warm-up as the initial send.
export type StoredStaggerConfig = {
  gapMinutes: number;
  dailyCap: number;
  windowStart: string;
  windowEnd: string;
  skipWeekends: boolean;
  timeZone: string;
  warmup: boolean;
  perRecipientTimeZone?: boolean;
};

export const campaigns = pgTable(
  "campaign",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sheetId: text("sheet_id").notNull(),
    sheetUrl: text("sheet_url").notNull(),
    // Worksheet/tab the recipients came from (null = first tab); status
    // write-back targets this same tab.
    sheetTab: text("sheet_tab"),
    subjectTemplate: text("subject_template").notNull(),
    bodyTemplate: text("body_template").notNull(),
    // Optional A/B variant; when set, recipients are split 50/50
    subjectTemplateB: text("subject_template_b"),
    bodyTemplateB: text("body_template_b"),
    // Per-campaign sender ("Name <email@domain>"); falls back to
    // DEFAULT_FROM_ADDRESS. Sends go out via this mailbox's own Gmail.
    fromAddress: text("from_address"),
    // Sign-off appended to every email (initial + follow-ups), above the footer
    signature: text("signature"),
    // Drip settings used for this campaign; reused by follow-up scheduling
    staggerConfig: jsonb("stagger_config").$type<StoredStaggerConfig>(),
    status: text("status").$type<CampaignStatus>().notNull().default("draft"),
    total: integer("total").notNull().default(0),
    sentCount: integer("sent_count").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    sentAt: timestamp("sent_at"),
    scheduledAt: timestamp("scheduled_at"),
    // Heartbeat written while a send/cancel loop runs. A stale value on a
    // "sending" campaign means the background job died; the cron reconciles it.
    lastProgressAt: timestamp("last_progress_at"),
  },
  (t) => [index("campaign_user_idx").on(t.userId)]
);

export const recipients = pgTable(
  "recipient",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name"),
    // Full sheet row snapshot, used for {{placeholder}} rendering
    rowData: jsonb("row_data").$type<Record<string, string>>().notNull(),
    /** @deprecated Resend era; kept for historical rows, no longer written */
    resendEmailId: text("resend_email_id"),
    // When this row is due to be dispatched (DB-backed scheduling; Gmail has
    // no server-side scheduledAt, so a cron-pinged dispatcher sends due rows)
    scheduledFor: timestamp("scheduled_for"),
    // Dispatcher mutex: claimed rows are skipped by concurrent runs; stale
    // claims (>15 min) are reclaimable since function maxDuration is 300s
    dispatchClaimedAt: timestamp("dispatch_claimed_at"),
    // Gmail API ids of the last send to this recipient
    gmailMessageId: text("gmail_message_id"),
    gmailThreadId: text("gmail_thread_id"),
    // RFC 2822 Message-ID of the initial send; follow-ups reference it via
    // In-Reply-To/References so they thread under the original
    gmailRfcMessageId: text("gmail_rfc_message_id"),
    status: text("status").$type<RecipientStatus>().notNull().default("pending"),
    variant: text("variant").$type<Variant>().notNull().default("A"),
    // 1-based row number in the source sheet, for status write-back
    sheetRow: integer("sheet_row"),
    // 0 = initial email; incremented per follow-up step sent
    sequenceStep: integer("sequence_step").notNull().default(0),
    lastEmailAt: timestamp("last_email_at"),
    repliedAt: timestamp("replied_at"),
    // Latest reply content, captured during reply detection so it can be read
    // in-app. Full body is fetched on demand via the Gmail message id.
    replySnippet: text("reply_snippet"),
    replySubject: text("reply_subject"),
    replyMessageId: text("reply_message_id"),
    openedAt: timestamp("opened_at"),
    clickedAt: timestamp("clicked_at"),
    error: text("error"),
    unsubscribeToken: text("unsubscribe_token").notNull().unique(),
  },
  (t) => [
    uniqueIndex("recipient_resend_email_id_idx").on(t.resendEmailId),
    index("recipient_campaign_idx").on(t.campaignId),
    // Hot path for the dispatcher: status='scheduled' AND scheduled_for <= now()
    index("recipient_dispatch_idx").on(t.status, t.scheduledFor),
  ]
);

/** @deprecated Resend-era webhook audit log; kept for historical rows */
export const emailEvents = pgTable(
  "email_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipientId: uuid("recipient_id").references(() => recipients.id, {
      onDelete: "set null",
    }),
    resendEmailId: text("resend_email_id").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  // Idempotency: each (email, event type) pair is recorded once
  (t) => [uniqueIndex("email_event_unique_idx").on(t.resendEmailId, t.type)]
);

export const sequenceSteps = pgTable(
  "sequence_step",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    stepNumber: integer("step_number").notNull(), // 1, 2, 3...
    delayDays: integer("delay_days").notNull(), // days after the previous email
    // Optional absolute send time. When set, this step is due at this instant
    // for everyone (overrides delayDays); when null, delayDays is used.
    scheduledAt: timestamp("scheduled_at"),
    subjectTemplate: text("subject_template").notNull(),
    bodyTemplate: text("body_template").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sequence_step_unique_idx").on(t.campaignId, t.stepNumber)]
);

export const unsubscribes = pgTable("unsubscribe", {
  // Always stored lowercased
  email: text("email").primaryKey(),
  userId: text("user_id"),
  source: text("source").notNull(), // link | one_click | complaint | bounce
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
