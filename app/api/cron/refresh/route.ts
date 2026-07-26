import { env } from "cloudflare:workers";
import { refreshDueSources } from "../../../../db/core";

type CronEnv = {
  CRON_SECRET?: string;
};

export async function POST(request: Request) {
  const cronEnv = env as unknown as CronEnv;
  const secret = cronEnv.CRON_SECRET?.trim();
  if (!secret) {
    return Response.json(
      { error: "CRON_SECRET is not configured." },
      { status: 503 },
    );
  }

  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Invalid cron token." }, { status: 401 });
  }

  return Response.json(await refreshDueSources());
}
