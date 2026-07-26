import {
  createLocalAccount,
  getManagementIdentity,
  listManagedUsers,
} from "../../../lib/auth";

async function requireAdministrator(request: Request) {
  const identity = await getManagementIdentity(request);
  if (!identity) {
    return {
      error: Response.json({ error: "Sign-in required." }, { status: 401 }),
    };
  }
  if (identity.role !== "admin") {
    return {
      error: Response.json(
        { error: "Administrator access is required." },
        { status: 403 },
      ),
    };
  }
  return { identity };
}

export async function GET(request: Request) {
  const authorization = await requireAdministrator(request);
  if ("error" in authorization) return authorization.error;
  return Response.json({ users: await listManagedUsers() });
}

export async function POST(request: Request) {
  const authorization = await requireAdministrator(request);
  if ("error" in authorization) return authorization.error;

  try {
    const payload = (await request.json()) as {
      name?: string;
      email?: string;
      password?: string;
      role?: string;
    };
    const user = await createLocalAccount({
      name: payload.name ?? "",
      email: payload.email ?? "",
      password: payload.password ?? "",
      role: payload.role ?? "member",
    });
    return Response.json({ user }, { status: 201 });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to create user.",
      },
      { status: 400 },
    );
  }
}
