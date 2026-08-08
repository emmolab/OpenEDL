import {
  getAuditRetentionSettings,
  getDatabaseStats,
  getSourceSafetyLimits,
  getVacuumSchedule,
  runAuditRetention,
  updateAuditRetention,
  updateVacuumSchedule,
  updateSourceSafetyLimits,
  type VacuumSchedule,
  vacuumDatabase,
} from "../../../../db/core";
import { getManagementIdentity } from "../../../../lib/auth";

async function requireAdministrator(request: Request) {
  const identity = await getManagementIdentity(request);
  if (!identity) {
    return Response.json({ error: "Sign-in required." }, { status: 401 });
  }
  if (identity.role !== "admin") {
    return Response.json(
      { error: "Administrator access is required." },
      { status: 403 },
    );
  }
  return null;
}

export async function GET(request: Request) {
  const unauthorized = await requireAdministrator(request);
  if (unauthorized) return unauthorized;
  return Response.json({
    limits: await getSourceSafetyLimits(),
    database: await getDatabaseStats(),
    vacuumSchedule: await getVacuumSchedule(),
    auditRetention: await getAuditRetentionSettings(),
  });
}

export async function PATCH(request: Request) {
  const unauthorized = await requireAdministrator(request);
  if (unauthorized) return unauthorized;
  try {
    const payload = (await request.json()) as {
      remoteSourceMaxMb?: number;
      apiSourceMaxMb?: number;
      vacuumSchedule?: VacuumSchedule;
      auditRetentionDays?: number;
    };
    if (payload.auditRetentionDays !== undefined) {
      return Response.json({
        auditRetention: await updateAuditRetention(payload.auditRetentionDays),
      });
    }
    if (payload.vacuumSchedule !== undefined) {
      return Response.json({
        vacuumSchedule: await updateVacuumSchedule(payload.vacuumSchedule),
      });
    }
    await updateSourceSafetyLimits({
      remoteSourceMaxMb: payload.remoteSourceMaxMb ?? Number.NaN,
      apiSourceMaxMb: payload.apiSourceMaxMb ?? Number.NaN,
    });
    return Response.json({ limits: await getSourceSafetyLimits() });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to update source limits.",
      },
      { status: 400 },
    );
  }
}

export async function POST(request: Request) {
  const unauthorized = await requireAdministrator(request);
  if (unauthorized) return unauthorized;
  try {
    const payload = (await request.json()) as { action?: string };
    if (payload.action === "audit_retention") {
      return Response.json(await runAuditRetention(undefined, true, true));
    }
    if (payload.action !== "vacuum") {
      return Response.json(
        { error: "Unsupported maintenance action." },
        { status: 400 },
      );
    }
    return Response.json(await vacuumDatabase());
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to run maintenance.",
      },
      { status: 409 },
    );
  }
}
