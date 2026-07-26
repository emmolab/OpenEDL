import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("ships the OpenEDL dashboard instead of starter content", async () => {
  const [page, dashboard, setup, setupRoute, layout, packageJson, auth, worker] =
    await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/initial-setup.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/setup/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../lib/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    ]);

  assert.match(page, /<Dashboard \/>/);
  assert.match(dashboard, /Threat feed,/);
  assert.match(dashboard, /Published endpoint/);
  assert.match(dashboard, /Add & validate/);
  assert.match(dashboard, /Continue with \{provider\.name\}/);
  assert.match(dashboard, /<InitialSetup onComplete=/);
  assert.match(setup, /Create your administrator/);
  assert.match(setup, /This screen closes permanently/);
  assert.match(setupRoute, /createInitialAdministrator/);
  assert.match(dashboard, /Refresh schedule/);
  assert.match(layout, /OpenEDL — Unified External Dynamic Lists/);
  assert.match(layout, /openGraph/);
  assert.match(auth, /code_challenge_method", "S256"/);
  assert.match(auth, /payload\.nonce !== challenge\.nonce/);
  assert.match(auth, /jwtVerify/);
  assert.match(auth, /HttpOnly/);
  assert.match(auth, /WHERE NOT EXISTS \(SELECT 1 FROM auth_users\)/);
  assert.match(worker, /scheduled\(/);
  assert.match(worker, /refreshDueSources/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(page, /codex-preview|SkeletonPreview/);

  await assert.rejects(
    access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)),
  );
  await access(new URL("../public/og.png", import.meta.url));
});
