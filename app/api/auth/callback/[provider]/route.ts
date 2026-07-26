import { completeOidcLogin } from "../../../../../lib/auth";

export async function GET(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider } = await context.params;
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const providerError = requestUrl.searchParams.get("error_description");

  if (!code || !state || providerError) {
    const redirectUrl = new URL("/", request.url);
    redirectUrl.searchParams.set(
      "auth_error",
      providerError ?? "The identity provider did not return a valid code.",
    );
    return Response.redirect(redirectUrl, 302);
  }

  try {
    const session = await completeOidcLogin(request, provider, code, state);
    return new Response(null, {
      status: 302,
      headers: {
        location: new URL(session.returnTo, request.url).toString(),
        "set-cookie": session.cookie,
      },
    });
  } catch (error) {
    const redirectUrl = new URL("/", request.url);
    redirectUrl.searchParams.set(
      "auth_error",
      error instanceof Error ? error.message : "Sign-in failed.",
    );
    return Response.redirect(redirectUrl, 302);
  }
}
