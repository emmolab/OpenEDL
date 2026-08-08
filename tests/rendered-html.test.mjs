import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("ships the OpenEDL dashboard instead of starter content", async () => {
  const [
    page,
    dashboard,
    setup,
    setupRoute,
    layout,
    packageJson,
    auth,
    worker,
    maintenance,
    maintenanceRoute,
    ssoSettings,
    sourceRoute,
    nextConfig,
    proxy,
    securityHeaders,
    blockAudit,
    appearance,
    styles,
  ] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/initial-setup.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/setup/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../lib/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/maintenance-settings.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../app/api/settings/maintenance/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/sso-settings.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../app/api/sources/[id]/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../next.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../proxy.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/security-headers.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/block-audit.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/appearance-settings.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<Dashboard \/>/);
  assert.match(dashboard, /Threat feed,/);
  assert.match(dashboard, /Published endpoint/);
  assert.match(dashboard, /Published list type/);
  assert.match(dashboard, /local_recovery/);
  assert.match(dashboard, /Add & validate/);
  assert.match(dashboard, /Continue with \{provider\.name\}/);
  assert.match(dashboard, /<InitialSetup/);
  assert.match(dashboard, /brandingImageVersion/);
  assert.match(setup, /Create your administrator/);
  assert.match(setup, /This screen closes permanently/);
  assert.match(setupRoute, /createInitialAdministrator/);
  assert.match(dashboard, /Refresh schedule/);
  assert.match(dashboard, /CSV \/ manual/);
  assert.match(dashboard, /malware\.example/);
  assert.match(dashboard, /Malicious URL feed/);
  assert.match(dashboard, /BUILT_IN_PREVIEW_PALETTES\[appTheme\]/);
  assert.match(dashboard, /--preview-background/);
  assert.match(dashboard, /--preview-accent/);
  assert.match(dashboard, /Recorded Future/);
  assert.match(dashboard, /X-RFToken/);
  assert.match(dashboard, /Edit remote or API source/);
  assert.match(
    dashboard,
    /Leave blank to keep the existing encrypted credential/,
  );
  assert.match(sourceRoute, /updateRemoteSource/);
  assert.match(sourceRoute, /requireAdministrator/);
  assert.match(dashboard, /canManage && showAddSource/);
  assert.match(nextConfig, /SECURITY_HEADERS/);
  assert.match(proxy, /NextResponse\.next/);
  assert.match(proxy, /SECURITY_HEADERS/);
  assert.match(securityHeaders, /Content-Security-Policy/);
  assert.match(securityHeaders, /Strict-Transport-Security/);
  assert.match(securityHeaders, /X-Content-Type-Options/);
  assert.match(securityHeaders, /script-src-attr 'none'/);
  assert.match(ssoSettings, /Directory \(tenant\) ID/);
  assert.match(ssoSettings, /Enforce SSO/);
  assert.match(ssoSettings, /emergency local sign-in URL/);
  assert.match(ssoSettings, /EMERGENCY_LOCAL_AUTH_ENABLED=true/);
  assert.match(
    ssoSettings,
    /login\.microsoftonline\.com\/\$\{form\.tenantId\}/,
  );
  assert.match(dashboard, /Maintenance/);
  assert.match(maintenance, /Run database VACUUM/);
  assert.match(maintenance, /Run VACUUM now\?/);
  assert.match(maintenance, /className="confirm-dialog"/);
  assert.doesNotMatch(maintenance, /window\.confirm/);
  assert.match(maintenance, /Authenticated API feed limit/);
  assert.match(maintenance, /Audit retention/);
  assert.match(maintenance, /Disabled by default/);
  assert.match(maintenanceRoute, /Administrator access is required/);
  assert.match(maintenanceRoute, /vacuumDatabase/);
  assert.match(maintenanceRoute, /updateAuditRetention/);
  assert.match(blockAudit, /All lists/);
  assert.match(blockAudit, /Upstream:/);
  assert.doesNotMatch(blockAudit, /All IP lists/);
  assert.match(appearance, /draft\.navigation/);
  assert.match(appearance, /draft\.accent/);
  assert.match(appearance, /draft\.background/);
  assert.match(
    styles,
    /\.code-preview[\s\S]*background: var\(--preview-background, var\(--forest\)\)/,
  );
  assert.doesNotMatch(styles, /background: #11271d/);
  assert.match(layout, /const title = "OpenEDL"/);
  assert.match(layout, /\/api\/branding\/image\?v=/);
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
