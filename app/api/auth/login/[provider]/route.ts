import { beginOidcLogin } from "../../../../../lib/auth";
import { logError, logInfo } from "../../../../../lib/logging";

export async function GET(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider } = await context.params;
  const requestUrl = new URL(request.url);

  try {
    const authorizationUrl = await beginOidcLogin(
      request,
      provider,
      requestUrl.searchParams.get("return_to"),
    );
    logInfo("auth.sso.started", { providerId: provider });
    return Response.redirect(authorizationUrl, 302);
  } catch (error) {
    logError("auth.sso.start_failed", error, { providerId: provider });
    const redirectUrl = new URL("/", request.url);
    redirectUrl.searchParams.set(
      "auth_error",
      error instanceof Error ? error.message : "Unable to start sign-in.",
    );
    return Response.redirect(redirectUrl, 302);
  }
}
