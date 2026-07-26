import {
  deleteManagedUser,
  getManagementIdentity,
  updateManagedUser,
} from "../../../../lib/auth";

async function administrator(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const identity = await getManagementIdentity(request);
  if (!identity) {
    return {
      error: Response.json({ error: "Sign-in required." }, { status: 401 }),
    };
  }
  if (identity.role !== "admin") {
    return {
      error: Response.json(
        { error: "Administrator access is required." },
        { status: 403 },
      ),
    };
  }
  const { id } = await context.params;
  const userId = Number(id);
  if (!Number.isInteger(userId) || userId < 1) {
    return {
      error: Response.json({ error: "Invalid user id." }, { status: 400 }),
    };
  }
  return { identity, userId };
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authorization = await administrator(request, context);
  if ("error" in authorization) return authorization.error;

  try {
    const payload = (await request.json()) as {
      name?: string;
      email?: string;
      password?: string;
      role?: string;
      active?: boolean;
    };
    const user = await updateManagedUser(
      authorization.identity.id,
      authorization.userId,
      payload,
    );
    return Response.json({ user });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to update user.",
      },
      { status: 400 },
    );
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authorization = await administrator(request, context);
  if ("error" in authorization) return authorization.error;

  try {
    await deleteManagedUser(
      authorization.identity.id,
      authorization.userId,
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to delete user.",
      },
      { status: 400 },
    );
  }
}
