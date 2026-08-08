import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("publishes containers only for releases or explicit manual runs", async () => {
  const publish = await readFile(
    new URL("../.github/workflows/publish-container.yml", import.meta.url),
    "utf8",
  );
  const validate = await readFile(
    new URL("../.github/workflows/validate.yml", import.meta.url),
    "utf8",
  );
  const dockerIgnore = await readFile(
    new URL("../.dockerignore", import.meta.url),
    "utf8",
  );

  assert.match(publish, /^  release:\n    types:\n      - published$/m);
  assert.match(publish, /^  workflow_dispatch:$/m);
  assert.doesNotMatch(publish, /^  push:$/m);
  assert.doesNotMatch(publish, /^  pull_request:$/m);
  assert.match(publish, /type=raw,value=\$\{\{ steps\.release\.outputs\.tag \}\}/);
  assert.match(publish, /type=raw,value=\$\{\{ steps\.release\.outputs\.minor \}\}/);
  assert.match(publish, /type=raw,value=\$\{\{ steps\.release\.outputs\.major \}\}/);
  assert.doesNotMatch(publish, /type=semver/);
  assert.match(publish, /type=raw,value=latest/);
  assert.match(publish, /^          push: true$/m);

  assert.match(validate, /^  push:$/m);
  assert.match(validate, /^  pull_request:$/m);
  assert.match(validate, /run: npm run lint/);
  assert.match(validate, /run: npm test/);
  assert.doesNotMatch(dockerIgnore, /^\.github$/m);

  await assert.rejects(
    access(
      new URL(
        "../.github/workflows/ghcr-release-retention.yml",
        import.meta.url,
      ),
    ),
    { code: "ENOENT" },
  );
});
