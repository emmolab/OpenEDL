import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";

const projectRoot = process.cwd();
const environmentFile = resolve(projectRoot, ".env.cloudflare");

if (existsSync(environmentFile)) {
  loadEnvFile(environmentFile);
}

// Avoid Wrangler writing deployment logs outside the project workspace.
process.env.WRANGLER_WRITE_LOGS ??= "false";
process.env.WRANGLER_LOG_PATH ??= resolve(
  projectRoot,
  ".wrangler",
  "logs",
);

const workerName =
  process.env.CLOUDFLARE_WORKER_NAME?.trim() || "openedl";
const databaseName =
  process.env.CLOUDFLARE_D1_DATABASE_NAME?.trim() || "openedl";
const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID?.trim();

if (!databaseId) {
  console.error(
    "CLOUDFLARE_D1_DATABASE_ID is required. Copy .env.cloudflare.example " +
      "to .env.cloudflare and add the ID returned by `wrangler d1 create`.",
  );
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
run(npmCommand, ["run", "build:cloudflare"]);

const generatedConfigPath = resolve(
  projectRoot,
  "dist",
  "server",
  "wrangler.json",
);
const deploymentConfigPath = resolve(
  projectRoot,
  "dist",
  "server",
  "wrangler.deploy.json",
);
const config = JSON.parse(readFileSync(generatedConfigPath, "utf8"));

config.name = workerName;
config.topLevelName = workerName;
config.d1_databases = [
  {
    binding: "DB",
    database_name: databaseName,
    database_id: databaseId,
  },
];
config.assets = {
  ...config.assets,
  binding: "ASSETS",
};
config.images = {
  binding: "IMAGES",
};

writeFileSync(
  deploymentConfigPath,
  `${JSON.stringify(config, null, 2)}\n`,
);
rmSync(resolve(projectRoot, "dist", ".openai"), {
  force: true,
  recursive: true,
});

const wranglerArgs = [
  "exec",
  "wrangler",
  "--",
  "deploy",
  "--config",
  deploymentConfigPath,
  ...process.argv.slice(2),
];
const secretsFile = process.env.CLOUDFLARE_SECRETS_FILE?.trim();
const hasSecretsFileArgument = wranglerArgs.some(
  (argument) =>
    argument === "--secrets-file" ||
    argument.startsWith("--secrets-file="),
);

if (secretsFile && !hasSecretsFileArgument) {
  const secretsFilePath = resolve(projectRoot, secretsFile);
  if (!existsSync(secretsFilePath)) {
    console.error(
      `CLOUDFLARE_SECRETS_FILE does not exist: ${secretsFilePath}`,
    );
    process.exit(1);
  }
  wranglerArgs.push("--secrets-file", secretsFilePath);
}

run(npmCommand, wranglerArgs);
