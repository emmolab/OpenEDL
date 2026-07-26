import { endManagementSession } from "../../../../lib/auth";

export async function POST(request: Request) {
  return new Response(null, {
    status: 204,
    headers: {
      "set-cookie": await endManagementSession(request),
    },
  });
}
