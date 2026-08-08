import {
  getAppTheme,
  getBrandingImageMetadata,
  getCustomTheme,
  updateAppTheme,
  updateCustomTheme,
} from "../../../../db/core";
import { isAppTheme } from "../../../../lib/appearance";
import { getManagementIdentity } from "../../../../lib/auth";

export async function GET() {
  const [theme, customTheme, brandingImage] = await Promise.all([
    getAppTheme(),
    getCustomTheme(),
    getBrandingImageMetadata(),
  ]);
  return Response.json({
    theme,
    customTheme,
    brandingImage,
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
      customTheme?: unknown;
    };
    if (payload.theme === undefined && payload.customTheme === undefined) {
      throw new Error("No appearance changes were supplied.");
    }
    if (payload.theme !== undefined && !isAppTheme(payload.theme)) {
      throw new Error("Invalid application theme.");
    }
    if (payload.customTheme !== undefined) {
      await updateCustomTheme(payload.customTheme);
    }
    if (payload.theme !== undefined) {
      await updateAppTheme(payload.theme);
    }
    const [theme, customTheme, brandingImage] = await Promise.all([
      getAppTheme(),
      getCustomTheme(),
      getBrandingImageMetadata(),
    ]);
    return Response.json({
      theme,
      customTheme,
      brandingImage,
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
