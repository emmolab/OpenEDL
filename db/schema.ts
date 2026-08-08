import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const edlLists = sqliteTable(
  "edl_lists",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    type: text("type", { enum: ["ip", "domain", "url"] }).notNull(),
    description: text("description").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("edl_lists_slug_idx").on(table.slug)],
);

export const sources = sqliteTable(
  "sources",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    url: text("url"),
    kind: text("kind", { enum: ["remote", "manual"] })
      .notNull()
      .default("remote"),
    type: text("type", { enum: ["ip", "domain", "url"] }).notNull(),
    format: text("format", { enum: ["auto", "text", "json", "csv"] })
      .notNull()
      .default("auto"),
    manualEntries: text("manual_entries").notNull().default(""),
    apiProvider: text("api_provider"),
    apiAuthType: text("api_auth_type", {
      enum: ["none", "bearer", "header"],
    })
      .notNull()
      .default("none"),
    apiAuthHeader: text("api_auth_header"),
    apiSecretCiphertext: text("api_secret_ciphertext"),
    apiSecretIv: text("api_secret_iv"),
    jsonPath: text("json_path").notNull().default(""),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    cachedEntries: text("cached_entries").notNull().default("[]"),
    entryCount: integer("entry_count").notNull().default(0),
    status: text("status", {
      enum: ["pending", "healthy", "degraded", "disabled"],
    })
      .notNull()
      .default("pending"),
    lastCheckedAt: text("last_checked_at"),
    lastSuccessAt: text("last_success_at"),
    lastError: text("last_error"),
    refreshIntervalMinutes: integer("refresh_interval_minutes")
      .notNull()
      .default(60),
    nextRefreshAt: text("next_refresh_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("sources_status_idx").on(table.status),
    index("sources_type_idx").on(table.type),
    index("sources_next_refresh_idx").on(table.nextRefreshAt),
  ],
);

export const authUsers = sqliteTable(
  "auth_users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    provider: text("provider").notNull(),
    subject: text("subject").notNull(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    picture: text("picture"),
    role: text("role", { enum: ["admin", "member"] })
      .notNull()
      .default("member"),
    theme: text("theme", {
      enum: ["signal", "ocean", "ember", "midnight", "custom"],
    })
      .notNull()
      .default("signal"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    passwordHash: text("password_hash"),
    passwordSalt: text("password_salt"),
    passwordIterations: integer("password_iterations"),
    failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
    lockedUntil: text("locked_until"),
    deletedAt: text("deleted_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    lastLoginAt: text("last_login_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("auth_users_provider_subject_idx").on(
      table.provider,
      table.subject,
    ),
    index("auth_users_email_idx").on(table.email),
  ],
);

export const authSessions = sqliteTable(
  "auth_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("auth_sessions_user_idx").on(table.userId),
    index("auth_sessions_expires_idx").on(table.expiresAt),
  ],
);

export const authChallenges = sqliteTable(
  "auth_challenges",
  {
    stateHash: text("state_hash").primaryKey(),
    provider: text("provider").notNull(),
    nonce: text("nonce").notNull(),
    codeVerifier: text("code_verifier").notNull(),
    returnTo: text("return_to").notNull().default("/"),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("auth_challenges_expires_idx").on(table.expiresAt)],
);

export const oidcProviders = sqliteTable("oidc_providers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  issuer: text("issuer").notNull(),
  discoveryUrl: text("discovery_url").notNull(),
  clientId: text("client_id").notNull(),
  clientSecretCiphertext: text("client_secret_ciphertext").notNull(),
  clientSecretIv: text("client_secret_iv").notNull(),
  scopes: text("scopes").notNull().default("openid profile email"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const blockAuditEvents = sqliteTable(
  "block_audit_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    listId: integer("list_id")
      .notNull()
      .references(() => edlLists.id, { onDelete: "cascade" }),
    entry: text("entry").notNull(),
    action: text("action", { enum: ["blocked", "unblocked"] }).notNull(),
    reason: text("reason").notNull().default("source_refresh"),
    sourceNames: text("source_names").notNull().default("[]"),
    occurredAt: text("occurred_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("block_audit_list_time_idx").on(table.listId, table.occurredAt),
    index("block_audit_entry_idx").on(table.entry),
  ],
);

export const lifetimeBlockedEntries = sqliteTable(
  "lifetime_blocked_entries",
  {
    entry: text("entry").primaryKey(),
    firstSeenAt: text("first_seen_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    lastSeenAt: text("last_seen_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("lifetime_blocks_last_seen_idx").on(table.lastSeenAt)],
);

export const listSources = sqliteTable(
  "list_sources",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    listId: integer("list_id")
      .notNull()
      .references(() => edlLists.id, { onDelete: "cascade" }),
    sourceId: integer("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["include", "exclude"] })
      .notNull()
      .default("include"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("list_sources_list_source_idx").on(
      table.listId,
      table.sourceId,
    ),
    index("list_sources_list_idx").on(table.listId),
  ],
);
