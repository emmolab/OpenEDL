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

type RuntimeEnv = {
  DB?: D1Database;
  CONFIG_ENCRYPTION_KEY?: string;
};

export type AppTheme = "signal" | "ocean" | "ember" | "midnight";

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
          theme TEXT NOT NULL DEFAULT 'signal' CHECK(theme IN ('signal', 'ocean', 'ember')),
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
       VALUES ('endpoint_base_url', '')`,
    )
    .run();
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
  return ["signal", "ocean", "ember", "midnight"].includes(row?.value ?? "")
    ? (row?.value as AppTheme)
    : "signal";
}

export async function updateAppTheme(theme: string) {
  if (!["signal", "ocean", "ember", "midnight"].includes(theme)) {
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

export async function getEndpointBaseUrl() {
  await ensureDatabase();
  const row = await getD1()
    .prepare("SELECT value FROM app_settings WHERE key = 'endpoint_base_url'")
    .first<{ value: string }>();
  return row?.value ?? "";
}

export async function updateEndpointBaseUrl(value: string) {
  const normalized = value.trim().replace(/\/+$/, "");
  if (normalized) {
    let url: URL;
    try {
      url = new URL(normalized);
    } catch {
      throw new Error("Enter a valid public HTTP or HTTPS URL.");
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      (url.pathname !== "/" && url.pathname !== "") ||
      url.search ||
      url.hash
    ) {
      throw new Error(
        "Public endpoint base URL must be an HTTP or HTTPS origin without a path.",
      );
    }
  }
  await ensureDatabase();
  await getD1()
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('endpoint_base_url', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(normalized)
    .run();
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

  return sourceId;
}

export async function deleteSource(sourceId: number) {
  await ensureDatabase();
  await getD1().prepare("DELETE FROM sources WHERE id = ?").bind(sourceId).run();
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
  return entries.length;
}

export async function refreshSource(
  sourceId: number,
  database = getD1(),
  initialize = true,
) {
  if (initialize) await ensureDatabase(database);
  const source = await database
    .prepare("SELECT * FROM sources WHERE id = ?")
    .bind(sourceId)
    .first<SourceRow>();
  if (!source) throw new Error("Source not found.");

  try {
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
            apiSource: Boolean(source.api_provider),
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
    return { ok: false, sourceId, error: message };
  }
}

export async function refreshList(listId: number) {
  const sources = await getSourcesForList(listId);
  const results = await Promise.all(
    sources
      .filter((source) => source.enabled)
      .map((source) => refreshSource(source.id)),
  );

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

  const results = await Promise.all(
    dueSources.map((source) => refreshSource(source.id, database, false)),
  );
  return {
    ok: results.every((result) => result.ok),
    refreshed: results.length,
    failed: results.filter((result) => !result.ok).length,
    results,
  };
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
