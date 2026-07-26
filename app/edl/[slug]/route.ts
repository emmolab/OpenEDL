import { getAggregatedList } from "../../../db/core";

async function createEtag(body: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(body),
  );
  return `"${Array.from(new Uint8Array(digest))
    .slice(0, 12)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}"`;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;

  try {
    const aggregate = await getAggregatedList(slug);
    if (!aggregate) {
      return new Response("EDL not found.\n", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    const body = aggregate.entries.length
      ? `${aggregate.entries.join("\n")}\n`
      : "";
    const etag = await createEtag(body);

    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, {
        status: 304,
        headers: { etag },
      });
    }

    return new Response(body, {
      headers: {
        "cache-control": "public, max-age=60, s-maxage=300",
        "content-type": "text/plain; charset=utf-8",
        etag,
        "x-edl-entries": String(aggregate.entries.length),
        "x-edl-excluded": String(aggregate.excludedCount),
        "x-edl-sources": String(
          aggregate.sources.filter((source) => source.enabled).length,
        ),
      },
    });
  } catch (error) {
    return new Response(
      `${
        error instanceof Error ? error.message : "Unable to build EDL."
      }\n`,
      {
        status: 500,
        headers: { "content-type": "text/plain; charset=utf-8" },
      },
    );
  }
}
