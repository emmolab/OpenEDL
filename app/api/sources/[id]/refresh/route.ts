import {
  refreshSource,
} from "../../../../../db/core";
import { isManagementAuthorized } from "../../../../../lib/auth";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!(await isManagementAuthorized(request))) {
    return Response.json({ error: "Sign-in required." }, { status: 401 });
  }

  const { id } = await context.params;
  const sourceId = Number(id);
  if (!Number.isInteger(sourceId) || sourceId <= 0) {
    return Response.json({ error: "Invalid source id." }, { status: 400 });
  }

  try {
    const result = await refreshSource(sourceId);
    return Response.json(result, { status: result.ok ? 200 : 502 });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to refresh source.",
      },
      { status: 500 },
    );
  }
}
