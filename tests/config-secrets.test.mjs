import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptConfigSecret,
  encryptConfigSecret,
} from "../lib/config-secrets.ts";

test("encrypts API credentials with scoped authenticated encryption", async () => {
  const key = Buffer.alloc(32, 7).toString("base64");
  const encrypted = await encryptConfigSecret(
    key,
    "edl-api-source",
    "vendor-token",
  );

  assert.notEqual(encrypted.ciphertext, "vendor-token");
  assert.equal(
    await decryptConfigSecret(
      key,
      "edl-api-source",
      encrypted.ciphertext,
      encrypted.iv,
    ),
    "vendor-token",
  );
  await assert.rejects(
    decryptConfigSecret(
      key,
      "different-scope",
      encrypted.ciphertext,
      encrypted.iv,
    ),
    /Unable to decrypt/,
  );
});

test("requires a valid 32-byte configuration key", async () => {
  await assert.rejects(
    encryptConfigSecret("", "edl-api-source", "secret"),
    /CONFIG_ENCRYPTION_KEY is required/,
  );
  await assert.rejects(
    encryptConfigSecret(
      Buffer.alloc(16, 7).toString("base64"),
      "edl-api-source",
      "secret",
    ),
    /exactly 32 bytes/,
  );
});
