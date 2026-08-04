import {
  refreshList,
} from "../../../../../db/core";
import { requireAdministrator } from "../../../../../lib/auth";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authorizationError = await requireAdministrator(request);
  if (authorizationError) return authorizationError;

  const { id } = await context.params;
  const listId = Number(id);
  if (!Number.isInteger(listId) || listId <= 0) {
    return Response.json({ error: "Invalid list id." }, { status: 400 });
  }

  try {
    const result = await refreshList(listId);
    return Response.json(result, { status: result.ok ? 200 : 207 });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to refresh list.",
      },
      { status: 500 },
    );
  }
}
