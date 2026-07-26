import { beginOidcLogin } from "../../../../../lib/auth";

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
    return Response.redirect(authorizationUrl, 302);
  } catch (error) {
    const redirectUrl = new URL("/", request.url);
    redirectUrl.searchParams.set(
      "auth_error",
      error instanceof Error ? error.message : "Unable to start sign-in.",
    );
    return Response.redirect(redirectUrl, 302);
  }
}
