import {
  deleteSource,
  updateManualSource,
  updateRemoteSource,
  updateSourceSchedule,
} from "../../../../db/core";
import { requireAdministrator } from "../../../../lib/auth";
import {
  assertSafeSourceUrl,
  type SourceFormat,
  type SourceRole,
} from "../../../../lib/edl";

const formats = new Set<SourceFormat>(["auto", "text", "json", "csv"]);
const roles = new Set<SourceRole>(["include", "exclude"]);

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authorizationError = await requireAdministrator(request);
  if (authorizationError) return authorizationError;

  const { id } = await context.params;
  const sourceId = Number(id);
  if (!Number.isInteger(sourceId) || sourceId <= 0) {
    return Response.json({ error: "Invalid source id." }, { status: 400 });
  }

  try {
    await deleteSource(sourceId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to delete source.",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authorizationError = await requireAdministrator(request);
  if (authorizationError) return authorizationError;

  const { id } = await context.params;
  const sourceId = Number(id);
  if (!Number.isInteger(sourceId) || sourceId <= 0) {
    return Response.json({ error: "Invalid source id." }, { status: 400 });
  }

  const payload = (await request.json()) as {
    refreshIntervalMinutes?: number;
    manualEntries?: string;
    name?: string;
    url?: string;
    format?: SourceFormat;
    role?: SourceRole;
    apiProvider?: string;
    apiAuthType?: "none" | "bearer" | "header";
    apiAuthHeader?: string;
    apiSecret?: string;
    jsonPath?: string;
  };
  if (payload.manualEntries !== undefined && payload.url === undefined) {
    if (
      typeof payload.manualEntries !== "string" ||
      payload.manualEntries.length > 2_000_000 ||
      (payload.name !== undefined && typeof payload.name !== "string")
    ) {
      return Response.json(
        { error: "Manual entries must be text under 2 MB." },
        { status: 400 },
      );
    }
    try {
      const entryCount = await updateManualSource(
        sourceId,
        payload.manualEntries,
        payload.name,
      );
      return Response.json({ ok: true, entryCount });
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Unable to update manual source.",
        },
        { status: 400 },
      );
    }
  }

  if (payload.url !== undefined) {
    const name = payload.name?.trim() ?? "";
    const url = payload.url.trim();
    const apiProvider = payload.apiProvider?.trim() ?? "";
    const apiAuthType = payload.apiAuthType ?? "none";
    const apiAuthHeader = payload.apiAuthHeader?.trim() ?? "";
    const apiSecret = payload.apiSecret?.trim() || undefined;
    const jsonPath = payload.jsonPath?.trim() ?? "";
    const interval = payload.refreshIntervalMinutes;

    if (!name || name.length > 100) {
      return Response.json(
        { error: "Source name must be 1–100 characters." },
        { status: 400 },
      );
    }
    if (!url) {
      return Response.json(
        { error: "A remote source URL is required." },
        { status: 400 },
      );
    }
    try {
      assertSafeSourceUrl(url);
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error ? error.message : "Invalid source URL.",
        },
        { status: 400 },
      );
    }
    if (!payload.format || !formats.has(payload.format)) {
      return Response.json(
        { error: "Invalid source format." },
        { status: 400 },
      );
    }
    if (!payload.role || !roles.has(payload.role)) {
      return Response.json({ error: "Invalid source role." }, { status: 400 });
    }
    if (!["none", "bearer", "header"].includes(apiAuthType)) {
      return Response.json(
        { error: "Invalid API authentication type." },
        { status: 400 },
      );
    }
    if (apiProvider && apiAuthType === "none") {
      return Response.json(
        { error: "API connections require an authentication method." },
        { status: 400 },
      );
    }
    if (
      apiAuthType === "header" &&
      !/^[A-Za-z0-9-]{1,64}$/.test(apiAuthHeader)
    ) {
      return Response.json(
        { error: "Enter a valid API authentication header name." },
        { status: 400 },
      );
    }
    if ((apiSecret?.length ?? 0) > 4096) {
      return Response.json(
        { error: "API credential is too long." },
        { status: 400 },
      );
    }
    if (jsonPath.length > 256) {
      return Response.json(
        { error: "JSON path is too long." },
        { status: 400 },
      );
    }
    if (apiProvider.length > 100) {
      return Response.json(
        { error: "API provider identifier is too long." },
        { status: 400 },
      );
    }
    if (
      !Number.isInteger(interval) ||
      (interval ?? 0) < 5 ||
      (interval ?? 0) > 10_080
    ) {
      return Response.json(
        { error: "Refresh interval must be between 5 and 10,080 minutes." },
        { status: 400 },
      );
    }

    try {
      await updateRemoteSource(sourceId, {
        name,
        url,
        format: payload.format,
        role: payload.role,
        apiProvider,
        apiAuthType,
        apiAuthHeader,
        apiSecret,
        jsonPath,
        refreshIntervalMinutes: interval as number,
      });
      return Response.json({ ok: true, refreshDue: true });
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Unable to update remote source.",
        },
        { status: 400 },
      );
    }
  }

  const interval = payload.refreshIntervalMinutes;
  if (
    !Number.isInteger(interval) ||
    (interval ?? 0) < 5 ||
    (interval ?? 0) > 10_080
  ) {
    return Response.json(
      { error: "Refresh interval must be between 5 and 10,080 minutes." },
      { status: 400 },
    );
  }

  await updateSourceSchedule(sourceId, interval as number);
  return Response.json({ ok: true, refreshIntervalMinutes: interval });
}
