import {
  createInitialAdministrator,
  InitialSetupError,
  isInitialSetupRequired,
} from "../../../lib/auth";

export async function GET() {
  try {
    return Response.json(
      { required: await isInitialSetupRequired() },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to inspect initial setup.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    if (!request.headers.get("content-type")?.includes("application/json")) {
      throw new InitialSetupError("A JSON request body is required.", 415);
    }

    const payload = (await request.json()) as {
      name?: string;
      email?: string;
      password?: string;
    };
    const result = await createInitialAdministrator(request, {
      name: payload.name ?? "",
      email: payload.email ?? "",
      password: payload.password ?? "",
    });

    return Response.json(
      { created: true, user: result.user },
      {
        status: 201,
        headers: {
          "cache-control": "no-store",
          "set-cookie": result.cookie,
        },
      },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to create the initial administrator.",
      },
      {
        status: error instanceof InitialSetupError ? error.status : 400,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}
