import {
  getAppTheme,
  getEndpointBaseUrl,
  updateAppTheme,
  updateEndpointBaseUrl,
} from "../../../../db/core";
import { getManagementIdentity } from "../../../../lib/auth";

export async function GET() {
  return Response.json({
    theme: await getAppTheme(),
    endpointBaseUrl: await getEndpointBaseUrl(),
  });
}

export async function PATCH(request: Request) {
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
    const payload = (await request.json()) as {
      theme?: string;
      endpointBaseUrl?: string;
    };
    if (payload.theme === undefined && payload.endpointBaseUrl === undefined) {
      throw new Error("No appearance changes were supplied.");
    }
    if (payload.theme !== undefined) await updateAppTheme(payload.theme);
    if (payload.endpointBaseUrl !== undefined) {
      await updateEndpointBaseUrl(payload.endpointBaseUrl);
    }
    return Response.json({
      theme: await getAppTheme(),
      endpointBaseUrl: await getEndpointBaseUrl(),
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to update theme.",
      },
      { status: 400 },
    );
  }
}
