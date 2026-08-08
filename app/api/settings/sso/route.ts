import {
  createOidcProviderSetting,
  getManagementIdentity,
  hasConfigEncryptionKey,
  isSsoEnforced,
  listOidcProviderSettings,
  updateSsoEnforcement,
} from "../../../../lib/auth";

async function requireAdministrator(request: Request) {
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
  return null;
}

export async function GET(request: Request) {
  const error = await requireAdministrator(request);
  if (error) return error;
  return Response.json({
    providers: await listOidcProviderSettings(),
    encryptionConfigured: hasConfigEncryptionKey(),
    ssoEnforced: await isSsoEnforced(),
  });
}

export async function PATCH(request: Request) {
  const authorizationError = await requireAdministrator(request);
  if (authorizationError) return authorizationError;
  try {
    const payload = (await request.json()) as { enforceSso?: unknown };
    if (typeof payload.enforceSso !== "boolean") {
      return Response.json(
        { error: "enforceSso must be true or false." },
        { status: 400 },
      );
    }
    await updateSsoEnforcement(payload.enforceSso);
    return Response.json({ ssoEnforced: payload.enforceSso });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to update SSO enforcement.",
      },
      { status: 400 },
    );
  }
}

export async function POST(request: Request) {
  const authorizationError = await requireAdministrator(request);
  if (authorizationError) return authorizationError;
  try {
    const payload = (await request.json()) as {
      id?: string;
      name?: string;
      issuer?: string;
      discoveryUrl?: string;
      clientId?: string;
      clientSecret?: string;
      scopes?: string;
      enabled?: boolean;
    };
    const providerId = await createOidcProviderSetting(payload);
    return Response.json({ providerId }, { status: 201 });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to create provider.",
      },
      { status: 400 },
    );
  }
}
