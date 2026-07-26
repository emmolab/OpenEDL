import {
  deleteOidcProviderSetting,
  getManagementIdentity,
  updateOidcProviderSetting,
} from "../../../../../lib/auth";

async function authorize(
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
  return { providerId: id };
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authorization = await authorize(request, context);
  if ("error" in authorization) return authorization.error;
  try {
    await updateOidcProviderSetting(
      authorization.providerId,
      await request.json(),
    );
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to update provider.",
      },
      { status: 400 },
    );
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authorization = await authorize(request, context);
  if ("error" in authorization) return authorization.error;
  try {
    await deleteOidcProviderSetting(authorization.providerId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to delete provider.",
      },
      { status: 400 },
    );
  }
}
