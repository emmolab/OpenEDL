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
  timeout: 45_000,
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
      EMERGENCY_LOCAL_AUTH_ENABLED: "true",
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

  const pageResponse = await fetch(baseUrl);
  assert.equal(pageResponse.status, 200);
  assert.match(
    pageResponse.headers.get("content-security-policy") ?? "",
    /frame-ancestors 'none'/,
  );
  assert.match(
    pageResponse.headers.get("content-security-policy") ?? "",
    /default-src 'none'/,
  );
  assert.match(
    pageResponse.headers.get("content-security-policy") ?? "",
    /script-src-attr 'none'/,
  );
  assert.match(
    pageResponse.headers.get("content-security-policy") ?? "",
    /upgrade-insecure-requests/,
  );
  assert.equal(
    pageResponse.headers.get("strict-transport-security"),
    "max-age=31536000; includeSubDomains",
  );
  assert.equal(pageResponse.headers.get("x-content-type-options"), "nosniff");
  assert.equal(pageResponse.headers.get("x-frame-options"), "DENY");
  assert.equal(pageResponse.headers.get("referrer-policy"), "no-referrer");
  assert.equal(
    pageResponse.headers.get("permissions-policy"),
    "camera=(), display-capture=(), geolocation=(), microphone=(), payment=(), usb=()",
  );

  const unauthorizedDashboard = await fetch(`${baseUrl}/api/dashboard`);
  assert.equal(unauthorizedDashboard.status, 401);
  const unauthorizedMaintenance = await fetch(
    `${baseUrl}/api/settings/maintenance`,
  );
  assert.equal(unauthorizedMaintenance.status, 401);
  const unauthorizedAudit = await fetch(`${baseUrl}/api/audit/blocks`);
  assert.equal(unauthorizedAudit.status, 401);
  const unauthorizedSourceMutation = await fetch(`${baseUrl}/api/sources`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(unauthorizedSourceMutation.status, 401);

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
  assert.equal(defaultAppearance.brandingImage, null);

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
    brandingImage: null,
  });

  const savedAppearanceResponse = await fetch(
    `${baseUrl}/api/settings/appearance`,
  );
  assert.deepEqual(await savedAppearanceResponse.json(), {
    theme: "custom",
    customTheme,
    brandingImage: null,
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

  const brandingImageDataUrl =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const unauthorizedBrandingUpdate = await fetch(
    `${baseUrl}/api/settings/branding`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imageDataUrl: brandingImageDataUrl }),
    },
  );
  assert.equal(unauthorizedBrandingUpdate.status, 401);

  const invalidBrandingUpdate = await fetch(
    `${baseUrl}/api/settings/branding`,
    {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        imageDataUrl: "data:image/png;base64,dGhpcyBpcyBub3QgYSBwbmc=",
      }),
    },
  );
  assert.equal(invalidBrandingUpdate.status, 400);

  const brandingUpdate = await fetch(`${baseUrl}/api/settings/branding`, {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ imageDataUrl: brandingImageDataUrl }),
  });
  assert.equal(brandingUpdate.status, 200);
  const brandingUpdatePayload = await brandingUpdate.json();
  assert.match(
    brandingUpdatePayload.brandingImage.version,
    /^[0-9a-f-]{36}$/,
  );

  const brandingImageResponse = await fetch(
    `${baseUrl}/api/branding/image?v=${brandingUpdatePayload.brandingImage.version}`,
  );
  assert.equal(brandingImageResponse.status, 200);
  assert.equal(brandingImageResponse.headers.get("content-type"), "image/png");
  assert.ok((await brandingImageResponse.arrayBuffer()).byteLength > 8);

  const brandedPageResponse = await fetch(baseUrl);
  assert.match(
    await brandedPageResponse.text(),
    /\/api\/branding\/image\?v=/,
  );
  const brandedAppearance = await fetch(
    `${baseUrl}/api/settings/appearance`,
  );
  assert.equal(
    (await brandedAppearance.json()).brandingImage.version,
    brandingUpdatePayload.brandingImage.version,
  );

  const resetBrandingResponse = await fetch(
    `${baseUrl}/api/settings/branding`,
    { method: "DELETE", headers: { cookie } },
  );
  assert.equal(resetBrandingResponse.status, 204);
  const removedBrandingImage = await fetch(`${baseUrl}/api/branding/image`);
  assert.equal(removedBrandingImage.status, 404);

  const authenticatedDashboard = await fetch(`${baseUrl}/api/dashboard`, {
    headers: { cookie },
  });
  assert.equal(authenticatedDashboard.status, 200);
  const initialDashboard = await authenticatedDashboard.json();
  assert.deepEqual(
    initialDashboard.lists.map((candidate) => ({
      type: candidate.type,
      slug: candidate.slug,
    })),
    [
      { type: "ip", slug: "perimeter-blocklist" },
      { type: "domain", slug: "domain-blocklist" },
      { type: "url", slug: "url-blocklist" },
    ],
  );
  assert.equal(
    initialDashboard.lists.some((candidate) =>
      candidate.sources.some(
        (sourceCandidate) =>
          sourceCandidate.name === "Team Cymru Bogons" ||
          sourceCandidate.url ===
            "https://www.team-cymru.org/Services/Bogons/fullbogons-ipv4.txt",
      ),
    ),
    false,
  );
  for (const type of ["domain", "url"]) {
    const typedList = initialDashboard.lists.find(
      (candidate) => candidate.type === type,
    );
    assert.ok(typedList);
    assert.equal(typedList.sources.length, 0);
    assert.equal(typedList.entryCount, 0);
    const typedEndpoint = await fetch(`${baseUrl}/edl/${typedList.slug}`);
    assert.equal(typedEndpoint.status, 200);
    assert.equal(await typedEndpoint.text(), "");
  }
  for (const configuration of [
    {
      type: "domain",
      name: "Local domain intelligence",
      input: "bad.example\nmalware.example",
      output: "bad.example\nmalware.example\n",
    },
    {
      type: "url",
      name: "Local URL intelligence",
      input: "https://evil.example/path",
      output: "evil.example/path\n",
    },
  ]) {
    const typedList = initialDashboard.lists.find(
      (candidate) => candidate.type === configuration.type,
    );
    assert.ok(typedList);
    const createTypedSourceResponse = await fetch(`${baseUrl}/api/sources`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        listId: typedList.id,
        name: configuration.name,
        type: configuration.type,
        format: "text",
        role: "include",
        kind: "manual",
        manualEntries: configuration.input,
        refreshIntervalMinutes: 60,
      }),
    });
    assert.equal(createTypedSourceResponse.status, 201);
    const configuredEndpoint = await fetch(
      `${baseUrl}/edl/${typedList.slug}`,
    );
    assert.equal(configuredEndpoint.status, 200);
    assert.equal(await configuredEndpoint.text(), configuration.output);
  }
  const source = initialDashboard.lists[0].sources.find(
    (candidate) => candidate.kind === "remote",
  );
  assert.ok(source?.id);
  const listId = initialDashboard.lists[0].id;
  const listSlug = initialDashboard.lists[0].slug;

  const publishedListResponse = await fetch(`${baseUrl}/edl/${listSlug}`);
  assert.equal(publishedListResponse.status, 200);
  assert.match(
    publishedListResponse.headers.get("content-type") ?? "",
    /^text\/plain/,
  );
  assert.match(
    publishedListResponse.headers.get("content-security-policy") ?? "",
    /frame-ancestors 'none'/,
  );
  assert.equal(
    publishedListResponse.headers.get("strict-transport-security"),
    "max-age=31536000; includeSubDomains",
  );
  assert.equal(
    publishedListResponse.headers.get("x-content-type-options"),
    "nosniff",
  );
  const publishedListBody = await publishedListResponse.text();
  assert.ok(publishedListBody.trim().split("\n").length > 0);

  const publishedListHeadResponse = await fetch(
    `${baseUrl}/edl/${listSlug}`,
    { method: "HEAD" },
  );
  assert.equal(publishedListHeadResponse.status, 200);
  assert.match(
    publishedListHeadResponse.headers.get("content-security-policy") ?? "",
    /default-src 'none'/,
  );
  assert.equal(await publishedListHeadResponse.text(), "");

  const unsupportedListPost = await fetch(`${baseUrl}/api/lists/999999`, {
    method: "POST",
  });
  assert.equal(unsupportedListPost.status, 405);

  const createMemberResponse = await fetch(`${baseUrl}/api/users`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      name: "Read only member",
      email: "member@example.com",
      password: "member password is secure",
      role: "member",
    }),
  });
  assert.equal(createMemberResponse.status, 201);

  const memberLoginResponse = await fetch(`${baseUrl}/api/auth/local`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "member@example.com",
      password: "member password is secure",
    }),
  });
  assert.equal(memberLoginResponse.status, 200);
  const memberCookie = memberLoginResponse.headers
    .get("set-cookie")
    ?.split(";", 1)[0];
  assert.match(memberCookie ?? "", /^openedl_session=/);

  const memberDashboardResponse = await fetch(`${baseUrl}/api/dashboard`, {
    headers: { cookie: memberCookie },
  });
  assert.equal(memberDashboardResponse.status, 200);
  const memberAuditResponse = await fetch(`${baseUrl}/api/audit/blocks`, {
    headers: { cookie: memberCookie },
  });
  assert.equal(memberAuditResponse.status, 200);

  const memberProfileResponse = await fetch(`${baseUrl}/api/profile`, {
    method: "PATCH",
    headers: {
      cookie: memberCookie,
      "content-type": "application/json",
    },
    body: JSON.stringify({ name: "Updated member profile" }),
  });
  assert.equal(memberProfileResponse.status, 200);
  assert.equal((await memberProfileResponse.json()).user.name, "Updated member profile");

  const forbiddenMemberRequests = [
    fetch(`${baseUrl}/api/users`, {
      headers: { cookie: memberCookie },
    }),
    fetch(`${baseUrl}/api/settings/sso`, {
      headers: { cookie: memberCookie },
    }),
    fetch(`${baseUrl}/api/settings/maintenance`, {
      headers: { cookie: memberCookie },
    }),
    fetch(`${baseUrl}/api/sources`, {
      method: "POST",
      headers: {
        cookie: memberCookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    }),
    fetch(`${baseUrl}/api/sources/999999`, {
      method: "PATCH",
      headers: {
        cookie: memberCookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    }),
    fetch(`${baseUrl}/api/sources/999999`, {
      method: "DELETE",
      headers: { cookie: memberCookie },
    }),
    fetch(`${baseUrl}/api/sources/999999/refresh`, {
      method: "POST",
      headers: { cookie: memberCookie },
    }),
    fetch(`${baseUrl}/api/lists/${listId}`, {
      method: "PATCH",
      headers: {
        cookie: memberCookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    }),
    fetch(`${baseUrl}/api/lists/${listId}/refresh`, {
      method: "POST",
      headers: { cookie: memberCookie },
    }),
    fetch(`${baseUrl}/api/audit/blocks`, {
      method: "POST",
      headers: {
        cookie: memberCookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    }),
    fetch(`${baseUrl}/api/settings/appearance`, {
      method: "PATCH",
      headers: {
        cookie: memberCookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    }),
    fetch(`${baseUrl}/api/settings/branding`, {
      method: "PATCH",
      headers: {
        cookie: memberCookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({ imageDataUrl: brandingImageDataUrl }),
    }),
    fetch(`${baseUrl}/api/settings/maintenance`, {
      method: "PATCH",
      headers: {
        cookie: memberCookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    }),
    fetch(`${baseUrl}/api/settings/sso`, {
      method: "POST",
      headers: {
        cookie: memberCookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    }),
    fetch(`${baseUrl}/api/users`, {
      method: "POST",
      headers: {
        cookie: memberCookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    }),
    fetch(`${baseUrl}/api/users/999999`, {
      method: "PATCH",
      headers: {
        cookie: memberCookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    }),
    fetch(`${baseUrl}/api/users/999999`, {
      method: "DELETE",
      headers: { cookie: memberCookie },
    }),
  ];
  for (const pendingResponse of forbiddenMemberRequests) {
    const response = await pendingResponse;
    assert.equal(response.status, 403);
    assert.match(
      (await response.json()).error,
      /Administrator access is required/,
    );
  }

  const auditResponse = await fetch(`${baseUrl}/api/audit/blocks`, {
    headers: { cookie },
  });
  assert.equal(auditResponse.status, 200);
  const initialAudit = await auditResponse.json();
  assert.ok(initialAudit.activeCount > 0);
  assert.ok(initialAudit.active.length > 0);
  assert.deepEqual(
    [...new Set(initialAudit.lists.map((candidate) => candidate.type))].sort(),
    ["domain", "ip", "url"],
  );
  const attributedDomain = initialAudit.active.find(
    (candidate) => candidate.listType === "domain",
  );
  assert.ok(attributedDomain);
  assert.deepEqual(attributedDomain.sourceNames, ["Local domain intelligence"]);
  const attributedDomainEvent = initialAudit.events.find(
    (event) => event.entry === attributedDomain.entry,
  );
  assert.ok(attributedDomainEvent);
  assert.deepEqual(attributedDomainEvent.sourceNames, [
    "Local domain intelligence",
  ]);
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
  assert.deepEqual(searchedAudit.events[0].sourceNames, entryToUnblock.sourceNames);
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
  assert.deepEqual(maintenance.auditRetention, {
    days: 0,
    enabled: false,
    nextRunAt: null,
    lastRunAt: null,
    lastDeleted: 0,
  });

  const auditRetentionResponse = await fetch(
    `${baseUrl}/api/settings/maintenance`,
    {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ auditRetentionDays: 30 }),
    },
  );
  assert.equal(auditRetentionResponse.status, 200);
  const auditRetention = (await auditRetentionResponse.json()).auditRetention;
  assert.equal(auditRetention.enabled, true);
  assert.equal(auditRetention.days, 30);
  assert.ok(Date.parse(auditRetention.nextRunAt) <= Date.now());

  const runAuditRetentionResponse = await fetch(
    `${baseUrl}/api/settings/maintenance`,
    {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ action: "audit_retention" }),
    },
  );
  assert.equal(runAuditRetentionResponse.status, 200);
  const auditRetentionRun = await runAuditRetentionResponse.json();
  assert.equal(auditRetentionRun.ran, true);
  assert.equal(auditRetentionRun.deleted, 0);
  assert.ok(auditRetentionRun.settings.lastRunAt);

  const disableAuditRetentionResponse = await fetch(
    `${baseUrl}/api/settings/maintenance`,
    {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ auditRetentionDays: 0 }),
    },
  );
  assert.equal(disableAuditRetentionResponse.status, 200);
  assert.equal(
    (await disableAuditRetentionResponse.json()).auditRetention.enabled,
    false,
  );

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

  const initialSsoSettingsResponse = await fetch(
    `${baseUrl}/api/settings/sso`,
    { headers: { cookie } },
  );
  assert.equal(initialSsoSettingsResponse.status, 200);
  assert.equal((await initialSsoSettingsResponse.json()).ssoEnforced, false);

  const createSsoProviderResponse = await fetch(
    `${baseUrl}/api/settings/sso`,
    {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        id: "test-sso",
        name: "Test SSO",
        issuer: "https://identity.example.com",
        discoveryUrl:
          "https://identity.example.com/.well-known/openid-configuration",
        clientId: "openedl-test-client",
        clientSecret: "test client secret",
        scopes: "openid profile email",
        enabled: true,
      }),
    },
  );
  assert.equal(createSsoProviderResponse.status, 201);

  const enforceSsoResponse = await fetch(`${baseUrl}/api/settings/sso`, {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ enforceSso: true }),
  });
  assert.equal(enforceSsoResponse.status, 200);
  assert.equal((await enforceSsoResponse.json()).ssoEnforced, true);

  const enforcedProvidersResponse = await fetch(
    `${baseUrl}/api/auth/providers`,
  );
  const enforcedProviders = await enforcedProvidersResponse.json();
  assert.equal(enforcedProviders.ssoEnforced, true);
  assert.equal(enforcedProviders.emergencyLocalAuthEnabled, true);
  assert.equal(enforcedProviders.localAuthEnabled, false);

  const revokedLocalSessionResponse = await fetch(
    `${baseUrl}/api/auth/session`,
    { headers: { cookie } },
  );
  assert.equal((await revokedLocalSessionResponse.json()).authenticated, false);

  const disabledLocalLoginResponse = await fetch(
    `${baseUrl}/api/auth/local`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "admin@example.com",
        password: "correct horse battery staple",
      }),
    },
  );
  assert.equal(disabledLocalLoginResponse.status, 403);
  assert.match(
    (await disabledLocalLoginResponse.json()).error,
    /SSO is enforced/,
  );

  const emergencyLoginResponse = await fetch(
    `${baseUrl}/api/auth/local/recovery`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "admin@example.com",
        password: "correct horse battery staple",
      }),
    },
  );
  assert.equal(emergencyLoginResponse.status, 200);
  const emergencyCookie = emergencyLoginResponse.headers
    .get("set-cookie")
    ?.split(";", 1)[0];
  assert.match(emergencyCookie ?? "", /^openedl_session=/);
  const emergencyDashboardResponse = await fetch(`${baseUrl}/api/dashboard`, {
    headers: { cookie: emergencyCookie },
  });
  assert.equal(emergencyDashboardResponse.status, 200);

  const disableLastProviderResponse = await fetch(
    `${baseUrl}/api/settings/sso/test-sso`,
    {
      method: "PATCH",
      headers: {
        cookie: emergencyCookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({ enabled: false }),
    },
  );
  assert.equal(disableLastProviderResponse.status, 400);
  assert.match(
    (await disableLastProviderResponse.json()).error,
    /last enabled provider/,
  );

  const disableSsoResponse = await fetch(`${baseUrl}/api/settings/sso`, {
    method: "PATCH",
    headers: {
      cookie: emergencyCookie,
      "content-type": "application/json",
    },
    body: JSON.stringify({ enforceSso: false }),
  });
  assert.equal(disableSsoResponse.status, 200);
  assert.equal((await disableSsoResponse.json()).ssoEnforced, false);
});

test("emergency local authentication is disabled unless explicitly enabled", {
  timeout: 45_000,
}, async (context) => {
  const workingDirectory = await mkdtemp(join(tmpdir(), "openedl-recovery-off-"));
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let logs = "";
  const child = spawn(process.execPath, ["dist/standalone/server.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ADMIN_TOKEN: "",
      AUTH_BASE_URL: baseUrl,
      CONFIG_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      DATABASE_PATH: join(workingDirectory, "openedl.sqlite"),
      EMERGENCY_LOCAL_AUTH_ENABLED: "",
      HOST: "127.0.0.1",
      HOSTNAME: "127.0.0.1",
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

  const providersResponse = await fetch(`${baseUrl}/api/auth/providers`);
  assert.equal(providersResponse.status, 200);
  assert.equal(
    (await providersResponse.json()).emergencyLocalAuthEnabled,
    false,
  );

  const setupResponse = await fetch(`${baseUrl}/api/setup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Recovery test administrator",
      email: "recovery@example.com",
      password: "correct horse battery staple",
    }),
  });
  assert.equal(setupResponse.status, 201);
  const cookie = setupResponse.headers.get("set-cookie")?.split(";", 1)[0];
  assert.match(cookie ?? "", /^openedl_session=/);

  const createProviderResponse = await fetch(`${baseUrl}/api/settings/sso`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      id: "recovery-test-sso",
      name: "Recovery Test SSO",
      issuer: "https://identity.example.com",
      discoveryUrl:
        "https://identity.example.com/.well-known/openid-configuration",
      clientId: "openedl-recovery-test",
      clientSecret: "test client secret",
      scopes: "openid profile email",
      enabled: true,
    }),
  });
  assert.equal(createProviderResponse.status, 201);

  const enforceResponse = await fetch(`${baseUrl}/api/settings/sso`, {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ enforceSso: true }),
  });
  assert.equal(enforceResponse.status, 200);

  const recoveryResponse = await fetch(`${baseUrl}/api/auth/local/recovery`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "recovery@example.com",
      password: "correct horse battery staple",
    }),
  });
  assert.equal(recoveryResponse.status, 403);
  assert.match((await recoveryResponse.json()).error, /disabled/);
  assert.equal(recoveryResponse.headers.get("set-cookie"), null);
});
