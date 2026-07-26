import { resolve } from "node:path";
import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./config/cloudflare-bindings.json";

const CLOUDFLARE_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, d1DatabaseName, r2 } = hostingConfig;
const isCloudflarePlatform = process.env.OPENEDL_PLATFORM === "cloudflare";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  triggers: {
    crons: ["*/5 * * * *"],
  },
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: d1DatabaseName,
          database_id: CLOUDFLARE_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "openedl",
        },
      ]
    : [],
};

export default defineConfig(async () => {
  const platformPlugins = [];
  if (isCloudflarePlatform) {
    // Keep Wrangler and Miniflare state project-local. These are non-secret
    // tool settings; application environment belongs in ignored `.env*` files.
    process.env.WRANGLER_WRITE_LOGS ??= "false";
    process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
    process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

    // Wrangler snapshots its log path while the plugin is imported.
    const { cloudflare } = await import("@cloudflare/vite-plugin");
    platformPlugins.push(
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    );
  }

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    resolve: isCloudflarePlatform
      ? undefined
      : {
          alias: {
            "cloudflare:workers": resolve(
              process.cwd(),
              "platform/node-cloudflare-workers.ts",
            ),
          },
        },
    plugins: [vinext(), ...platformPlugins],
  };
});
