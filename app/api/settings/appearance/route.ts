import {
  getAppTheme,
  updateAppTheme,
} from "../../../../db/core";
import { getManagementIdentity } from "../../../../lib/auth";

export async function GET() {
  return Response.json({
    theme: await getAppTheme(),
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
    };
    if (payload.theme === undefined) {
      throw new Error("No appearance changes were supplied.");
    }
    await updateAppTheme(payload.theme);
    return Response.json({
      theme: await getAppTheme(),
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
