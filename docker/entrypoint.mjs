import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

function log(level, event, fields = {}) {
  console[level](
    `[OpenEDL] ${JSON.stringify({
      time: new Date().toISOString(),
      level,
      event,
      ...fields,
    })}`,
  );
}

const port = process.env.PORT || "3000";
const configuredCronSecret = process.env.CRON_SECRET?.trim();
const cronSecret =
  configuredCronSecret || randomBytes(32).toString("base64url");
const server = spawn(process.execPath, ["server.js"], {
  env: {
    ...process.env,
    CRON_SECRET: cronSecret,
  },
  stdio: "inherit",
});
log("info", "server.process.started", { port: Number(port) });

let refreshTimer;
let initialRefreshTimer;

async function refreshDueSources() {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/cron/refresh`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${cronSecret}`,
      },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      log("error", "scheduler.request.failed", {
        status: response.status,
        error: payload?.error ?? "Unexpected scheduler response",
      });
      return;
    }
    log("info", "scheduler.request.completed", {
      refreshed: payload?.refreshed ?? 0,
      failed: payload?.failed ?? 0,
    });
  } catch (error) {
    log("error", "scheduler.request.failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

if (!configuredCronSecret) {
  log("info", "scheduler.token.generated", { persistent: false });
}
log("info", "scheduler.started", {
  intervalMinutes: 5,
  initialDelaySeconds: 15,
});
initialRefreshTimer = setTimeout(refreshDueSources, 15_000);
refreshTimer = setInterval(refreshDueSources, 5 * 60_000);

function stop(signal) {
  if (initialRefreshTimer) clearTimeout(initialRefreshTimer);
  if (refreshTimer) clearInterval(refreshTimer);
  log("info", "server.process.stopping", { signal });
  server.kill(signal);
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
server.on("exit", (code, signal) => {
  if (initialRefreshTimer) clearTimeout(initialRefreshTimer);
  if (refreshTimer) clearInterval(refreshTimer);
  log(code === 0 || signal ? "info" : "error", "server.process.exited", {
    code,
    signal,
  });
  process.exit(code ?? (signal ? 0 : 1));
});
