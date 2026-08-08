import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_BRANDING_IMAGE_BYTES,
  parseBrandingImageDataUrl,
} from "../lib/branding.ts";

test("validates branding image data and rejects spoofed or oversized uploads", () => {
  const png = parseBrandingImageDataUrl(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  );
  assert.equal(png.contentType, "image/png");
  assert.ok(png.bytes.length > 8);

  assert.throws(
    () =>
      parseBrandingImageDataUrl(
        "data:image/png;base64,dGhpcyBpcyBub3QgYSBwbmc=",
      ),
    /do not match/,
  );
  assert.throws(
    () =>
      parseBrandingImageDataUrl(
        `data:image/jpeg;base64,${Buffer.alloc(
          MAX_BRANDING_IMAGE_BYTES + 1,
          0xff,
        ).toString("base64")}`,
      ),
    /1 MB or smaller/,
  );
});
