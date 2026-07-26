import {
  getManagementIdentity,
  updateOwnProfile,
} from "../../../lib/auth";

export async function GET(request: Request) {
  const identity = await getManagementIdentity(request);
  if (!identity) {
    return Response.json({ error: "Sign-in required." }, { status: 401 });
  }
  return Response.json({ user: identity });
}

export async function PATCH(request: Request) {
  const identity = await getManagementIdentity(request);
  if (!identity) {
    return Response.json({ error: "Sign-in required." }, { status: 401 });
  }
  try {
    const payload = (await request.json()) as {
      name?: string;
      email?: string;
      currentPassword?: string;
      newPassword?: string;
    };
    const user = await updateOwnProfile(request, identity, payload);
    return Response.json({ user });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to update profile.",
      },
      { status: 400 },
    );
  }
}
