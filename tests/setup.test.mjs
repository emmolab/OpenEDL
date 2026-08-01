import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  const port = address.port;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

async function waitForServer(baseUrl, child, output) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`OpenEDL exited before startup.\n${output()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // The listener is not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for OpenEDL.\n${output()}`);
}

test("first-run setup ignores legacy bootstrap variables, creates one administrator, and signs them in", {
  timeout: 30_000,
}, async (context) => {
  const workingDirectory = await mkdtemp(join(tmpdir(), "openedl-setup-"));
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let logs = "";
  const child = spawn(process.execPath, ["dist/standalone/server.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ADMIN_TOKEN: "",
      AUTH_BASE_URL: baseUrl,
      CONFIG_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
      DATABASE_PATH: join(workingDirectory, "openedl.sqlite"),
      HOST: "127.0.0.1",
      HOSTNAME: "127.0.0.1",
      LOCAL_AUTH_BOOTSTRAP_EMAIL: "legacy-bootstrap@example.com",
      LOCAL_AUTH_BOOTSTRAP_NAME: "Legacy bootstrap",
      LOCAL_AUTH_BOOTSTRAP_PASSWORD: "this must no longer create an account",
      MICROSOFT_OIDC_CLIENT_ID: "",
      MICROSOFT_OIDC_CLIENT_SECRET: "",
      MICROSOFT_OIDC_TENANT_ID: "",
      OIDC_PROVIDERS_JSON: "",
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => {
    logs += chunk;
  });
  child.stderr.on("data", (chunk) => {
    logs += chunk;
  });

  context.after(async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
    await rm(workingDirectory, { force: true, recursive: true });
  });

  await waitForServer(baseUrl, child, () => logs);

  const unauthorizedDashboard = await fetch(`${baseUrl}/api/dashboard`);
  assert.equal(unauthorizedDashboard.status, 401);
  const unauthorizedMaintenance = await fetch(
    `${baseUrl}/api/settings/maintenance`,
  );
  assert.equal(unauthorizedMaintenance.status, 401);
  const unauthorizedAudit = await fetch(`${baseUrl}/api/audit/blocks`);
  assert.equal(unauthorizedAudit.status, 401);

  const initialStatus = await fetch(`${baseUrl}/api/setup`);
  assert.equal(initialStatus.status, 200);
  assert.deepEqual(await initialStatus.json(), { required: true });

  const invalidSetup = await fetch(`${baseUrl}/api/setup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Initial administrator",
      email: "admin@example.com",
      password: "short",
    }),
  });
  assert.equal(invalidSetup.status, 400);
  assert.match(
    (await invalidSetup.json()).error,
    /Password must be 12–128 characters/,
  );

  const setupResponse = await fetch(`${baseUrl}/api/setup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Initial administrator",
      email: "admin@example.com",
      password: "correct horse battery staple",
    }),
  });
  assert.equal(setupResponse.status, 201);
  const setupPayload = await setupResponse.json();
  assert.equal(setupPayload.created, true);
  assert.equal(setupPayload.user.email, "admin@example.com");
  assert.equal(setupPayload.user.provider, "local");
  assert.equal(setupPayload.user.role, "admin");
  const cookie = setupResponse.headers.get("set-cookie")?.split(";", 1)[0];
  assert.match(cookie ?? "", /^openedl_session=/);

  const completedStatus = await fetch(`${baseUrl}/api/setup`);
  assert.equal(completedStatus.status, 200);
  assert.deepEqual(await completedStatus.json(), { required: false });

  const duplicateSetup = await fetch(`${baseUrl}/api/setup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Second administrator",
      email: "second@example.com",
      password: "another secure administrator password",
    }),
  });
  assert.equal(duplicateSetup.status, 409);
  assert.match((await duplicateSetup.json()).error, /already complete/i);

  const sessionResponse = await fetch(`${baseUrl}/api/auth/session`, {
    headers: { cookie },
  });
  assert.equal(sessionResponse.status, 200);
  const session = await sessionResponse.json();
  assert.equal(session.authenticated, true);
  assert.equal(session.user.email, "admin@example.com");
  assert.equal(session.user.role, "admin");

  const defaultAppearanceResponse = await fetch(
    `${baseUrl}/api/settings/appearance`,
  );
  assert.equal(defaultAppearanceResponse.status, 200);
  const defaultAppearance = await defaultAppearanceResponse.json();
  assert.equal(defaultAppearance.theme, "signal");
  assert.match(defaultAppearance.customTheme.navigation, /^#[0-9a-f]{6}$/);

  const unauthorizedAppearanceUpdate = await fetch(
    `${baseUrl}/api/settings/appearance`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ theme: "custom" }),
    },
  );
  assert.equal(unauthorizedAppearanceUpdate.status, 401);

  const customTheme = {
    navigation: "#182848",
    accent: "#ffca3a",
    background: "#f4f7fb",
    surface: "#ffffff",
    text: "#162033",
    muted: "#68748a",
  };
  const appearanceUpdate = await fetch(`${baseUrl}/api/settings/appearance`, {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ theme: "custom", customTheme }),
  });
  assert.equal(appearanceUpdate.status, 200);
  assert.deepEqual(await appearanceUpdate.json(), {
    theme: "custom",
    customTheme,
  });

  const savedAppearanceResponse = await fetch(
    `${baseUrl}/api/settings/appearance`,
  );
  assert.deepEqual(await savedAppearanceResponse.json(), {
    theme: "custom",
    customTheme,
  });

  const invalidAppearanceUpdate = await fetch(
    `${baseUrl}/api/settings/appearance`,
    {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        customTheme: { ...customTheme, accent: "not-a-colour" },
      }),
    },
  );
  assert.equal(invalidAppearanceUpdate.status, 400);

  const authenticatedDashboard = await fetch(`${baseUrl}/api/dashboard`, {
    headers: { cookie },
  });
  assert.equal(authenticatedDashboard.status, 200);
  const initialDashboard = await authenticatedDashboard.json();
  const source = initialDashboard.lists[0].sources.find(
    (candidate) => candidate.kind === "remote",
  );
  assert.ok(source?.id);

  const auditResponse = await fetch(`${baseUrl}/api/audit/blocks`, {
    headers: { cookie },
  });
  assert.equal(auditResponse.status, 200);
  const initialAudit = await auditResponse.json();
  assert.ok(initialAudit.activeCount > 0);
  assert.ok(initialAudit.active.length > 0);
  assert.ok(initialAudit.allTimeBlockedCount >= initialAudit.activeCount);
  assert.match(initialAudit.note, /per-connection enforcement events/);
  const entryToUnblock = initialAudit.active[0];

  const unblockResponse = await fetch(`${baseUrl}/api/audit/blocks`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      action: "unblock",
      listId: entryToUnblock.listId,
      entry: entryToUnblock.entry,
    }),
  });
  assert.equal(unblockResponse.status, 200);

  const searchedAuditResponse = await fetch(
    `${baseUrl}/api/audit/blocks?q=${encodeURIComponent(entryToUnblock.entry)}`,
    { headers: { cookie } },
  );
  assert.equal(searchedAuditResponse.status, 200);
  const searchedAudit = await searchedAuditResponse.json();
  assert.equal(searchedAudit.active.length, 0);
  assert.equal(searchedAudit.events[0].entry, entryToUnblock.entry);
  assert.equal(searchedAudit.events[0].action, "unblocked");
  assert.equal(searchedAudit.events[0].reason, "manual_unblock");
  assert.equal(
    searchedAudit.allTimeBlockedCount,
    initialAudit.allTimeBlockedCount,
  );

  const updateSourceResponse = await fetch(
    `${baseUrl}/api/sources/${source.id}`,
    {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Edited authenticated API source",
        url: "https://example.com/feed.json",
        format: "json",
        role: "exclude",
        apiProvider: "generic",
        apiAuthType: "header",
        apiAuthHeader: "X-Vendor-Key",
        apiSecret: "replacement test credential",
        jsonPath: "data.results[].indicator",
        refreshIntervalMinutes: 15,
      }),
    },
  );
  const updateSourcePayload = await updateSourceResponse.json();
  assert.equal(
    updateSourceResponse.status,
    200,
    JSON.stringify(updateSourcePayload),
  );
  assert.deepEqual(updateSourcePayload, {
    ok: true,
    refreshDue: true,
  });

  const preserveCredentialResponse = await fetch(
    `${baseUrl}/api/sources/${source.id}`,
    {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Edited API source without secret replacement",
        url: "https://example.com/feed-v2.json",
        format: "json",
        role: "exclude",
        apiProvider: "generic",
        apiAuthType: "header",
        apiAuthHeader: "X-Revised-Key",
        jsonPath: "results[].value",
        refreshIntervalMinutes: 30,
      }),
    },
  );
  assert.equal(preserveCredentialResponse.status, 200);

  const editedDashboardResponse = await fetch(`${baseUrl}/api/dashboard`, {
    headers: { cookie },
  });
  assert.equal(editedDashboardResponse.status, 200);
  const editedDashboard = await editedDashboardResponse.json();
  const editedSource = editedDashboard.lists[0].sources.find(
    (candidate) => candidate.id === source.id,
  );
  assert.equal(editedSource.name, "Edited API source without secret replacement");
  assert.equal(editedSource.url, "https://example.com/feed-v2.json");
  assert.equal(editedSource.format, "json");
  assert.equal(editedSource.role, "exclude");
  assert.equal(editedSource.api_provider, "generic");
  assert.equal(editedSource.api_auth_type, "header");
  assert.equal(editedSource.api_auth_header, "X-Revised-Key");
  assert.equal(editedSource.has_api_secret, true);
  assert.equal(editedSource.json_path, "results[].value");
  assert.equal(editedSource.refresh_interval_minutes, 30);
  assert.equal(editedSource.status, "pending");

  const maintenanceResponse = await fetch(
    `${baseUrl}/api/settings/maintenance`,
    { headers: { cookie } },
  );
  assert.equal(maintenanceResponse.status, 200);
  const maintenance = await maintenanceResponse.json();
  assert.deepEqual(maintenance.limits, {
    remoteSourceMaxMb: 2,
    apiSourceMaxMb: 20,
  });
  assert.equal(maintenance.database.available, true);
  assert.ok(maintenance.database.sizeBytes > 0);
  assert.ok(maintenance.database.pageCount > 0);
  assert.deepEqual(maintenance.vacuumSchedule, {
    schedule: "disabled",
    nextRunAt: null,
    lastRunAt: null,
    lastStatus: "never",
    lastError: null,
  });

  const scheduleVacuumResponse = await fetch(
    `${baseUrl}/api/settings/maintenance`,
    {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ vacuumSchedule: "weekly" }),
    },
  );
  assert.equal(scheduleVacuumResponse.status, 200);
  const scheduledVacuum = await scheduleVacuumResponse.json();
  assert.equal(scheduledVacuum.vacuumSchedule.schedule, "weekly");
  assert.ok(Date.parse(scheduledVacuum.vacuumSchedule.nextRunAt) > Date.now());

  const updateLimitsResponse = await fetch(
    `${baseUrl}/api/settings/maintenance`,
    {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        remoteSourceMaxMb: 8,
        apiSourceMaxMb: 250,
      }),
    },
  );
  assert.equal(updateLimitsResponse.status, 200);
  assert.deepEqual((await updateLimitsResponse.json()).limits, {
    remoteSourceMaxMb: 8,
    apiSourceMaxMb: 250,
  });

  const invalidLimitsResponse = await fetch(
    `${baseUrl}/api/settings/maintenance`,
    {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        remoteSourceMaxMb: 8,
        apiSourceMaxMb: 501,
      }),
    },
  );
  assert.equal(invalidLimitsResponse.status, 400);

  const vacuumResponse = await fetch(`${baseUrl}/api/settings/maintenance`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ action: "vacuum" }),
  });
  assert.equal(vacuumResponse.status, 200);
  const vacuum = await vacuumResponse.json();
  assert.ok(vacuum.before.sizeBytes > 0);
  assert.ok(vacuum.after.sizeBytes > 0);
  assert.ok(vacuum.reclaimedBytes >= 0);

  const auditAfterVacuumResponse = await fetch(`${baseUrl}/api/audit/blocks`, {
    headers: { cookie },
  });
  assert.equal(auditAfterVacuumResponse.status, 200);
  const auditAfterVacuum = await auditAfterVacuumResponse.json();
  assert.equal(
    auditAfterVacuum.allTimeBlockedCount,
    initialAudit.allTimeBlockedCount,
  );
});
