import {
  hasAdminToken,
  listOidcProviders,
} from "../../../../lib/auth";

export async function GET() {
  try {
    return Response.json({
      providers: await listOidcProviders(),
      adminTokenEnabled: hasAdminToken(),
      localAuthEnabled: true,
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
