function toBase64Url(value: Uint8Array) {
  let binary = "";
  value.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function importEncryptionKey(encodedKey: string | undefined) {
  if (!encodedKey?.trim()) {
    throw new Error(
      "CONFIG_ENCRYPTION_KEY is required before API credentials can be stored.",
    );
  }
  let keyBytes: Uint8Array<ArrayBuffer>;
  try {
    keyBytes = fromBase64Url(encodedKey.trim());
  } catch {
    throw new Error("CONFIG_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }
  if (keyBytes.byteLength !== 32) {
    throw new Error("CONFIG_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  }
  return crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptConfigSecret(
  encodedKey: string | undefined,
  scope: string,
  secret: string,
) {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode(scope),
    },
    await importEncryptionKey(encodedKey),
    new TextEncoder().encode(secret),
  );
  return {
    ciphertext: toBase64Url(new Uint8Array(ciphertext)),
    iv: toBase64Url(iv),
  };
}

export async function decryptConfigSecret(
  encodedKey: string | undefined,
  scope: string,
  ciphertext: string,
  iv: string,
) {
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: fromBase64Url(iv),
        additionalData: new TextEncoder().encode(scope),
      },
      await importEncryptionKey(encodedKey),
      fromBase64Url(ciphertext),
    );
    return new TextDecoder().decode(plaintext);
  } catch (error) {
    if (error instanceof Error && error.message.includes("CONFIG_ENCRYPTION_KEY")) {
      throw error;
    }
    throw new Error("Unable to decrypt this API source credential.");
  }
}
