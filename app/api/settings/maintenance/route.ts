import {
  createDatabaseBackup,
  getAuditRetentionSettings,
  getBackupSchedule,
  getDatabaseBackups,
  getDatabaseStats,
  getSourceSafetyLimits,
  getVacuumSchedule,
  runAuditRetention,
  restoreDatabaseBackup,
  restoreUploadedDatabaseBackup,
  updateAuditRetention,
  updateBackupSchedule,
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
    backups: await getDatabaseBackups(),
    backupSchedule: await getBackupSchedule(),
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
      vacuumTimeUtc?: string;
      backupSchedule?: VacuumSchedule;
      backupTimeUtc?: string;
      backupRetentionCount?: number;
      auditRetentionDays?: number;
    };
    if (payload.auditRetentionDays !== undefined) {
      return Response.json({
        auditRetention: await updateAuditRetention(payload.auditRetentionDays),
      });
    }
    if (payload.backupSchedule !== undefined) {
      return Response.json({
        backupSchedule: await updateBackupSchedule({
          schedule: payload.backupSchedule,
          timeUtc: payload.backupTimeUtc ?? "01:00",
          retentionCount: payload.backupRetentionCount ?? Number.NaN,
        }),
      });
    }
    if (payload.vacuumSchedule !== undefined) {
      return Response.json({
        vacuumSchedule: await updateVacuumSchedule(
          payload.vacuumSchedule,
          payload.vacuumTimeUtc,
        ),
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
    const requestUrl = new URL(request.url);
    if (requestUrl.searchParams.get("action") === "restore-upload") {
      const fileName = requestUrl.searchParams.get("fileName") ?? "";
      const declaredSize = Number(request.headers.get("content-length") ?? 0);
      if (request.headers.get("x-openedl-restore-confirmation") !== "restore") {
        return Response.json(
          { error: "Confirm the uploaded database backup before restoring it." },
          { status: 400 },
        );
      }
      if (request.headers.get("content-type") !== "application/octet-stream") {
        return Response.json(
          { error: "Database backup uploads must use application/octet-stream." },
          { status: 415 },
        );
      }
      if (declaredSize > 1_000_000_000) {
        return Response.json(
          { error: "Database backup uploads cannot exceed 1 GB." },
          { status: 413 },
        );
      }
      if (!request.body) {
        return Response.json(
          { error: "The uploaded backup file is empty." },
          { status: 400 },
        );
      }
      return Response.json(
        await restoreUploadedDatabaseBackup(fileName, request.body),
      );
    }

    const payload = (await request.json()) as {
      action?: string;
      fileName?: string;
      confirmFileName?: string;
    };
    if (payload.action === "audit_retention") {
      return Response.json(await runAuditRetention(undefined, true, true));
    }
    if (payload.action === "backup") {
      return Response.json(await createDatabaseBackup());
    }
    if (payload.action === "restore") {
      if (
        typeof payload.fileName !== "string" ||
        payload.confirmFileName !== payload.fileName
      ) {
        return Response.json(
          { error: "Select and confirm the database backup to restore." },
          { status: 400 },
        );
      }
      return Response.json(await restoreDatabaseBackup(payload.fileName));
    }
    if (payload.action !== "vacuum") {
      return Response.json(
        { error: "Unsupported maintenance action." },
        { status: 400 },
      );
    }
    return Response.json(await vacuumDatabase());
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to run maintenance.";
    return Response.json(
      { error: message },
      { status: /cannot exceed 1 GB/i.test(message) ? 413 : 409 },
    );
  }
}
