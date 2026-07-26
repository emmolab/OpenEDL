import {
  deleteSource,
  updateManualSource,
  updateSourceSchedule,
} from "../../../../db/core";
import { isManagementAuthorized } from "../../../../lib/auth";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!(await isManagementAuthorized(request))) {
    return Response.json({ error: "Sign-in required." }, { status: 401 });
  }

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
  if (!(await isManagementAuthorized(request))) {
    return Response.json({ error: "Sign-in required." }, { status: 401 });
  }

  const { id } = await context.params;
  const sourceId = Number(id);
  if (!Number.isInteger(sourceId) || sourceId <= 0) {
    return Response.json({ error: "Invalid source id." }, { status: 400 });
  }

  const payload = (await request.json()) as {
    refreshIntervalMinutes?: number;
    manualEntries?: string;
    name?: string;
  };
  if (payload.manualEntries !== undefined) {
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
