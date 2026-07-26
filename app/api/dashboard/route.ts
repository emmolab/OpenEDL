import { getDashboard } from "../../../db/core";
import { isManagementAuthorized } from "../../../lib/auth";

export async function GET(request: Request) {
  if (!(await isManagementAuthorized(request))) {
    return Response.json({ error: "Sign-in required." }, { status: 401 });
  }

  try {
    return Response.json(await getDashboard());
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load the dashboard.",
      },
      { status: 500 },
    );
  }
}
