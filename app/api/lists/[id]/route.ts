import { updateList } from "../../../../db/core";
import { isManagementAuthorized } from "../../../../lib/auth";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!(await isManagementAuthorized(request))) {
    return Response.json({ error: "Sign-in required." }, { status: 401 });
  }
  const { id } = await context.params;
  const listId = Number(id);
  if (!Number.isInteger(listId) || listId < 1) {
    return Response.json({ error: "Invalid list id." }, { status: 400 });
  }
  try {
    const payload = (await request.json()) as {
      name?: string;
      slug?: string;
      description?: string;
    };
    await updateList(listId, {
      name: payload.name ?? "",
      slug: payload.slug ?? "",
      description: payload.description ?? "",
    });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to update list.",
      },
      { status: 400 },
    );
  }
}
