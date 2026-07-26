import { ensureDatabase } from "../../../db/core";

export async function GET() {
  try {
    await ensureDatabase();
    return Response.json({ status: "ok" });
  } catch (error) {
    console.error("Health check failed", error);
    return Response.json({ status: "unhealthy" }, { status: 503 });
  }
}
