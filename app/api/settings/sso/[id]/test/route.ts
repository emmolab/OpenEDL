import {
  getManagementIdentity,
  testOidcProviderSetting,
} from "../../../../../../lib/auth";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const identity = await getManagementIdentity(request);
  if (!identity) {
    return Response.json({ error: "Sign-in required." }, { status: 401 });
  }
  if (identity.role !== "admin") {
    return Response.json(
      { error: "Administrator access is required." },
      { status: 403 },
    );
  }
  try {
    const { id } = await context.params;
    return Response.json(await testOidcProviderSetting(id));
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Provider test failed.",
      },
      { status: 400 },
    );
  }
}
