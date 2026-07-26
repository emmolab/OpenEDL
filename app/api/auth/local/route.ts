import {
  LocalAuthenticationError,
  loginWithLocalAccount,
} from "../../../../lib/auth";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      email?: string;
      password?: string;
    };
    const cookie = await loginWithLocalAccount(
      request,
      payload.email ?? "",
      payload.password ?? "",
    );
    return Response.json(
      { authenticated: true },
      { headers: { "set-cookie": cookie } },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to sign in.",
      },
      {
        status:
          error instanceof LocalAuthenticationError ? error.status : 400,
      },
    );
  }
}
