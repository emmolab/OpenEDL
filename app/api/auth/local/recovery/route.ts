import {
  LocalAuthenticationError,
  loginWithLocalAccount,
} from "../../../../../lib/auth";
import { logError, logWarn } from "../../../../../lib/logging";

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
      { emergencyRecovery: true },
    );
    return Response.json(
      { authenticated: true, emergencyRecovery: true },
      {
        headers: {
          "cache-control": "no-store",
          "set-cookie": cookie,
        },
      },
    );
  } catch (error) {
    if (error instanceof LocalAuthenticationError) {
      logWarn("auth.local.emergency_recovery_rejected", {
        status: error.status,
      });
    } else {
      logError("auth.local.emergency_recovery_failed", error);
    }
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to sign in.",
      },
      {
        status:
          error instanceof LocalAuthenticationError ? error.status : 400,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}
