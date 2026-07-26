import { spawn } from "node:child_process";

const port = process.env.PORT || "3000";
const cronSecret = process.env.CRON_SECRET?.trim();
const server = spawn(process.execPath, ["server.js"], {
  env: process.env,
  stdio: "inherit",
});

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
    if (!response.ok) {
      console.error(
        `Scheduled source refresh failed with HTTP ${response.status}.`,
      );
    }
  } catch (error) {
    console.error("Scheduled source refresh failed.", error);
  }
}

if (cronSecret) {
  initialRefreshTimer = setTimeout(refreshDueSources, 15_000);
  refreshTimer = setInterval(refreshDueSources, 5 * 60_000);
} else {
  console.warn(
    "CRON_SECRET is unset; automatic source refreshes are disabled.",
  );
}

function stop(signal) {
  if (initialRefreshTimer) clearTimeout(initialRefreshTimer);
  if (refreshTimer) clearInterval(refreshTimer);
  server.kill(signal);
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
server.on("exit", (code, signal) => {
  if (initialRefreshTimer) clearTimeout(initialRefreshTimer);
  if (refreshTimer) clearInterval(refreshTimer);
  process.exit(code ?? (signal ? 0 : 1));
});
