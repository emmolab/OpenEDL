import { getBrandingImage } from "../../../../db/core";

export async function GET(request: Request) {
  const image = await getBrandingImage();
  if (!image) {
    return new Response("Custom branding image not found.\n", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  const etag = `"branding-${image.version}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { etag } });
  }
  return new Response(image.bytes, {
    headers: {
      "cache-control": "public, max-age=300",
      "content-type": image.contentType,
      etag,
    },
  });
}
