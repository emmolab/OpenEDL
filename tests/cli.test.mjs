import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { resetAdminPassword } from "../scripts/openedl-cli.mjs";

test("CLI resets a local administrator password and revokes sessions", async (context) => {
  const workingDirectory = await mkdtemp(join(tmpdir(), "openedl-cli-"));
  const databasePath = join(workingDirectory, "openedl.sqlite");
  let database = new DatabaseSync(databasePath);

  context.after(async () => {
    database.close();
    await rm(workingDirectory, { force: true, recursive: true });
  });

  database.exec(`
    CREATE TABLE auth_users (
      id INTEGER PRIMARY KEY,
      provider TEXT NOT NULL,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      active INTEGER NOT NULL,
      password_hash TEXT,
      password_salt TEXT,
      password_iterations INTEGER,
      failed_login_attempts INTEGER NOT NULL,
      locked_until TEXT,
      deleted_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE auth_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL
    );
    INSERT INTO auth_users VALUES (
      1, 'local', 'admin@example.com', 'Administrator', 'admin', 1,
      'old-hash', 'old-salt', 1, 5, '2099-01-01', NULL, CURRENT_TIMESTAMP
    );
    INSERT INTO auth_sessions VALUES ('existing-session', 1);
  `);
  database.close();

  const email = await resetAdminPassword(
    {
      databasePath,
      email: "",
      passwordStdin: false,
    },
    "correct horse battery staple",
  );
  assert.equal(email, "admin@example.com");

  database = new DatabaseSync(databasePath);
  const user = database
    .prepare(
      `SELECT password_hash, password_salt, password_iterations,
              failed_login_attempts, locked_until
       FROM auth_users WHERE id = 1`,
    )
    .get();
  assert.notEqual(user.password_hash, "old-hash");
  assert.notEqual(user.password_salt, "old-salt");
  assert.equal(user.password_iterations, 600_000);
  assert.equal(user.failed_login_attempts, 0);
  assert.equal(user.locked_until, null);
  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM auth_sessions").get().count,
    0,
  );

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("correct horse battery staple"),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const candidate = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: Buffer.from(user.password_salt, "base64url"),
      iterations: user.password_iterations,
    },
    key,
    256,
  );
  assert.equal(Buffer.from(candidate).toString("base64url"), user.password_hash);
});
