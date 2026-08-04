import {
  refreshSource,
} from "../../../../../db/core";
import { requireAdministrator } from "../../../../../lib/auth";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authorizationError = await requireAdministrator(request);
  if (authorizationError) return authorizationError;

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
