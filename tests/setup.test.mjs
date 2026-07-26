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

test("first-run setup creates exactly one administrator and signs them in", {
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
      DATABASE_PATH: join(workingDirectory, "openedl.sqlite"),
      HOST: "127.0.0.1",
      HOSTNAME: "127.0.0.1",
      LOCAL_AUTH_BOOTSTRAP_EMAIL: "",
      LOCAL_AUTH_BOOTSTRAP_NAME: "",
      LOCAL_AUTH_BOOTSTRAP_PASSWORD: "",
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

  const authenticatedDashboard = await fetch(`${baseUrl}/api/dashboard`, {
    headers: { cookie },
  });
  assert.equal(authenticatedDashboard.status, 200);
});
