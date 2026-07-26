import { getManagementIdentity } from "../../../../lib/auth";

export async function GET(request: Request) {
  const user = await getManagementIdentity(request);
  return Response.json({ authenticated: Boolean(user), user });
}
