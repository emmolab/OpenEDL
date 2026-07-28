import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateEntries,
  assertSafeSourceUrl,
  downloadSource,
  normalizeEntries,
} from "../lib/edl.ts";

test("normalizes and deduplicates IPv4, IPv6, CIDR, and ranges", () => {
  const entries = normalizeEntries(
    [
      "# ignored",
      "192.0.2.10",
      "192.0.2.10 # duplicate",
      "2001:db8::1/64",
      "198.51.100.1 - 198.51.100.9",
      "not-an-ip",
    ].join("\n"),
    "ip",
    "text",
  );

  assert.deepEqual(entries, [
    "192.0.2.10",
    "198.51.100.1-198.51.100.9",
    "2001:db8::1/64",
  ]);
});

test("extracts typed values from JSON and CSV sources", () => {
  assert.deepEqual(
    normalizeEntries(
      JSON.stringify({
        indicators: [{ value: "example.com" }, { value: "bad.example" }],
      }),
      "domain",
      "json",
    ),
    ["bad.example", "example.com"],
  );

  assert.deepEqual(
    normalizeEntries(
      "indicator,score\nhttps://evil.example/path,90",
      "url",
      "csv",
    ),
    ["evil.example/path"],
  );
});

test("extracts a configured JSON array path for API responses", () => {
  assert.deepEqual(
    normalizeEntries(
      JSON.stringify({
        data: {
          results: [
            { entity: { name: "one.example" }, risk: { score: 99 } },
            { entity: { name: "two.example" }, risk: { score: 80 } },
          ],
        },
      }),
      "domain",
      "json",
      "data.results[].entity.name",
    ),
    ["one.example", "two.example"],
  );
});

test("parses quoted CSV fields without splitting embedded commas", () => {
  assert.deepEqual(
    normalizeEntries(
      [
        "Name,Risk,Evidence",
        '"203.0.113.8",99,"reported by source one, source two"',
      ].join("\n"),
      "ip",
      "csv",
    ),
    ["203.0.113.8"],
  );
});

test("an exclusion wins even when the IP appears in multiple include feeds", () => {
  assert.deepEqual(
    aggregateEntries(
      [
        ["1.1.1.1", "2.2.2.2"],
        ["1.1.1.1", "2.2.2.2", "3.3.3.3"],
      ],
      [["1.1.1.1"]],
    ),
    {
      entries: ["2.2.2.2", "3.3.3.3"],
      excludedCount: 1,
      duplicateCount: 2,
    },
  );
});

test("rejects local and metadata source URLs", () => {
  assert.throws(() => assertSafeSourceUrl("http://127.0.0.1/feed"));
  assert.throws(() =>
    assertSafeSourceUrl("http://169.254.169.254/latest/meta-data"),
  );
  assert.throws(() => assertSafeSourceUrl("file:///etc/passwd"));
  assert.equal(
    assertSafeSourceUrl("https://example.com/feed.txt").hostname,
    "example.com",
  );
});

test("enforces a caller-supplied source download limit", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("not read", {
      headers: { "content-length": "2000000" },
    });
  try {
    await assert.rejects(
      downloadSource("https://example.com/feed.csv", {
        maxBytes: 1_000_000,
      }),
      /1 MB safety limit/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
