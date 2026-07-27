#!/usr/bin/env node

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const PASSWORD_ITERATIONS = 600_000;
const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 128;

function usage() {
  return `Usage:
  openedl-cli.mjs reset-admin-password [email] [--password-stdin] [--database PATH]

Reset a local administrator password, clear its login lockout, and revoke all
of its existing sessions. If email is omitted, the command selects the account
when exactly one local administrator exists.

Options:
  --password-stdin  Read one password line from standard input instead of a TTY
  --database PATH   Override DATABASE_PATH
  -h, --help        Show this help`;
}

function parseArguments(arguments_) {
  const options = {
    command:
      arguments_[0] === "--help" || arguments_[0] === "-h"
        ? "help"
        : arguments_[0],
    databasePath: process.env.DATABASE_PATH?.trim() || "",
    email: "",
    passwordStdin: false,
  };

  for (let index = 1; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--password-stdin") {
      options.passwordStdin = true;
    } else if (argument === "--database") {
      options.databasePath = arguments_[index + 1] ?? "";
      index += 1;
      if (!options.databasePath) throw new Error("--database requires a path.");
    } else if (argument === "--help" || argument === "-h") {
      options.command = "help";
    } else if (argument.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    } else if (!options.email) {
      options.email = argument.trim().toLowerCase();
    } else {
      throw new Error(`Unexpected argument: ${argument}`);
    }
  }

  return options;
}

function readStandardInput() {
  return new Promise((resolveInput, reject) => {
    let value = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      value += chunk;
    });
    process.stdin.on("end", () => resolveInput(value.replace(/\r?\n$/, "")));
    process.stdin.on("error", reject);
  });
}

function readHidden(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      "An interactive terminal is required. Use --password-stdin for non-interactive input.",
    );
  }

  return new Promise((resolveInput, reject) => {
    let value = "";
    const wasRaw = process.stdin.isRaw;
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    function cleanup() {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(Boolean(wasRaw));
      if (!wasRaw) process.stdin.pause();
    }

    function onData(chunk) {
      for (const character of chunk) {
        if (character === "\u0003") {
          cleanup();
          process.stdout.write("\n");
          reject(new Error("Cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          process.stdout.write("\n");
          resolveInput(value);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = Array.from(value).slice(0, -1).join("");
          continue;
        }
        if (character >= " ") value += character;
      }
    }

    process.stdin.on("data", onData);
  });
}

function validatePassword(password) {
  if (
    password.length < PASSWORD_MIN_LENGTH ||
    password.length > PASSWORD_MAX_LENGTH
  ) {
    throw new Error(
      `Password must be ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters.`,
    );
  }
}

function toBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

async function hashPassword(password) {
  validatePassword(password);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations: PASSWORD_ITERATIONS,
    },
    key,
    256,
  );
  return {
    hash: toBase64Url(new Uint8Array(bits)),
    salt: toBase64Url(salt),
  };
}

function selectAdministrator(database, requestedEmail) {
  const administrators = database
    .prepare(
      `SELECT id, email, name, active
       FROM auth_users
       WHERE provider = 'local' AND role = 'admin' AND deleted_at IS NULL
       ORDER BY id`,
    )
    .all();

  if (requestedEmail) {
    const administrator = administrators.find(
      ({ email }) => email.toLowerCase() === requestedEmail,
    );
    if (!administrator) {
      throw new Error(`No local administrator exists for ${requestedEmail}.`);
    }
    return administrator;
  }

  if (administrators.length === 0) {
    throw new Error("No local administrator account exists.");
  }
  if (administrators.length > 1) {
    const emails = administrators.map(({ email }) => email).join(", ");
    throw new Error(
      `More than one local administrator exists; specify one of: ${emails}`,
    );
  }
  return administrators[0];
}

export async function resetAdminPassword(options, suppliedPassword) {
  const databasePath = resolve(
    options.databasePath || resolve(process.cwd(), "data", "openedl.sqlite"),
  );
  if (!existsSync(databasePath)) {
    throw new Error(`OpenEDL database not found: ${databasePath}`);
  }

  const database = new DatabaseSync(databasePath, {
    timeout: 5_000,
    enableForeignKeyConstraints: true,
  });
  try {
    const table = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'auth_users'",
      )
      .get();
    if (!table) {
      throw new Error(
        `OpenEDL authentication schema not found in ${databasePath}.`,
      );
    }

    const administrator = selectAdministrator(database, options.email);
    if (!administrator.active) {
      throw new Error(
        `${administrator.email} is disabled. Reactivate it from another administrator account first.`,
      );
    }

    let password;
    if (suppliedPassword !== undefined) {
      password = suppliedPassword;
    } else if (options.passwordStdin) {
      password = await readStandardInput();
    } else {
      password = await readHidden("New password: ");
      validatePassword(password);
      const confirmation = await readHidden("Confirm password: ");
      if (password !== confirmation) throw new Error("Passwords do not match.");
    }

    const hashed = await hashPassword(password);
    database.exec("BEGIN IMMEDIATE");
    try {
      const result = database
        .prepare(
          `UPDATE auth_users SET
             password_hash = ?,
             password_salt = ?,
             password_iterations = ?,
             failed_login_attempts = 0,
             locked_until = NULL,
             updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        )
        .run(
          hashed.hash,
          hashed.salt,
          PASSWORD_ITERATIONS,
          administrator.id,
        );
      if (result.changes !== 1) throw new Error("Administrator update failed.");
      database
        .prepare("DELETE FROM auth_sessions WHERE user_id = ?")
        .run(administrator.id);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }

    return administrator.email;
  } finally {
    database.close();
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.command === "help" || !options.command) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (options.command !== "reset-admin-password") {
    throw new Error(`Unknown command: ${options.command}\n\n${usage()}`);
  }
  const email = await resetAdminPassword(options);
  process.stdout.write(
    `Password reset for ${email}; existing sessions were revoked.\n`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    process.stderr.write(
      `Error: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
