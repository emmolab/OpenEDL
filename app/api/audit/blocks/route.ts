import {
  getBlockAudit,
  unblockPublishedEntry,
} from "../../../../db/core";
import { getManagementIdentity } from "../../../../lib/auth";

export async function GET(request: Request) {
  const identity = await getManagementIdentity(request);
  if (!identity) {
    return Response.json({ error: "Sign-in required." }, { status: 401 });
  }
  const url = new URL(request.url);
  const rawListId = url.searchParams.get("listId");
  const listId = rawListId ? Number(rawListId) : undefined;
  if (listId !== undefined && (!Number.isInteger(listId) || listId < 1)) {
    return Response.json({ error: "Invalid list id." }, { status: 400 });
  }
  return Response.json(
    await getBlockAudit({
      query: url.searchParams.get("q") ?? "",
      listId,
      limit: 100,
    }),
  );
}

export async function POST(request: Request) {
  const identity = await getManagementIdentity(request);
  if (!identity) {
    return Response.json({ error: "Sign-in required." }, { status: 401 });
  }
  if (identity.role !== "admin") {
    return Response.json(
      { error: "Administrator access is required to unblock entries." },
      { status: 403 },
    );
  }
  try {
    const payload = (await request.json()) as {
      action?: string;
      listId?: number;
      entry?: string;
    };
    if (
      payload.action !== "unblock" ||
      !Number.isInteger(payload.listId) ||
      (payload.listId ?? 0) < 1 ||
      typeof payload.entry !== "string"
    ) {
      return Response.json(
        { error: "A valid published list and entry are required." },
        { status: 400 },
      );
    }
    return Response.json(
      await unblockPublishedEntry(payload.listId as number, payload.entry),
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to unblock entry.",
      },
      { status: 400 },
    );
  }
}
