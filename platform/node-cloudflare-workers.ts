import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, extname, resolve } from "node:path";
import {
  backup as backupDatabase,
  DatabaseSync,
  type SQLInputValue,
  type SQLOutputValue,
} from "node:sqlite";

type Row = Record<string, SQLOutputValue>;

const MAX_RESTORE_UPLOAD_BYTES = 1_000_000_000;

type D1Result<T = unknown> = {
  results: T[];
  success: true;
  meta: {
    changes: number;
    last_row_id: number;
    duration: number;
  };
};

function normalizeBinding(value: unknown): SQLInputValue {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint"
  ) {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(
      value.buffer as ArrayBuffer,
      value.byteOffset,
      value.byteLength,
    );
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError(`Unsupported SQLite binding: ${typeof value}`);
}

function emptyMeta(duration: number) {
  return {
    changes: 0,
    last_row_id: 0,
    duration,
  };
}

class NodeD1PreparedStatement {
  constructor(
    private readonly runOperation: <T>(
      operation: (database: DatabaseSync) => T,
    ) => T,
    private readonly sql: string,
    private readonly bindings: SQLInputValue[] = [],
  ) {}

  bind(...values: unknown[]) {
    return new NodeD1PreparedStatement(
      this.runOperation,
      this.sql,
      values.map(normalizeBinding),
    );
  }

  async first<T = Row>(columnName?: string): Promise<T | null> {
    return this.runOperation((database) => {
      const row = database.prepare(this.sql).get(...this.bindings);
      if (!row) return null;
      return (columnName ? row[columnName] : row) as T;
    });
  }

  async all<T = Row>(): Promise<D1Result<T>> {
    return this.runOperation((database) => {
      const startedAt = performance.now();
      const results = database.prepare(this.sql).all(...this.bindings) as T[];
      return {
        results,
        success: true,
        meta: emptyMeta(performance.now() - startedAt),
      };
    });
  }

  async raw<T = SQLOutputValue[]>(
    options: { columnNames?: boolean } = {},
  ): Promise<T[]> {
    return this.runOperation((database) => {
      const statement = database.prepare(this.sql);
      statement.setReturnArrays(true);
      const rows = statement.all(
        ...this.bindings,
      ) as unknown as SQLOutputValue[][];
      if (options.columnNames) {
        return [
          statement.columns().map((column) => column.name),
          ...rows,
        ] as T[];
      }
      return rows as T[];
    });
  }

  async run(): Promise<D1Result> {
    return this.runOperation((database) => this.runWithDatabase(database));
  }

  runWithDatabase(database: DatabaseSync): D1Result {
    const startedAt = performance.now();
    const result = database.prepare(this.sql).run(...this.bindings);
    return {
      results: [],
      success: true,
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
        duration: performance.now() - startedAt,
      },
    };
  }
}

class NodeD1Database {
  private database: DatabaseSync;
  private readonly databasePath: string;
  readonly backupDirectory: string;
  private readonly backupPrefix: string;
  private activeOperations = 0;
  private restoreInProgress = false;
  private idleWaiters: Array<() => void> = [];

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.databasePath = path;
    this.database = this.openDatabase();
    const databaseName = basename(path, extname(path)) || "openedl";
    this.backupPrefix = `${databaseName}-backup-`;
    const configuredBackupDirectory = process.env.DATABASE_BACKUP_DIR?.trim();
    this.backupDirectory = configuredBackupDirectory
      ? resolve(configuredBackupDirectory)
      : resolve(
          path === ":memory:" ? process.cwd() : dirname(path),
          "backups",
        );
  }

  private openDatabase() {
    const database = new DatabaseSync(this.databasePath, {
      timeout: 5_000,
      enableForeignKeyConstraints: true,
    });
    database.exec("PRAGMA journal_mode = WAL");
    database.exec("PRAGMA busy_timeout = 5000");
    return database;
  }

  private beginOperation() {
    if (this.restoreInProgress) {
      throw new Error("Database restore is in progress. Try again shortly.");
    }
    this.activeOperations += 1;
    return this.database;
  }

  private endOperation() {
    this.activeOperations -= 1;
    if (this.activeOperations === 0) {
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      waiters.forEach((resolveIdle) => resolveIdle());
    }
  }

  private runOperation<T>(operation: (database: DatabaseSync) => T) {
    const database = this.beginOperation();
    try {
      return operation(database);
    } finally {
      this.endOperation();
    }
  }

  private async waitUntilIdle() {
    if (this.activeOperations === 0) return;
    await new Promise<void>((resolveIdle) => {
      this.idleWaiters.push(resolveIdle);
    });
  }

  prepare(sql: string) {
    return new NodeD1PreparedStatement(
      (operation) => this.runOperation(operation),
      sql,
    );
  }

  async batch(statements: NodeD1PreparedStatement[]) {
    const database = this.beginOperation();
    const results: D1Result[] = [];
    let transactionStarted = false;
    try {
      database.exec("BEGIN IMMEDIATE");
      transactionStarted = true;
      for (const statement of statements) {
        results.push(statement.runWithDatabase(database));
      }
      database.exec("COMMIT");
      transactionStarted = false;
      return results;
    } catch (error) {
      if (transactionStarted) database.exec("ROLLBACK");
      throw error;
    } finally {
      this.endOperation();
    }
  }

  async exec(sql: string): Promise<D1Result> {
    return this.runOperation((database) => {
      const startedAt = performance.now();
      database.exec(sql);
      return {
        results: [],
        success: true,
        meta: emptyMeta(performance.now() - startedAt),
      };
    });
  }

  private verifyDatabase(database: DatabaseSync) {
    const result = database.prepare("PRAGMA quick_check").get() as
      | Record<string, unknown>
      | undefined;
    if (Object.values(result ?? {})[0] !== "ok") {
      throw new Error("SQLite integrity verification failed.");
    }
  }

  private backupFileNames() {
    mkdirSync(this.backupDirectory, { recursive: true });
    return readdirSync(this.backupDirectory)
      .filter(
        (candidate) =>
          candidate === basename(candidate) &&
          candidate.startsWith(this.backupPrefix) &&
          candidate.endsWith(".sqlite"),
      )
      .sort()
      .reverse();
  }

  private async createBackupFile(
    database: DatabaseSync,
    retentionCount: number,
  ) {
    const createdAt = new Date();
    const timestamp = createdAt
      .toISOString()
      .replaceAll(":", "-")
      .replace(".", "-");
    const fileName = `${this.backupPrefix}${timestamp}.sqlite`;
    const destination = resolve(this.backupDirectory, fileName);

    await backupDatabase(database, destination);
    const verification = new DatabaseSync(destination, { readOnly: true });
    let verificationError: unknown;
    try {
      this.verifyDatabase(verification);
    } catch (error) {
      verificationError = error;
    } finally {
      verification.close();
    }
    if (verificationError) {
      unlinkSync(destination);
      throw verificationError;
    }

    const backupFiles = this.backupFileNames();
    const expiredFiles = backupFiles.slice(retentionCount);
    for (const expiredFile of expiredFiles) {
      unlinkSync(resolve(this.backupDirectory, expiredFile));
    }

    return {
      createdAt: createdAt.toISOString(),
      fileName,
      pruned: expiredFiles.length,
      sizeBytes: statSync(destination).size,
    };
  }

  async createBackup(retentionCount: number) {
    const database = this.beginOperation();
    try {
      return await this.createBackupFile(database, retentionCount);
    } finally {
      this.endOperation();
    }
  }

  listBackups() {
    return this.runOperation(() =>
      this.backupFileNames().map((fileName) => {
        const stats = statSync(resolve(this.backupDirectory, fileName));
        return {
          fileName,
          createdAt: stats.mtime.toISOString(),
          sizeBytes: stats.size,
        };
      }),
    );
  }

  async importBackup(
    originalFileName: string,
    content: ReadableStream<Uint8Array>,
  ) {
    if (
      originalFileName.length < 1 ||
      originalFileName.length > 255 ||
      originalFileName !== basename(originalFileName) ||
      !/\.(?:db|sqlite|sqlite3)$/i.test(originalFileName)
    ) {
      throw new Error("Select a .sqlite, .sqlite3, or .db backup file.");
    }

    mkdirSync(this.backupDirectory, { recursive: true });
    const timestamp = new Date()
      .toISOString()
      .replaceAll(":", "-")
      .replace(".", "-");
    const fileName = `${this.backupPrefix}${timestamp}-imported-${randomUUID().slice(0, 8)}.sqlite`;
    const destination = resolve(this.backupDirectory, fileName);
    const temporaryPath = resolve(
      this.backupDirectory,
      `.openedl-restore-upload-${randomUUID()}.tmp`,
    );
    const reader = content.getReader();
    let descriptor: number | null = null;
    let sizeBytes = 0;
    let completed = false;
    this.beginOperation();
    try {
      descriptor = openSync(temporaryPath, "wx", 0o600);
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        sizeBytes += chunk.value.byteLength;
        if (sizeBytes > MAX_RESTORE_UPLOAD_BYTES) {
          throw new Error("Database backup uploads cannot exceed 1 GB.");
        }
        let offset = 0;
        while (offset < chunk.value.byteLength) {
          offset += writeSync(
            descriptor,
            chunk.value,
            offset,
            chunk.value.byteLength - offset,
          );
        }
      }
      if (sizeBytes === 0) throw new Error("The uploaded backup file is empty.");
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = null;

      const verification = new DatabaseSync(temporaryPath, { readOnly: true });
      try {
        this.verifyDatabase(verification);
      } finally {
        verification.close();
      }
      renameSync(temporaryPath, destination);
      completed = true;
      return {
        createdAt: new Date().toISOString(),
        fileName,
        originalFileName,
        sizeBytes,
      };
    } finally {
      if (descriptor !== null) closeSync(descriptor);
      if (!completed && existsSync(temporaryPath)) unlinkSync(temporaryPath);
      await reader.cancel().catch(() => undefined);
      this.endOperation();
    }
  }

  private removeDatabaseSidecars() {
    for (const suffix of ["-wal", "-shm"]) {
      const sidecar = `${this.databasePath}${suffix}`;
      if (existsSync(sidecar)) unlinkSync(sidecar);
    }
  }

  private async replaceDatabaseFrom(sourcePath: string) {
    const source = new DatabaseSync(sourcePath, { readOnly: true });
    try {
      this.verifyDatabase(source);
      try {
        this.database.close();
      } catch {
        // The previous restore attempt may already have closed this handle.
      }
      this.removeDatabaseSidecars();
      await backupDatabase(source, this.databasePath);
    } finally {
      source.close();
    }
    this.removeDatabaseSidecars();
    this.database = this.openDatabase();
    this.verifyDatabase(this.database);
  }

  async restoreBackup(fileName: string, retentionCount: number) {
    if (this.databasePath === ":memory:") {
      throw new Error("In-memory SQLite databases cannot be restored from a file.");
    }
    if (
      fileName !== basename(fileName) ||
      !fileName.startsWith(this.backupPrefix) ||
      !fileName.endsWith(".sqlite")
    ) {
      throw new Error("Invalid database backup file.");
    }
    const selectedPath = resolve(this.backupDirectory, fileName);
    if (!this.backupFileNames().includes(fileName)) {
      throw new Error("The selected database backup no longer exists.");
    }
    if (this.restoreInProgress) {
      throw new Error("A database restore is already in progress.");
    }

    this.restoreInProgress = true;
    await this.waitUntilIdle();
    let safetyBackup: Awaited<ReturnType<NodeD1Database["createBackupFile"]>>;
    try {
      const currentBackupCount = this.backupFileNames().length;
      safetyBackup = await this.createBackupFile(
        this.database,
        Math.max(retentionCount + 1, currentBackupCount + 1),
      );
      try {
        await this.replaceDatabaseFrom(selectedPath);
      } catch (restoreError) {
        try {
          await this.replaceDatabaseFrom(
            resolve(this.backupDirectory, safetyBackup.fileName),
          );
        } catch (rollbackError) {
          throw new AggregateError(
            [restoreError, rollbackError],
            "Database restore and automatic rollback both failed.",
          );
        }
        throw new Error(
          "Database restore failed. The pre-restore safety backup was restored automatically.",
          { cause: restoreError },
        );
      }
      const selectedStats = statSync(selectedPath);
      return {
        restoredAt: new Date().toISOString(),
        fileName,
        sizeBytes: selectedStats.size,
        safetyBackupFileName: safetyBackup.fileName,
      };
    } finally {
      this.restoreInProgress = false;
    }
  }
}

const configuredPath = process.env.DATABASE_PATH?.trim();
const databasePath =
  configuredPath || resolve(process.cwd(), "data", "openedl.sqlite");
const database = new NodeD1Database(databasePath);

export const env = new Proxy<Record<string, unknown>>(
  {},
  {
    get(_target, property) {
      if (property === "DB") return database;
      return typeof property === "string" ? process.env[property] : undefined;
    },
  },
);
