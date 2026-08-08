export const MAX_BRANDING_IMAGE_BYTES = 1024 * 1024;

const SUPPORTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export type ParsedBrandingImage = {
  contentType: "image/png" | "image/jpeg" | "image/webp";
  bytes: Uint8Array;
};

function hasBytes(bytes: Uint8Array, offset: number, expected: number[]) {
  return expected.every((value, index) => bytes[offset + index] === value);
}

export function parseBrandingImageDataUrl(
  value: unknown,
): ParsedBrandingImage {
  if (typeof value !== "string") {
    throw new Error("Choose a PNG, JPEG, or WebP image.");
  }
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(
    value,
  );
  if (!match || !SUPPORTED_IMAGE_TYPES.has(match[1]) || match[2].length % 4) {
    throw new Error("Choose a valid PNG, JPEG, or WebP image.");
  }

  let binary: string;
  try {
    binary = atob(match[2]);
  } catch {
    throw new Error("The uploaded image is not valid base64 data.");
  }
  if (binary.length === 0 || binary.length > MAX_BRANDING_IMAGE_BYTES) {
    throw new Error("Branding images must be 1 MB or smaller.");
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const contentType = match[1] as ParsedBrandingImage["contentType"];
  const validSignature =
    (contentType === "image/png" &&
      hasBytes(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
    (contentType === "image/jpeg" &&
      hasBytes(bytes, 0, [0xff, 0xd8, 0xff])) ||
    (contentType === "image/webp" &&
      hasBytes(bytes, 0, [0x52, 0x49, 0x46, 0x46]) &&
      hasBytes(bytes, 8, [0x57, 0x45, 0x42, 0x50]));
  if (!validSignature) {
    throw new Error("The file contents do not match the selected image type.");
  }
  return { contentType, bytes };
}
