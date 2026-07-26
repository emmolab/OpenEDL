import {
  createSource,
  refreshSource,
} from "../../../db/core";
import { isManagementAuthorized } from "../../../lib/auth";
import {
  assertSafeSourceUrl,
  type EdlType,
  type SourceFormat,
  type SourceRole,
} from "../../../lib/edl";

const types = new Set<EdlType>(["ip", "domain", "url"]);
const formats = new Set<SourceFormat>(["auto", "text", "json", "csv"]);
const roles = new Set<SourceRole>(["include", "exclude"]);

export async function POST(request: Request) {
  if (!(await isManagementAuthorized(request))) {
    return Response.json({ error: "Sign-in required." }, { status: 401 });
  }

  try {
    const payload = (await request.json()) as {
      listId?: number;
      name?: string;
      url?: string;
      type?: EdlType;
      format?: SourceFormat;
      role?: SourceRole;
      kind?: "remote" | "manual";
      manualEntries?: string;
      refreshIntervalMinutes?: number;
    };

    const name = payload.name?.trim() ?? "";
    const kind = payload.kind === "manual" ? "manual" : "remote";
    const url = payload.url?.trim() ?? "";
    const manualEntries = payload.manualEntries?.trim() ?? "";

    if (!payload.listId || !name) {
      return Response.json(
        { error: "List and source name are required." },
        { status: 400 },
      );
    }
    if (!payload.type || !types.has(payload.type)) {
      return Response.json({ error: "Invalid source type." }, { status: 400 });
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
    if (kind === "remote" && !url) {
      return Response.json(
        { error: "A remote source URL is required." },
        { status: 400 },
      );
    }
    if (kind === "manual" && !manualEntries) {
      return Response.json(
        { error: "Add at least one manual entry." },
        { status: 400 },
      );
    }
    if (kind === "remote") assertSafeSourceUrl(url);
    const refreshIntervalMinutes = payload.refreshIntervalMinutes ?? 60;
    if (
      !Number.isInteger(refreshIntervalMinutes) ||
      refreshIntervalMinutes < 5 ||
      refreshIntervalMinutes > 10_080
    ) {
      return Response.json(
        { error: "Refresh interval must be between 5 and 10,080 minutes." },
        { status: 400 },
      );
    }

    const sourceId = await createSource({
      listId: payload.listId,
      name,
      url,
      type: payload.type,
      format: payload.format,
      role: payload.role,
      kind,
      manualEntries,
      refreshIntervalMinutes,
    });

    const refresh =
      kind === "remote" ? await refreshSource(sourceId) : { ok: true };
    return Response.json({ sourceId, refresh }, { status: 201 });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to create source.",
      },
      { status: 400 },
    );
  }
}
