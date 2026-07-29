import {
  LocalAuthenticationError,
  loginWithLocalAccount,
} from "../../../../lib/auth";
import { logError, logWarn } from "../../../../lib/logging";

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
    if (error instanceof LocalAuthenticationError) {
      logWarn("auth.local.rejected", { status: error.status });
    } else {
      logError("auth.local.failed", error);
    }
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
