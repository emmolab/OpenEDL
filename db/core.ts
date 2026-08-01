import { env } from "cloudflare:workers";
import {
  aggregateEntries,
  downloadSource,
  normalizeEntries,
  parseCachedEntries,
  type EdlType,
  type SourceFormat,
  type SourceRole,
  type SourceStatus,
} from "../lib/edl";
import {
  decryptConfigSecret,
  encryptConfigSecret,
} from "../lib/config-secrets";
import { logError, logInfo } from "../lib/logging";
import {
  DEFAULT_CUSTOM_THEME,
  isAppTheme,
  parseCustomThemeColors,
  type AppTheme,
  type CustomThemeColors,
} from "../lib/appearance";

type RuntimeEnv = {
  DB?: D1Database;
  CONFIG_ENCRYPTION_KEY?: string;
};

export type SourceSafetyLimits = {
  remoteSourceMaxMb: number;
  apiSourceMaxMb: number;
};

export type DatabaseStats = {
  available: boolean;
  pageCount: number;
  pageSize: number;
  freePageCount: number;
  sizeBytes: number;
  reclaimableBytes: number;
};

export type VacuumSchedule = "disabled" | "daily" | "weekly" | "monthly";

export type VacuumScheduleSettings = {
  schedule: VacuumSchedule;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: "never" | "success" | "failed";
  lastError: string | null;
};

export type BlockAuditEvent = {
  id: number;
  list_id: number;
  list_name: string;
  entry: string;
  action: "blocked" | "unblocked";
  reason: string;
  occurred_at: string;
};

const DEFAULT_REMOTE_SOURCE_MAX_MB = 2;
const DEFAULT_API_SOURCE_MAX_MB = 20;

type ListRow = {
  id: number;
  name: string;
  slug: string;
  type: EdlType;
  description: string;
  created_at: string;
  updated_at: string;
};

export type SourceRow = {
  id: number;
  name: string;
  url: string | null;
  kind: "remote" | "manual";
  type: EdlType;
  format: SourceFormat;
  manual_entries: string;
  api_provider: string | null;
  api_auth_type: "none" | "bearer" | "header";
  api_auth_header: string | null;
  api_secret_ciphertext: string | null;
  api_secret_iv: string | null;
  json_path: string;
  enabled: number;
  cached_entries: string;
  entry_count: number;
  status: SourceStatus;
  last_checked_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  refresh_interval_minutes: number;
  next_refresh_at: string | null;
  created_at: string;
  updated_at: string;
  role?: SourceRole;
};

const runtimeEnv = env as unknown as RuntimeEnv;
const initializations = new WeakMap<D1Database, Promise<void>>();

export function getD1() {
  if (!runtimeEnv.DB) {
    throw new Error("The D1 database binding is unavailable.");
  }
  return runtimeEnv.DB;
}

async function createSchema(database: D1Database) {
  await database.batch([
    database
      .prepare(
        `CREATE TABLE IF NOT EXISTS edl_lists (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          slug TEXT NOT NULL UNIQUE,
          type TEXT NOT NULL CHECK(type IN ('ip', 'domain', 'url')),
          description TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
      ),
    database
      .prepare(
        `CREATE TABLE IF NOT EXISTS sources (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          url TEXT,
          kind TEXT NOT NULL DEFAULT 'remote' CHECK(kind IN ('remote', 'manual')),
          type TEXT NOT NULL CHECK(type IN ('ip', 'domain', 'url')),
          format TEXT NOT NULL DEFAULT 'auto' CHECK(format IN ('auto', 'text', 'json', 'csv')),
          manual_entries TEXT NOT NULL DEFAULT '',
          api_provider TEXT,
          api_auth_type TEXT NOT NULL DEFAULT 'none',
          api_auth_header TEXT,
          api_secret_ciphertext TEXT,
          api_secret_iv TEXT,
          json_path TEXT NOT NULL DEFAULT '',
          enabled INTEGER NOT NULL DEFAULT 1,
          cached_entries TEXT NOT NULL DEFAULT '[]',
          entry_count INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'healthy', 'degraded', 'disabled')),
          last_checked_at TEXT,
          last_success_at TEXT,
          last_error TEXT,
          refresh_interval_minutes INTEGER NOT NULL DEFAULT 60,
          next_refresh_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
      ),
    database
      .prepare(
        `CREATE TABLE IF NOT EXISTS list_sources (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          list_id INTEGER NOT NULL REFERENCES edl_lists(id) ON DELETE CASCADE,
          source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
          role TEXT NOT NULL DEFAULT 'include' CHECK(role IN ('include', 'exclude')),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(list_id, source_id)
        )`,
      ),
    database
      .prepare(
        `CREATE TABLE IF NOT EXISTS auth_users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider TEXT NOT NULL,
          subject TEXT NOT NULL,
          email TEXT NOT NULL,
          name TEXT NOT NULL,
          picture TEXT,
          role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin', 'member')),
          theme TEXT NOT NULL DEFAULT 'signal' CHECK(theme IN ('signal', 'ocean', 'ember', 'midnight', 'custom')),
          active INTEGER NOT NULL DEFAULT 1,
          password_hash TEXT,
          password_salt TEXT,
          password_iterations INTEGER,
          failed_login_attempts INTEGER NOT NULL DEFAULT 0,
          locked_until TEXT,
          deleted_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          last_login_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(provider, subject)
        )`,
      ),
    database
      .prepare(
        `CREATE TABLE IF NOT EXISTS auth_sessions (
          token_hash TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
      ),
    database
      .prepare(
        `CREATE TABLE IF NOT EXISTS auth_challenges (
          state_hash TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          nonce TEXT NOT NULL,
          code_verifier TEXT NOT NULL,
          return_to TEXT NOT NULL DEFAULT '/',
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
      ),
    database
      .prepare(
        `CREATE TABLE IF NOT EXISTS oidc_providers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          issuer TEXT NOT NULL,
          discovery_url TEXT NOT NULL,
          client_id TEXT NOT NULL,
          client_secret_ciphertext TEXT NOT NULL,
          client_secret_iv TEXT NOT NULL,
          scopes TEXT NOT NULL DEFAULT 'openid profile email',
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
      ),
    database
      .prepare(
        `CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
      ),
    database
      .prepare(
        `CREATE TABLE IF NOT EXISTS block_audit_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          list_id INTEGER NOT NULL REFERENCES edl_lists(id) ON DELETE CASCADE,
          entry TEXT NOT NULL,
          action TEXT NOT NULL CHECK(action IN ('blocked', 'unblocked')),
          reason TEXT NOT NULL DEFAULT 'source_refresh',
          occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
      ),
    database
      .prepare(
        `CREATE TABLE IF NOT EXISTS lifetime_blocked_entries (
          entry TEXT PRIMARY KEY,
          first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
      ),
    database.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS edl_lists_slug_idx ON edl_lists(slug)",
    ),
    database.prepare(
      "CREATE INDEX IF NOT EXISTS sources_status_idx ON sources(status)",
    ),
    database.prepare(
      "CREATE INDEX IF NOT EXISTS list_sources_list_idx ON list_sources(list_id)",
    ),
    database.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS auth_users_provider_subject_idx ON auth_users(provider, subject)",
    ),
    database.prepare(
      "CREATE INDEX IF NOT EXISTS auth_users_email_idx ON auth_users(email)",
    ),
    database.prepare(
      "CREATE INDEX IF NOT EXISTS auth_sessions_expires_idx ON auth_sessions(expires_at)",
    ),
    database.prepare(
      "CREATE INDEX IF NOT EXISTS auth_challenges_expires_idx ON auth_challenges(expires_at)",
    ),
    database.prepare(
      "CREATE INDEX IF NOT EXISTS block_audit_list_time_idx ON block_audit_events(list_id, occurred_at)",
    ),
    database.prepare(
      "CREATE INDEX IF NOT EXISTS block_audit_entry_idx ON block_audit_events(entry)",
    ),
    database.prepare(
      "CREATE INDEX IF NOT EXISTS lifetime_blocks_last_seen_idx ON lifetime_blocked_entries(last_seen_at)",
    ),
  ]);

  const sourceColumns = await database
    .prepare("PRAGMA table_info(sources)")
    .all<{ name: string }>();
  const columnNames = new Set(sourceColumns.results.map((column) => column.name));
  if (!columnNames.has("refresh_interval_minutes")) {
    await database
      .prepare(
        "ALTER TABLE sources ADD COLUMN refresh_interval_minutes INTEGER NOT NULL DEFAULT 60",
      )
      .run();
  }
  if (!columnNames.has("next_refresh_at")) {
    await database
      .prepare("ALTER TABLE sources ADD COLUMN next_refresh_at TEXT")
      .run();
  }
  const sourceMigrations = [
    ["api_provider", "ALTER TABLE sources ADD COLUMN api_provider TEXT"],
    [
      "api_auth_type",
      "ALTER TABLE sources ADD COLUMN api_auth_type TEXT NOT NULL DEFAULT 'none'",
    ],
    ["api_auth_header", "ALTER TABLE sources ADD COLUMN api_auth_header TEXT"],
    [
      "api_secret_ciphertext",
      "ALTER TABLE sources ADD COLUMN api_secret_ciphertext TEXT",
    ],
    ["api_secret_iv", "ALTER TABLE sources ADD COLUMN api_secret_iv TEXT"],
    [
      "json_path",
      "ALTER TABLE sources ADD COLUMN json_path TEXT NOT NULL DEFAULT ''",
    ],
  ] as const;
  for (const [column, statement] of sourceMigrations) {
    if (!columnNames.has(column)) {
      await database.prepare(statement).run();
    }
  }
  await database
    .prepare(
      "CREATE INDEX IF NOT EXISTS sources_next_refresh_idx ON sources(next_refresh_at)",
    )
    .run();
  await database
    .prepare(
      `INSERT OR IGNORE INTO app_settings (key, value)
       VALUES ('remote_source_max_mb', '2')`,
    )
    .run();
  await database
    .prepare(
      `INSERT OR IGNORE INTO app_settings (key, value)
       VALUES ('api_source_max_mb', '20')`,
    )
    .run();
  const maintenanceDefaults = [
    ["vacuum_schedule", "disabled"],
    ["vacuum_next_at", ""],
    ["vacuum_last_at", ""],
    ["vacuum_last_status", "never"],
    ["vacuum_last_error", ""],
  ] as const;
  for (const [key, value] of maintenanceDefaults) {
    await database
      .prepare(
        `INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)`,
      )
      .bind(key, value)
      .run();
  }
  await database
    .prepare(
      `INSERT INTO sources (
        name, url, kind, type, format, enabled, cached_entries, entry_count,
        status, refresh_interval_minutes, next_refresh_at
      )
      SELECT
        'Emerging Threats Block IPs',
        'https://rules.emergingthreats.net/fwrules/emerging-Block-IPs.txt',
        'remote', 'ip', 'auto', 1, '[]', 0, 'pending', 60, CURRENT_TIMESTAMP
      WHERE EXISTS (SELECT 1 FROM edl_lists WHERE type = 'ip')
        AND NOT EXISTS (
          SELECT 1 FROM sources
          WHERE url = 'https://rules.emergingthreats.net/fwrules/emerging-Block-IPs.txt'
        )`,
    )
    .run();
  await database
    .prepare(
      `INSERT OR IGNORE INTO list_sources (list_id, source_id, role)
       SELECT
         COALESCE(
           (SELECT id FROM edl_lists WHERE slug = 'perimeter-blocklist' LIMIT 1),
           (SELECT id FROM edl_lists WHERE type = 'ip' ORDER BY id LIMIT 1)
         ),
         sources.id,
         'include'
       FROM sources
       WHERE sources.url =
         'https://rules.emergingthreats.net/fwrules/emerging-Block-IPs.txt'
         AND EXISTS (SELECT 1 FROM edl_lists WHERE type = 'ip')`,
    )
    .run();

  const authUserColumns = await database
    .prepare("PRAGMA table_info(auth_users)")
    .all<{ name: string }>();
  const authColumnNames = new Set(
    authUserColumns.results.map((column) => column.name),
  );
  const authMigrations = [
    ["role", "ALTER TABLE auth_users ADD COLUMN role TEXT NOT NULL DEFAULT 'member'"],
    [
      "theme",
      "ALTER TABLE auth_users ADD COLUMN theme TEXT NOT NULL DEFAULT 'signal'",
    ],
    ["active", "ALTER TABLE auth_users ADD COLUMN active INTEGER NOT NULL DEFAULT 1"],
    ["password_hash", "ALTER TABLE auth_users ADD COLUMN password_hash TEXT"],
    ["password_salt", "ALTER TABLE auth_users ADD COLUMN password_salt TEXT"],
    [
      "password_iterations",
      "ALTER TABLE auth_users ADD COLUMN password_iterations INTEGER",
    ],
    [
      "failed_login_attempts",
      "ALTER TABLE auth_users ADD COLUMN failed_login_attempts INTEGER NOT NULL DEFAULT 0",
    ],
    ["locked_until", "ALTER TABLE auth_users ADD COLUMN locked_until TEXT"],
    ["deleted_at", "ALTER TABLE auth_users ADD COLUMN deleted_at TEXT"],
    [
      "updated_at",
      "ALTER TABLE auth_users ADD COLUMN updated_at TEXT",
    ],
  ] as const;
  for (const [column, statement] of authMigrations) {
    if (!authColumnNames.has(column)) {
      await database.prepare(statement).run();
    }
  }
  await database
    .prepare(
      "UPDATE auth_users SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL",
    )
    .run();
  await database
    .prepare(
      `UPDATE sources SET
        name = 'Emerging Threats Block IPs',
        url = 'https://rules.emergingthreats.net/fwrules/emerging-Block-IPs.txt',
        status = 'pending',
        next_refresh_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
       WHERE url = 'https://feodotracker.abuse.ch/downloads/ipblocklist.txt'`,
    )
    .run();

  const admin = await database
    .prepare(
      `SELECT id FROM auth_users
       WHERE role = 'admin' AND active = 1 AND deleted_at IS NULL
       LIMIT 1`,
    )
    .first<{ id: number }>();
  if (!admin) {
    await database
      .prepare(
        `UPDATE auth_users SET role = 'admin', updated_at = CURRENT_TIMESTAMP
         WHERE id = (
           SELECT id FROM auth_users
           WHERE active = 1 AND deleted_at IS NULL
           ORDER BY id LIMIT 1
         )`,
      )
      .run();
  }
  await database
    .prepare(
      `INSERT OR IGNORE INTO app_settings (key, value)
       VALUES (
         'app_theme',
         COALESCE(
           (
             SELECT theme FROM auth_users
             WHERE role = 'admin' AND active = 1 AND deleted_at IS NULL
             ORDER BY id LIMIT 1
           ),
           'signal'
         )
       )`,
    )
    .run();
}

async function seedDatabase(database: D1Database) {
  const existing = await database
    .prepare("SELECT COUNT(*) AS count FROM edl_lists")
    .first<{ count: number }>();
  if ((existing?.count ?? 0) > 0) return;

  await database
    .prepare(
      `INSERT INTO edl_lists (name, slug, type, description)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(
      "Perimeter Blocklist",
      "perimeter-blocklist",
      "ip",
      "Consolidated malicious infrastructure for perimeter policy.",
    )
    .run();

  const list = await database
    .prepare("SELECT id FROM edl_lists WHERE slug = ?")
    .bind("perimeter-blocklist")
    .first<{ id: number }>();
  if (!list) return;

  const seeds = [
    {
      name: "Emerging Threats Block IPs",
      url: "https://rules.emergingthreats.net/fwrules/emerging-Block-IPs.txt",
      kind: "remote",
      role: "include",
      entries: ["185.215.113.66", "194.26.135.119", "45.9.148.114"],
    },
    {
      name: "Blocklist.de",
      url: "https://lists.blocklist.de/lists/all.txt",
      kind: "remote",
      role: "include",
      entries: ["45.9.148.114", "91.92.240.103", "193.32.162.18"],
    },
    {
      name: "Team Cymru Bogons",
      url: "https://www.team-cymru.org/Services/Bogons/fullbogons-ipv4.txt",
      kind: "remote",
      role: "include",
      entries: ["100.64.0.0/10", "192.0.0.0/24"],
    },
    {
      name: "Local allowlist",
      url: null,
      kind: "manual",
      role: "exclude",
      entries: ["192.0.0.0/24"],
    },
  ] as const;

  for (const seed of seeds) {
    const sourceResult = await database
      .prepare(
        `INSERT INTO sources (
          name, url, kind, type, format, manual_entries, enabled,
          cached_entries, entry_count, status, last_checked_at, last_success_at,
          refresh_interval_minutes, next_refresh_at
        ) VALUES (?, ?, ?, 'ip', 'auto', ?, 1, ?, ?, 'healthy',
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 60, datetime('now', '+60 minutes'))`,
      )
      .bind(
        seed.name,
        seed.url,
        seed.kind,
        seed.kind === "manual" ? seed.entries.join("\n") : "",
        JSON.stringify(seed.entries),
        seed.entries.length,
      )
      .run();

    const sourceId = Number(sourceResult.meta.last_row_id);
    await database
      .prepare(
        "INSERT INTO list_sources (list_id, source_id, role) VALUES (?, ?, ?)",
      )
      .bind(list.id, sourceId, seed.role)
      .run();
  }
}

export async function ensureDatabase(database = getD1()) {
  let initialization = initializations.get(database);
  if (!initialization) {
    initialization = createSchema(database)
      .then(() => seedDatabase(database))
      .catch((error) => {
        initializations.delete(database);
        throw error;
      });
    initializations.set(database, initialization);
  }
  await initialization;
}

export async function getLists() {
  await ensureDatabase();
  const { results } = await getD1()
    .prepare("SELECT * FROM edl_lists ORDER BY id")
    .all<ListRow>();
  return results;
}

export async function getAppTheme(): Promise<AppTheme> {
  await ensureDatabase();
  const row = await getD1()
    .prepare("SELECT value FROM app_settings WHERE key = 'app_theme'")
    .first<{ value: string }>();
  return isAppTheme(row?.value) ? row.value : "signal";
}

export async function updateAppTheme(theme: string) {
  if (!isAppTheme(theme)) {
    throw new Error("Invalid application theme.");
  }
  await ensureDatabase();
  await getD1()
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('app_theme', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(theme)
    .run();
}

export async function getCustomTheme(): Promise<CustomThemeColors> {
  await ensureDatabase();
  const row = await getD1()
    .prepare("SELECT value FROM app_settings WHERE key = 'app_custom_theme'")
    .first<{ value: string }>();
  if (!row?.value) return DEFAULT_CUSTOM_THEME;
  try {
    return parseCustomThemeColors(JSON.parse(row.value)) ?? DEFAULT_CUSTOM_THEME;
  } catch {
    return DEFAULT_CUSTOM_THEME;
  }
}

export async function updateCustomTheme(value: unknown) {
  const customTheme = parseCustomThemeColors(value);
  if (!customTheme) {
    throw new Error("Every custom theme colour must be a six-digit hex value.");
  }
  await ensureDatabase();
  await getD1()
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('app_custom_theme', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(JSON.stringify(customTheme))
    .run();
  return customTheme;
}

export async function getSourceSafetyLimits(
  database = getD1(),
  initialize = true,
): Promise<SourceSafetyLimits> {
  if (initialize) await ensureDatabase(database);
  const { results } = await database
    .prepare(
      `SELECT key, value FROM app_settings
       WHERE key IN ('remote_source_max_mb', 'api_source_max_mb')`,
    )
    .all<{ key: string; value: string }>();
  const settings = new Map(results.map((row) => [row.key, Number(row.value)]));
  const remoteSourceMaxMb = settings.get("remote_source_max_mb");
  const apiSourceMaxMb = settings.get("api_source_max_mb");
  return {
    remoteSourceMaxMb:
      remoteSourceMaxMb &&
      Number.isInteger(remoteSourceMaxMb) &&
      remoteSourceMaxMb >= 1
        ? remoteSourceMaxMb
        : DEFAULT_REMOTE_SOURCE_MAX_MB,
    apiSourceMaxMb:
      apiSourceMaxMb &&
      Number.isInteger(apiSourceMaxMb) &&
      apiSourceMaxMb >= 1
        ? apiSourceMaxMb
        : DEFAULT_API_SOURCE_MAX_MB,
  };
}

export async function updateSourceSafetyLimits(input: SourceSafetyLimits) {
  if (
    !Number.isInteger(input.remoteSourceMaxMb) ||
    input.remoteSourceMaxMb < 1 ||
    input.remoteSourceMaxMb > 100
  ) {
    throw new Error("Remote URL limit must be between 1 and 100 MB.");
  }
  if (
    !Number.isInteger(input.apiSourceMaxMb) ||
    input.apiSourceMaxMb < 1 ||
    input.apiSourceMaxMb > 500
  ) {
    throw new Error("Authenticated API limit must be between 1 and 500 MB.");
  }
  await ensureDatabase();
  await getD1().batch([
    getD1()
      .prepare(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ('remote_source_max_mb', ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .bind(String(input.remoteSourceMaxMb)),
    getD1()
      .prepare(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ('api_source_max_mb', ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .bind(String(input.apiSourceMaxMb)),
  ]);
}

async function readDatabaseStats(database: D1Database): Promise<DatabaseStats> {
  try {
    const [pageCountRow, pageSizeRow, freePageRow] = await Promise.all([
      database.prepare("PRAGMA page_count").first<Record<string, number>>(),
      database.prepare("PRAGMA page_size").first<Record<string, number>>(),
      database.prepare("PRAGMA freelist_count").first<Record<string, number>>(),
    ]);
    const pageCount = Number(pageCountRow?.page_count ?? 0);
    const pageSize = Number(pageSizeRow?.page_size ?? 0);
    const freePageCount = Number(freePageRow?.freelist_count ?? 0);
    return {
      available: true,
      pageCount,
      pageSize,
      freePageCount,
      sizeBytes: pageCount * pageSize,
      reclaimableBytes: freePageCount * pageSize,
    };
  } catch {
    return {
      available: false,
      pageCount: 0,
      pageSize: 0,
      freePageCount: 0,
      sizeBytes: 0,
      reclaimableBytes: 0,
    };
  }
}

export async function getDatabaseStats() {
  await ensureDatabase();
  return readDatabaseStats(getD1());
}

function nextVacuumDate(schedule: Exclude<VacuumSchedule, "disabled">) {
  const next = new Date();
  next.setUTCSeconds(0, 0);
  if (schedule === "daily") next.setUTCDate(next.getUTCDate() + 1);
  if (schedule === "weekly") next.setUTCDate(next.getUTCDate() + 7);
  if (schedule === "monthly") next.setUTCMonth(next.getUTCMonth() + 1);
  return next.toISOString();
}

export async function getVacuumSchedule(
  database = getD1(),
  initialize = true,
): Promise<VacuumScheduleSettings> {
  if (initialize) await ensureDatabase(database);
  const { results } = await database
    .prepare(
      `SELECT key, value FROM app_settings
       WHERE key IN (
         'vacuum_schedule', 'vacuum_next_at', 'vacuum_last_at',
         'vacuum_last_status', 'vacuum_last_error'
       )`,
    )
    .all<{ key: string; value: string }>();
  const values = new Map(results.map((row) => [row.key, row.value]));
  const configured = values.get("vacuum_schedule") ?? "disabled";
  const schedule: VacuumSchedule = [
    "daily",
    "weekly",
    "monthly",
  ].includes(configured)
    ? (configured as VacuumSchedule)
    : "disabled";
  const lastStatus = values.get("vacuum_last_status") ?? "never";
  return {
    schedule,
    nextRunAt: values.get("vacuum_next_at") || null,
    lastRunAt: values.get("vacuum_last_at") || null,
    lastStatus:
      lastStatus === "success" || lastStatus === "failed"
        ? lastStatus
        : "never",
    lastError: values.get("vacuum_last_error") || null,
  };
}

export async function updateVacuumSchedule(schedule: VacuumSchedule) {
  if (!["disabled", "daily", "weekly", "monthly"].includes(schedule)) {
    throw new Error("Invalid database VACUUM schedule.");
  }
  await ensureDatabase();
  const nextRunAt = schedule === "disabled" ? "" : nextVacuumDate(schedule);
  await getD1().batch([
    getD1()
      .prepare(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ('vacuum_schedule', ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .bind(schedule),
    getD1()
      .prepare(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ('vacuum_next_at', ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .bind(nextRunAt),
  ]);
  return getVacuumSchedule();
}

export async function vacuumDatabase(
  database = getD1(),
  initialize = true,
) {
  if (initialize) await ensureDatabase(database);
  const before = await readDatabaseStats(database);
  try {
    await database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch {
    // Managed SQLite-compatible services may not expose WAL controls.
  }
  try {
    await database.exec("VACUUM");
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Database compaction is unavailable: ${error.message}`
        : "Database compaction is unavailable on this storage backend.",
    );
  }
  const after = await readDatabaseStats(database);
  return {
    before,
    after,
    reclaimedBytes: Math.max(0, before.sizeBytes - after.sizeBytes),
  };
}

export async function runScheduledMaintenance(database = getD1()) {
  await ensureDatabase(database);
  const settings = await getVacuumSchedule(database, false);
  if (
    settings.schedule === "disabled" ||
    !settings.nextRunAt ||
    new Date(settings.nextRunAt).getTime() > Date.now()
  ) {
    return { ran: false, schedule: settings };
  }

  // Advance the due time before starting so overlapping scheduler ticks cannot
  // repeatedly claim the same maintenance window.
  const claim = await database
    .prepare(
      `UPDATE app_settings SET value = ?, updated_at = CURRENT_TIMESTAMP
       WHERE key = 'vacuum_next_at' AND value = ?`,
    )
    .bind(nextVacuumDate(settings.schedule), settings.nextRunAt)
    .run();
  if ((claim.meta.changes ?? 0) === 0) {
    return {
      ran: false,
      schedule: await getVacuumSchedule(database, false),
    };
  }
  try {
    const result = await vacuumDatabase(database, false);
    await database.batch([
      database
        .prepare(
          `UPDATE app_settings SET value = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP WHERE key = 'vacuum_last_at'`,
        ),
      database
        .prepare(
          `UPDATE app_settings SET value = 'success',
             updated_at = CURRENT_TIMESTAMP WHERE key = 'vacuum_last_status'`,
        ),
      database
        .prepare(
          `UPDATE app_settings SET value = '', updated_at = CURRENT_TIMESTAMP
           WHERE key = 'vacuum_last_error'`,
        ),
    ]);
    logInfo("scheduler.vacuum.completed", {
      reclaimedBytes: result.reclaimedBytes,
    });
    return {
      ran: true,
      ok: true,
      result,
      schedule: await getVacuumSchedule(database, false),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await database.batch([
      database
        .prepare(
          `UPDATE app_settings SET value = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP WHERE key = 'vacuum_last_at'`,
        ),
      database
        .prepare(
          `UPDATE app_settings SET value = 'failed',
             updated_at = CURRENT_TIMESTAMP WHERE key = 'vacuum_last_status'`,
        ),
      database
        .prepare(
          `UPDATE app_settings SET value = ?, updated_at = CURRENT_TIMESTAMP
           WHERE key = 'vacuum_last_error'`,
        )
        .bind(message.slice(0, 1000)),
    ]);
    logError("scheduler.vacuum.failed", error);
    return {
      ran: true,
      ok: false,
      error: message,
      schedule: await getVacuumSchedule(database, false),
    };
  }
}

export async function getList(idOrSlug: number | string) {
  await ensureDatabase();
  return typeof idOrSlug === "number"
    ? getD1()
        .prepare("SELECT * FROM edl_lists WHERE id = ?")
        .bind(idOrSlug)
        .first<ListRow>()
    : getD1()
        .prepare("SELECT * FROM edl_lists WHERE slug = ?")
        .bind(idOrSlug)
        .first<ListRow>();
}

export async function updateList(
  listId: number,
  input: { name: string; slug: string; description: string },
) {
  await ensureDatabase();
  const name = input.name.trim();
  const slug = input.slug.trim().toLowerCase();
  const description = input.description.trim();
  if (name.length < 2 || name.length > 100) {
    throw new Error("List name must be 2–100 characters.");
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 64) {
    throw new Error(
      "URL slug must use lowercase letters, numbers, and single dashes.",
    );
  }
  if (description.length > 500) {
    throw new Error("Description must be 500 characters or fewer.");
  }
  try {
    const result = await getD1()
      .prepare(
        `UPDATE edl_lists SET name = ?, slug = ?, description = ?,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(name, slug, description, listId)
      .run();
    if ((result.meta.changes ?? 0) === 0) throw new Error("List not found.");
  } catch (error) {
    if (error instanceof Error && /unique|constraint/i.test(error.message)) {
      throw new Error("Another published list already uses that URL slug.");
    }
    throw error;
  }
}

export async function getSourcesForList(listId: number) {
  await ensureDatabase();
  const { results } = await getD1()
    .prepare(
      `SELECT sources.*, list_sources.role
       FROM sources
       INNER JOIN list_sources ON list_sources.source_id = sources.id
       WHERE list_sources.list_id = ?
       ORDER BY list_sources.role, sources.name`,
    )
    .bind(listId)
    .all<SourceRow>();
  return results;
}

export async function getDashboard() {
  const lists = await getLists();
  const dashboardLists = await Promise.all(
    lists.map(async (list) => {
      const sources = await getSourcesForList(list.id);
      const includeSources = sources
        .filter((source) => source.enabled && source.role === "include")
        .map((source) => parseCachedEntries(source.cached_entries));
      const excludeSources = sources
        .filter((source) => source.enabled && source.role === "exclude")
        .map((source) => parseCachedEntries(source.cached_entries));
      const aggregate = aggregateEntries(includeSources, excludeSources);

      return {
        ...list,
        sources: sources.map((source) => ({
          id: source.id,
          name: source.name,
          url: source.url,
          kind: source.kind,
          type: source.type,
          format: source.format,
          api_provider: source.api_provider,
          api_auth_type: source.api_auth_type,
          api_auth_header: source.api_auth_header,
          has_api_secret: Boolean(source.api_secret_ciphertext),
          json_path: source.json_path,
          manual_entries:
            source.kind === "manual" ? source.manual_entries : undefined,
          enabled: Boolean(source.enabled),
          entry_count: source.entry_count,
          status: source.status,
          last_checked_at: source.last_checked_at,
          last_success_at: source.last_success_at,
          last_error: source.last_error,
          refresh_interval_minutes: source.refresh_interval_minutes,
          next_refresh_at: source.next_refresh_at,
          created_at: source.created_at,
          updated_at: source.updated_at,
          role: source.role,
        })),
        entries: aggregate.entries,
        entryCount: aggregate.entries.length,
        excludedCount: aggregate.excludedCount,
        duplicateCount: aggregate.duplicateCount,
        healthySources: sources.filter(
          (source) => source.enabled && source.status === "healthy",
        ).length,
      };
    }),
  );

  return { lists: dashboardLists };
}

export async function createSource(input: {
  listId: number;
  name: string;
  url?: string;
  type: EdlType;
  format: SourceFormat;
  role: SourceRole;
  kind: "remote" | "manual";
  manualEntries?: string;
  apiProvider?: string;
  apiAuthType?: "none" | "bearer" | "header";
  apiAuthHeader?: string;
  apiSecret?: string;
  jsonPath?: string;
  refreshIntervalMinutes: number;
}) {
  await ensureDatabase();
  const database = getD1();
  const list = await getList(input.listId);
  if (!list) throw new Error("Published list not found.");
  if (list.type !== input.type) {
    throw new Error(`This list only accepts ${list.type.toUpperCase()} sources.`);
  }

  const entries =
    input.kind === "manual"
      ? normalizeEntries(input.manualEntries ?? "", input.type, input.format)
      : [];
  const encrypted =
    input.kind === "remote" && input.apiAuthType !== "none" && input.apiSecret
      ? await encryptConfigSecret(
          runtimeEnv.CONFIG_ENCRYPTION_KEY,
          "edl-api-source",
          input.apiSecret,
        )
      : null;
  const before = await snapshotIpLists(database, [input.listId]);
  const result = await database
    .prepare(
      `INSERT INTO sources (
        name, url, kind, type, format, manual_entries, enabled,
        api_provider, api_auth_type, api_auth_header, api_secret_ciphertext,
        api_secret_iv, json_path, cached_entries, entry_count, status,
        refresh_interval_minutes, next_refresh_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        CASE WHEN ? = 'remote' THEN CURRENT_TIMESTAMP ELSE NULL END)`,
    )
    .bind(
      input.name,
      input.url || null,
      input.kind,
      input.type,
      input.format,
      input.manualEntries ?? "",
      input.apiProvider || null,
      input.apiAuthType ?? "none",
      input.apiAuthHeader || null,
      encrypted?.ciphertext ?? null,
      encrypted?.iv ?? null,
      input.jsonPath?.trim() ?? "",
      JSON.stringify(entries),
      entries.length,
      input.kind === "manual" ? "healthy" : "pending",
      input.refreshIntervalMinutes,
      input.kind,
    )
    .run();

  const sourceId = Number(result.meta.last_row_id);
  await database
    .prepare(
      "INSERT INTO list_sources (list_id, source_id, role) VALUES (?, ?, ?)",
    )
    .bind(input.listId, sourceId, input.role)
    .run();
  await recordIpListChanges(database, before, [input.listId], "source_added");

  logInfo("source.created", {
    sourceId,
    listId: input.listId,
    kind: input.kind,
    authenticated: input.apiAuthType !== "none",
  });
  return sourceId;
}

export async function deleteSource(sourceId: number) {
  await ensureDatabase();
  const database = getD1();
  const listIds = await getIpListIdsForSource(database, sourceId);
  const before = await snapshotIpLists(database, listIds);
  const result = await database
    .prepare("DELETE FROM sources WHERE id = ?")
    .bind(sourceId)
    .run();
  await recordIpListChanges(database, before, listIds, "source_deleted");
  logInfo("source.deleted", {
    sourceId,
    deleted: (result.meta.changes ?? 0) > 0,
  });
}

export async function updateRemoteSource(
  sourceId: number,
  input: {
    name: string;
    url: string;
    format: SourceFormat;
    role: SourceRole;
    apiProvider?: string;
    apiAuthType: "none" | "bearer" | "header";
    apiAuthHeader?: string;
    apiSecret?: string;
    jsonPath?: string;
    refreshIntervalMinutes: number;
  },
) {
  await ensureDatabase();
  const database = getD1();
  const source = await database
    .prepare("SELECT * FROM sources WHERE id = ?")
    .bind(sourceId)
    .first<SourceRow>();
  if (!source) throw new Error("Source not found.");
  if (source.kind !== "remote") {
    throw new Error("Only remote and API sources can use this editor.");
  }
  const listIds = await getIpListIdsForSource(database, sourceId);
  const before = await snapshotIpLists(database, listIds);
  if (
    input.apiAuthType !== "none" &&
    !input.apiSecret &&
    !source.api_secret_ciphertext
  ) {
    throw new Error("Enter the API token or key.");
  }

  const encrypted = input.apiSecret
    ? await encryptConfigSecret(
        runtimeEnv.CONFIG_ENCRYPTION_KEY,
        "edl-api-source",
        input.apiSecret,
      )
    : null;
  const clearSecret = input.apiAuthType === "none";

  await database.batch([
    database
      .prepare(
        `UPDATE sources SET
          name = ?, url = ?, format = ?, api_provider = ?,
          api_auth_type = ?, api_auth_header = ?,
          api_secret_ciphertext = CASE
            WHEN ? = 1 THEN NULL
            ELSE COALESCE(?, api_secret_ciphertext)
          END,
          api_secret_iv = CASE
            WHEN ? = 1 THEN NULL
            ELSE COALESCE(?, api_secret_iv)
          END,
          json_path = ?, refresh_interval_minutes = ?,
          next_refresh_at = CURRENT_TIMESTAMP,
          status = CASE WHEN enabled = 1 THEN 'pending' ELSE 'disabled' END,
          last_error = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(
        input.name,
        input.url,
        input.format,
        input.apiProvider || null,
        input.apiAuthType,
        input.apiAuthType === "header" ? input.apiAuthHeader || null : null,
        clearSecret ? 1 : 0,
        encrypted?.ciphertext ?? null,
        clearSecret ? 1 : 0,
        encrypted?.iv ?? null,
        input.jsonPath?.trim() ?? "",
        input.refreshIntervalMinutes,
        sourceId,
      ),
    database
      .prepare("UPDATE list_sources SET role = ? WHERE source_id = ?")
      .bind(input.role, sourceId),
  ]);
  await recordIpListChanges(database, before, listIds, "source_updated");

  logInfo("source.updated", {
    sourceId,
    kind: input.apiAuthType === "none" ? "remote" : "api",
    credentialReplaced: Boolean(input.apiSecret),
    refreshIntervalMinutes: input.refreshIntervalMinutes,
  });
}

export async function updateSourceSchedule(
  sourceId: number,
  refreshIntervalMinutes: number,
) {
  await ensureDatabase();
  await getD1()
    .prepare(
      `UPDATE sources
       SET refresh_interval_minutes = ?,
           next_refresh_at = CASE
             WHEN kind = 'remote' THEN datetime('now', '+' || ? || ' minutes')
             ELSE NULL
           END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .bind(refreshIntervalMinutes, refreshIntervalMinutes, sourceId)
    .run();
}

export async function updateManualSource(
  sourceId: number,
  manualEntries: string,
  name?: string,
) {
  await ensureDatabase();
  const database = getD1();
  const source = await database
    .prepare("SELECT * FROM sources WHERE id = ?")
    .bind(sourceId)
    .first<SourceRow>();
  if (!source) throw new Error("Source not found.");
  if (source.kind !== "manual") {
    throw new Error("Only manual sources can be edited directly.");
  }
  const listIds = await getIpListIdsForSource(database, sourceId);
  const before = await snapshotIpLists(database, listIds);
  const entries = normalizeEntries(manualEntries, source.type, source.format);
  if (entries.length === 0) {
    throw new Error("Add at least one valid entry for this source type.");
  }
  const nextName = name?.trim() || source.name;
  if (nextName.length > 100) throw new Error("Source name is too long.");
  await database
    .prepare(
      `UPDATE sources SET
        name = ?, manual_entries = ?, cached_entries = ?, entry_count = ?,
        status = 'healthy', last_checked_at = CURRENT_TIMESTAMP,
        last_success_at = CURRENT_TIMESTAMP, last_error = NULL,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .bind(
      nextName,
      manualEntries,
      JSON.stringify(entries),
      entries.length,
      sourceId,
    )
    .run();
  await recordIpListChanges(database, before, listIds, "manual_update");
  return entries.length;
}

export async function refreshSource(
  sourceId: number,
  database = getD1(),
  initialize = true,
  trackAudit = true,
) {
  if (initialize) await ensureDatabase(database);
  const source = await database
    .prepare("SELECT * FROM sources WHERE id = ?")
    .bind(sourceId)
    .first<SourceRow>();
  if (!source) throw new Error("Source not found.");
  const listIds = trackAudit
    ? await getIpListIdsForSource(database, sourceId)
    : [];
  const before = trackAudit
    ? await snapshotIpLists(database, listIds)
    : new Map<number, Set<string>>();
  const startedAt = Date.now();
  logInfo("source.refresh.started", {
    sourceId,
    kind: source.api_provider ? "api" : source.kind,
  });

  try {
    const limits = await getSourceSafetyLimits(database, false);
    const apiHeaders: Record<string, string> = {};
    if (
      source.kind === "remote" &&
      source.api_auth_type !== "none" &&
      source.api_secret_ciphertext &&
      source.api_secret_iv
    ) {
      const secret = await decryptConfigSecret(
        runtimeEnv.CONFIG_ENCRYPTION_KEY,
        "edl-api-source",
        source.api_secret_ciphertext,
        source.api_secret_iv,
      );
      if (source.api_auth_type === "bearer") {
        apiHeaders.authorization = `Bearer ${secret}`;
      } else {
        apiHeaders[source.api_auth_header || "X-API-Key"] = secret;
      }
    }
    const raw =
      source.kind === "manual"
        ? source.manual_entries
        : await downloadSource(source.url ?? "", {
            headers: apiHeaders,
            maxBytes:
              (source.api_provider
                ? limits.apiSourceMaxMb
                : limits.remoteSourceMaxMb) * 1_000_000,
          });
    const entries = normalizeEntries(
      raw,
      source.type,
      source.format,
      source.json_path,
    );
    if (entries.length === 0) {
      throw new Error("No valid entries matched this source type.");
    }

    await database
      .prepare(
        `UPDATE sources
         SET cached_entries = ?, entry_count = ?, status = 'healthy',
             last_checked_at = CURRENT_TIMESTAMP,
             last_success_at = CURRENT_TIMESTAMP,
             last_error = NULL, updated_at = CURRENT_TIMESTAMP
             , next_refresh_at = CASE
               WHEN kind = 'remote'
                 THEN datetime('now', '+' || refresh_interval_minutes || ' minutes')
               ELSE NULL
             END
         WHERE id = ?`,
      )
      .bind(JSON.stringify(entries), entries.length, sourceId)
      .run();
    if (trackAudit) {
      await recordIpListChanges(
        database,
        before,
        listIds,
        "source_refresh",
      );
    }
    logInfo("source.refresh.completed", {
      sourceId,
      entries: entries.length,
      durationMs: Date.now() - startedAt,
    });
    return { ok: true, sourceId, entryCount: entries.length };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected refresh error.";
    await database
      .prepare(
        `UPDATE sources
         SET status = 'degraded', last_checked_at = CURRENT_TIMESTAMP,
             last_error = ?, updated_at = CURRENT_TIMESTAMP,
             next_refresh_at = CASE
               WHEN kind = 'remote'
                 THEN datetime('now', '+' || refresh_interval_minutes || ' minutes')
               ELSE NULL
             END
         WHERE id = ?`,
      )
      .bind(message, sourceId)
      .run();
    logError("source.refresh.failed", error, {
      sourceId,
      durationMs: Date.now() - startedAt,
    });
    return { ok: false, sourceId, error: message };
  }
}

export async function refreshList(listId: number) {
  const sources = await getSourcesForList(listId);
  const database = getD1();
  const before = await snapshotIpLists(database, [listId]);
  const results = await Promise.all(
    sources
      .filter((source) => source.enabled)
      .map((source) => refreshSource(source.id, database, false, false)),
  );
  await recordIpListChanges(database, before, [listId], "list_refresh");

  return {
    ok: results.every((result) => result.ok),
    refreshed: results.length,
    failed: results.filter((result) => !result.ok).length,
    results,
  };
}

export async function refreshDueSources(database = getD1()) {
  await ensureDatabase(database);
  const { results: dueSources } = await database
    .prepare(
      `SELECT id
       FROM sources
       WHERE enabled = 1
         AND kind = 'remote'
         AND (next_refresh_at IS NULL OR next_refresh_at <= CURRENT_TIMESTAMP)
       ORDER BY COALESCE(next_refresh_at, created_at)
       LIMIT 20`,
    )
    .all<{ id: number }>();

  const affectedListIds = new Set<number>();
  for (const source of dueSources) {
    const listIds = await getIpListIdsForSource(database, source.id);
    listIds.forEach((listId) => affectedListIds.add(listId));
  }
  const listIds = [...affectedListIds];
  const before = await snapshotIpLists(database, listIds);

  const results = await Promise.all(
    dueSources.map((source) =>
      refreshSource(source.id, database, false, false),
    ),
  );
  await recordIpListChanges(database, before, listIds, "scheduled_refresh");
  const summary = {
    ok: results.every((result) => result.ok),
    refreshed: results.length,
    failed: results.filter((result) => !result.ok).length,
    results,
  };
  logInfo("scheduler.refresh.completed", {
    due: dueSources.length,
    refreshed: summary.refreshed,
    failed: summary.failed,
  });
  return summary;
}

export async function getAggregatedList(slug: string) {
  const list = await getList(slug);
  if (!list) return null;

  const sources = await getSourcesForList(list.id);
  const includeSources = sources
    .filter((source) => source.enabled && source.role === "include")
    .map((source) => parseCachedEntries(source.cached_entries));
  const excludeSources = sources
    .filter((source) => source.enabled && source.role === "exclude")
    .map((source) => parseCachedEntries(source.cached_entries));

  return {
    list,
    sources,
    ...aggregateEntries(includeSources, excludeSources),
  };
}

async function aggregateIpListFromDatabase(
  database: D1Database,
  listId: number,
) {
  const { results } = await database
    .prepare(
      `SELECT sources.cached_entries, sources.enabled, list_sources.role
       FROM sources
       INNER JOIN list_sources ON list_sources.source_id = sources.id
       WHERE list_sources.list_id = ?`,
    )
    .bind(listId)
    .all<Pick<SourceRow, "cached_entries" | "enabled" | "role">>();
  const includeSources = results
    .filter((source) => source.enabled && source.role === "include")
    .map((source) => parseCachedEntries(source.cached_entries));
  const excludeSources = results
    .filter((source) => source.enabled && source.role === "exclude")
    .map((source) => parseCachedEntries(source.cached_entries));
  return aggregateEntries(includeSources, excludeSources).entries;
}

async function getIpListIdsForSource(
  database: D1Database,
  sourceId: number,
) {
  const { results } = await database
    .prepare(
      `SELECT edl_lists.id
       FROM edl_lists
       INNER JOIN list_sources ON list_sources.list_id = edl_lists.id
       WHERE list_sources.source_id = ? AND edl_lists.type = 'ip'`,
    )
    .bind(sourceId)
    .all<{ id: number }>();
  return results.map((row) => row.id);
}

async function snapshotIpLists(database: D1Database, listIds: number[]) {
  const snapshot = new Map<number, Set<string>>();
  for (const listId of [...new Set(listIds)]) {
    const list = await database
      .prepare("SELECT type FROM edl_lists WHERE id = ?")
      .bind(listId)
      .first<{ type: EdlType }>();
    if (list?.type === "ip") {
      snapshot.set(
        listId,
        new Set(await aggregateIpListFromDatabase(database, listId)),
      );
    }
  }
  return snapshot;
}

async function recordIpListChanges(
  database: D1Database,
  before: Map<number, Set<string>>,
  listIds: number[],
  reason: string,
) {
  const statements: ReturnType<D1Database["prepare"]>[] = [];
  let blocked = 0;
  let unblocked = 0;
  for (const listId of [...new Set(listIds)]) {
    const previous = before.get(listId);
    if (!previous) continue;
    const current = new Set(
      await aggregateIpListFromDatabase(database, listId),
    );
    for (const entry of current) {
      if (previous.has(entry)) continue;
      blocked += 1;
      statements.push(
        database
          .prepare(
            `INSERT INTO block_audit_events (list_id, entry, action, reason)
             VALUES (?, ?, 'blocked', ?)`,
          )
          .bind(listId, entry, reason),
        database
          .prepare(
            `INSERT INTO lifetime_blocked_entries (entry)
             VALUES (?)
             ON CONFLICT(entry) DO UPDATE SET
               last_seen_at = CURRENT_TIMESTAMP`,
          )
          .bind(entry),
      );
    }
    for (const entry of previous) {
      if (current.has(entry)) continue;
      unblocked += 1;
      statements.push(
        database
          .prepare(
            `INSERT INTO block_audit_events (list_id, entry, action, reason)
             VALUES (?, ?, 'unblocked', ?)`,
          )
          .bind(listId, entry, reason),
      );
    }
  }
  for (let index = 0; index < statements.length; index += 50) {
    await database.batch(statements.slice(index, index + 50));
  }
  if (statements.length) {
    logInfo("block_audit.recorded", { reason, blocked, unblocked });
  }
  return { blocked, unblocked };
}

async function backfillLifetimeBlockedEntries(database: D1Database) {
  await database
    .prepare(
      `INSERT OR IGNORE INTO lifetime_blocked_entries (entry)
       SELECT DISTINCT CAST(indicator.value AS TEXT)
       FROM edl_lists
       INNER JOIN list_sources AS include_links
         ON include_links.list_id = edl_lists.id
         AND include_links.role = 'include'
       INNER JOIN sources AS include_sources
         ON include_sources.id = include_links.source_id
         AND include_sources.enabled = 1
       INNER JOIN json_each(include_sources.cached_entries) AS indicator
       WHERE edl_lists.type = 'ip'
         AND NOT EXISTS (
           SELECT 1
           FROM list_sources AS exclude_links
           INNER JOIN sources AS exclude_sources
             ON exclude_sources.id = exclude_links.source_id
             AND exclude_sources.enabled = 1
           INNER JOIN json_each(exclude_sources.cached_entries) AS exclusion
           WHERE exclude_links.list_id = edl_lists.id
             AND exclude_links.role = 'exclude'
             AND exclusion.value = indicator.value
         )`,
    )
    .run();
}

export async function getBlockAudit(input: {
  query?: string;
  listId?: number;
  limit?: number;
}) {
  await ensureDatabase();
  const database = getD1();
  await backfillLifetimeBlockedEntries(database);
  const lifetime = await database
    .prepare("SELECT COUNT(*) AS count FROM lifetime_blocked_entries")
    .first<{ count: number }>();
  const query = input.query?.trim().toLowerCase().slice(0, 256) ?? "";
  const limit = Math.min(250, Math.max(1, input.limit ?? 100));
  const { results: allLists } = await database
    .prepare(
      `SELECT id, name, slug FROM edl_lists
       WHERE type = 'ip' ORDER BY name`,
    )
    .all<{ id: number; name: string; slug: string }>();
  const lists = input.listId
    ? allLists.filter((list) => list.id === input.listId)
    : allLists;

  const active: Array<{ listId: number; listName: string; entry: string }> = [];
  let activeCount = 0;
  for (const list of lists) {
    const entries = await aggregateIpListFromDatabase(database, list.id);
    activeCount += entries.length;
    for (const entry of entries) {
      if (query && !entry.toLowerCase().includes(query)) continue;
      if (active.length < limit) {
        active.push({ listId: list.id, listName: list.name, entry });
      }
    }
  }

  const searchPattern = `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const { results: events } = await database
    .prepare(
      `SELECT block_audit_events.*, edl_lists.name AS list_name
       FROM block_audit_events
       INNER JOIN edl_lists ON edl_lists.id = block_audit_events.list_id
       WHERE (? IS NULL OR block_audit_events.list_id = ?)
         AND (? = '' OR block_audit_events.entry LIKE ? ESCAPE '\\')
       ORDER BY block_audit_events.id DESC
       LIMIT ?`,
    )
    .bind(
      input.listId ?? null,
      input.listId ?? null,
      query,
      searchPattern,
      limit,
    )
    .all<BlockAuditEvent>();

  return {
    lists: allLists,
    active,
    activeCount,
    allTimeBlockedCount: Number(lifetime?.count ?? 0),
    events,
    note: "OpenEDL records published-list membership changes. Firewalls pull the full EDL, so per-connection enforcement events require firewall log integration.",
  };
}

export async function unblockPublishedEntry(listId: number, value: string) {
  await ensureDatabase();
  const database = getD1();
  const list = await database
    .prepare("SELECT id, type FROM edl_lists WHERE id = ?")
    .bind(listId)
    .first<{ id: number; type: EdlType }>();
  if (!list || list.type !== "ip") throw new Error("IP list not found.");
  const [entry] = normalizeEntries(value, "ip", "text");
  if (!entry || normalizeEntries(value, "ip", "text").length !== 1) {
    throw new Error("Enter one valid IP address, range, or CIDR block.");
  }
  const current = await aggregateIpListFromDatabase(database, listId);
  if (!current.includes(entry)) {
    throw new Error("That entry is not currently published by this list.");
  }

  const before = await snapshotIpLists(database, [listId]);
  const source = await database
    .prepare(
      `SELECT sources.* FROM sources
       INNER JOIN list_sources ON list_sources.source_id = sources.id
       WHERE list_sources.list_id = ? AND list_sources.role = 'exclude'
         AND sources.kind = 'manual' AND sources.enabled = 1
       ORDER BY CASE WHEN sources.name = 'Unblocked IPs' THEN 0 ELSE 1 END,
         sources.id
       LIMIT 1`,
    )
    .bind(listId)
    .first<SourceRow>();

  if (!source) {
    const result = await database
      .prepare(
        `INSERT INTO sources (
          name, kind, type, format, manual_entries, enabled, cached_entries,
          entry_count, status, last_checked_at, last_success_at
        ) VALUES ('Unblocked IPs', 'manual', 'ip', 'text', ?, 1, ?, 1,
          'healthy', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      )
      .bind(entry, JSON.stringify([entry]))
      .run();
    const sourceId = Number(result.meta.last_row_id);
    await database
      .prepare(
        `INSERT INTO list_sources (list_id, source_id, role)
         VALUES (?, ?, 'exclude')`,
      )
      .bind(listId, sourceId)
      .run();
  } else {
    const entries = new Set(parseCachedEntries(source.cached_entries));
    entries.add(entry);
    const nextEntries = [...entries].sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true }),
    );
    await database
      .prepare(
        `UPDATE sources SET manual_entries = ?, cached_entries = ?,
           entry_count = ?, last_checked_at = CURRENT_TIMESTAMP,
           last_success_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(
        nextEntries.join("\n"),
        JSON.stringify(nextEntries),
        nextEntries.length,
        source.id,
      )
      .run();
  }
  await recordIpListChanges(database, before, [listId], "manual_unblock");
  return { ok: true, entry };
}
