import {
  hasAdminToken,
  isSsoEnforced,
  listOidcProviders,
} from "../../../../lib/auth";

export async function GET() {
  try {
    const ssoEnforced = await isSsoEnforced();
    return Response.json({
      providers: await listOidcProviders(),
      adminTokenEnabled: hasAdminToken(),
      localAuthEnabled: !ssoEnforced,
      ssoEnforced,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load identity providers.",
      },
      { status: 500 },
    );
  }
}
