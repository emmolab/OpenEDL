import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  DatabaseSync,
  type SQLInputValue,
  type SQLOutputValue,
} from "node:sqlite";

type Row = Record<string, SQLOutputValue>;

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
    private readonly database: DatabaseSync,
    private readonly sql: string,
    private readonly bindings: SQLInputValue[] = [],
  ) {}

  bind(...values: unknown[]) {
    return new NodeD1PreparedStatement(
      this.database,
      this.sql,
      values.map(normalizeBinding),
    );
  }

  async first<T = Row>(columnName?: string): Promise<T | null> {
    const row = this.database.prepare(this.sql).get(...this.bindings);
    if (!row) return null;
    return (columnName ? row[columnName] : row) as T;
  }

  async all<T = Row>(): Promise<D1Result<T>> {
    const startedAt = performance.now();
    const results = this.database
      .prepare(this.sql)
      .all(...this.bindings) as T[];
    return {
      results,
      success: true,
      meta: emptyMeta(performance.now() - startedAt),
    };
  }

  async raw<T = SQLOutputValue[]>(
    options: { columnNames?: boolean } = {},
  ): Promise<T[]> {
    const statement = this.database.prepare(this.sql);
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
  }

  async run(): Promise<D1Result> {
    const startedAt = performance.now();
    const result = this.database.prepare(this.sql).run(...this.bindings);
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
  private readonly database: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path, {
      timeout: 5_000,
      enableForeignKeyConstraints: true,
    });
    this.database.exec("PRAGMA journal_mode = WAL");
    this.database.exec("PRAGMA busy_timeout = 5000");
  }

  prepare(sql: string) {
    return new NodeD1PreparedStatement(this.database, sql);
  }

  async batch(statements: NodeD1PreparedStatement[]) {
    const results: D1Result[] = [];
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const statement of statements) {
        results.push(await statement.run());
      }
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  async exec(sql: string): Promise<D1Result> {
    const startedAt = performance.now();
    this.database.exec(sql);
    return {
      results: [],
      success: true,
      meta: emptyMeta(performance.now() - startedAt),
    };
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
