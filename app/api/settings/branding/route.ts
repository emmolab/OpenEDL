import {
  clearBrandingImage,
  updateBrandingImage,
} from "../../../../db/core";
import { requireAdministrator } from "../../../../lib/auth";

export async function PATCH(request: Request) {
  const authorizationError = await requireAdministrator(request);
  if (authorizationError) return authorizationError;
  try {
    const payload = (await request.json()) as { imageDataUrl?: unknown };
    const brandingImage = await updateBrandingImage(payload.imageDataUrl);
    return Response.json({ brandingImage });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to update application branding.",
      },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  const authorizationError = await requireAdministrator(request);
  if (authorizationError) return authorizationError;
  await clearBrandingImage();
  return new Response(null, { status: 204 });
}
