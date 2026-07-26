import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  const runtimeEnv = env as unknown as { DB?: D1Database };
  if (!runtimeEnv.DB) {
    throw new Error(
      "Database binding `DB` is unavailable. Docker uses the built-in SQLite adapter; Cloudflare deployments must configure the D1 binding in config/cloudflare-bindings.json."
    );
  }

  return drizzle(runtimeEnv.DB, { schema });
}
