"use client";

import {
  Children,
  FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";

type Limits = {
  remoteSourceMaxMb: number;
  apiSourceMaxMb: number;
};

type DatabaseStats = {
  available: boolean;
  pageCount: number;
  pageSize: number;
  freePageCount: number;
  sizeBytes: number;
  reclaimableBytes: number;
};

type MaintenanceData = {
  limits: Limits;
  database: DatabaseStats;
  backups: DatabaseBackupFile[];
  backupSchedule: BackupScheduleSettings;
  vacuumSchedule: VacuumScheduleSettings;
  auditRetention: AuditRetentionSettings;
};

type DatabaseBackupFile = {
  createdAt: string;
  fileName: string;
  sizeBytes: number;
};

type AuditRetentionSettings = {
  days: number;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastDeleted: number;
};

type VacuumSchedule = "disabled" | "daily" | "weekly" | "monthly";

type VacuumScheduleSettings = {
  schedule: VacuumSchedule;
  timeUtc: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: "never" | "success" | "failed";
  lastError: string | null;
};

type BackupScheduleSettings = VacuumScheduleSettings & {
  available: boolean;
  directory: string | null;
  retentionCount: number;
  lastFileName: string | null;
  lastSizeBytes: number;
};

type Props = {
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  setNotice: (message: string) => void;
};

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && size >= 1024; index += 1) {
    size /= 1024;
    unit = units[index];
  }
  return `${size.toFixed(size >= 100 ? 0 : size >= 10 ? 1 : 2)} ${unit}`;
}

function dateLabel(value: string | null) {
  if (!value) return "Not scheduled";
  const date = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime())
    ? "Unknown"
    : new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

function MaintenanceCardGrid({ children }: { children: ReactNode }) {
  const cards = Children.toArray(children);
  return (
    <section className="maintenance-grid">
      <div className="maintenance-column">
        {cards.filter((_card, index) => index % 2 === 0)}
      </div>
      <div className="maintenance-column">
        {cards.filter((_card, index) => index % 2 === 1)}
      </div>
    </section>
  );
}

export function MaintenanceSettings({ apiFetch, setNotice }: Props) {
  const [data, setData] = useState<MaintenanceData | null>(null);
  const [remoteLimit, setRemoteLimit] = useState(2);
  const [apiLimit, setApiLimit] = useState(20);
  const [vacuumSchedule, setVacuumSchedule] =
    useState<VacuumSchedule>("disabled");
  const [vacuumTimeUtc, setVacuumTimeUtc] = useState("02:00");
  const [backupSchedule, setBackupSchedule] =
    useState<VacuumSchedule>("disabled");
  const [backupTimeUtc, setBackupTimeUtc] = useState("01:00");
  const [backupRetentionCount, setBackupRetentionCount] = useState(8);
  const [selectedBackupFile, setSelectedBackupFile] = useState("");
  const [uploadedBackupFile, setUploadedBackupFile] = useState<File | null>(null);
  const [auditRetentionEnabled, setAuditRetentionEnabled] = useState(false);
  const [auditRetentionDays, setAuditRetentionDays] = useState(90);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isVacuuming, setIsVacuuming] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isSavingBackupSchedule, setIsSavingBackupSchedule] = useState(false);
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);
  const [isSavingRetention, setIsSavingRetention] = useState(false);
  const [isRunningRetention, setIsRunningRetention] = useState(false);
  const [showVacuumConfirmation, setShowVacuumConfirmation] = useState(false);
  const [showBackupConfirmation, setShowBackupConfirmation] = useState(false);
  const [showRestoreConfirmation, setShowRestoreConfirmation] = useState(false);
  const [showUploadRestoreConfirmation, setShowUploadRestoreConfirmation] =
    useState(false);
  const [showRetentionConfirmation, setShowRetentionConfirmation] =
    useState(false);

  const load = useCallback(async () => {
    try {
      const response = await apiFetch("/api/settings/maintenance", {
        cache: "no-store",
      });
      const payload = (await response.json()) as MaintenanceData & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load maintenance settings.");
      }
      setData(payload);
      setRemoteLimit(payload.limits.remoteSourceMaxMb);
      setApiLimit(payload.limits.apiSourceMaxMb);
      setVacuumSchedule(payload.vacuumSchedule.schedule);
      setVacuumTimeUtc(payload.vacuumSchedule.timeUtc);
      setBackupSchedule(payload.backupSchedule.schedule);
      setBackupTimeUtc(payload.backupSchedule.timeUtc);
      setBackupRetentionCount(payload.backupSchedule.retentionCount);
      setSelectedBackupFile((current) =>
        payload.backups.some((backup) => backup.fileName === current)
          ? current
          : (payload.backups[0]?.fileName ?? ""),
      );
      setAuditRetentionEnabled(payload.auditRetention.enabled);
      setAuditRetentionDays(payload.auditRetention.days || 90);
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load maintenance settings.",
      );
    }
  }, [apiFetch]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  useEffect(() => {
    if (
      !showVacuumConfirmation &&
      !showBackupConfirmation &&
      !showRestoreConfirmation &&
      !showUploadRestoreConfirmation &&
      !showRetentionConfirmation
    ) {
      return;
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowVacuumConfirmation(false);
        setShowBackupConfirmation(false);
        setShowRestoreConfirmation(false);
        setShowUploadRestoreConfirmation(false);
        setShowRetentionConfirmation(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [
    showBackupConfirmation,
    showRestoreConfirmation,
    showUploadRestoreConfirmation,
    showRetentionConfirmation,
    showVacuumConfirmation,
  ]);

  async function saveLimits(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError("");
    try {
      const response = await apiFetch("/api/settings/maintenance", {
        method: "PATCH",
        body: JSON.stringify({
          remoteSourceMaxMb: remoteLimit,
          apiSourceMaxMb: apiLimit,
        }),
      });
      const payload = (await response.json()) as {
        limits?: Limits;
        error?: string;
      };
      if (!response.ok || !payload.limits) {
        throw new Error(payload.error ?? "Unable to save source limits.");
      }
      setData((current) =>
        current ? { ...current, limits: payload.limits as Limits } : current,
      );
      setNotice("Source download safety limits updated.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save source limits.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function vacuum() {
    setShowVacuumConfirmation(false);
    setIsVacuuming(true);
    setError("");
    try {
      const response = await apiFetch("/api/settings/maintenance", {
        method: "POST",
        body: JSON.stringify({ action: "vacuum" }),
      });
      const payload = (await response.json()) as {
        after?: DatabaseStats;
        reclaimedBytes?: number;
        error?: string;
      };
      if (!response.ok || !payload.after) {
        throw new Error(payload.error ?? "Unable to compact the database.");
      }
      setData((current) =>
        current ? { ...current, database: payload.after as DatabaseStats } : current,
      );
      setNotice(
        `Database compacted · ${formatBytes(payload.reclaimedBytes ?? 0)} reclaimed.`,
      );
    } catch (vacuumError) {
      setError(
        vacuumError instanceof Error
          ? vacuumError.message
          : "Unable to compact the database.",
      );
    } finally {
      setIsVacuuming(false);
    }
  }

  async function saveVacuumSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingSchedule(true);
    setError("");
    try {
      const response = await apiFetch("/api/settings/maintenance", {
        method: "PATCH",
        body: JSON.stringify({ vacuumSchedule, vacuumTimeUtc }),
      });
      const payload = (await response.json()) as {
        vacuumSchedule?: VacuumScheduleSettings;
        error?: string;
      };
      if (!response.ok || !payload.vacuumSchedule) {
        throw new Error(payload.error ?? "Unable to save VACUUM schedule.");
      }
      setData((current) =>
        current
          ? { ...current, vacuumSchedule: payload.vacuumSchedule as VacuumScheduleSettings }
          : current,
      );
      setNotice(
        vacuumSchedule === "disabled"
          ? "Scheduled database VACUUM disabled."
          : `Database VACUUM scheduled ${vacuumSchedule} at ${vacuumTimeUtc} UTC.`,
      );
    } catch (scheduleError) {
      setError(
        scheduleError instanceof Error
          ? scheduleError.message
          : "Unable to save VACUUM schedule.",
      );
    } finally {
      setIsSavingSchedule(false);
    }
  }

  async function backupNow() {
    setShowBackupConfirmation(false);
    setIsBackingUp(true);
    setError("");
    try {
      const response = await apiFetch("/api/settings/maintenance", {
        method: "POST",
        body: JSON.stringify({ action: "backup" }),
      });
      const payload = (await response.json()) as {
        fileName?: string;
        sizeBytes?: number;
        pruned?: number;
        settings?: BackupScheduleSettings;
        backups?: DatabaseBackupFile[];
        error?: string;
      };
      if (
        !response.ok ||
        !payload.settings ||
        !payload.backups ||
        !payload.fileName
      ) {
        throw new Error(payload.error ?? "Unable to back up the database.");
      }
      setData((current) =>
        current
          ? {
              ...current,
              backupSchedule: payload.settings as BackupScheduleSettings,
              backups: payload.backups as DatabaseBackupFile[],
            }
          : current,
      );
      setSelectedBackupFile(payload.fileName);
      setNotice(
        `Database backup created · ${payload.fileName} · ${formatBytes(payload.sizeBytes ?? 0)}${payload.pruned ? ` · ${payload.pruned} expired backup${payload.pruned === 1 ? "" : "s"} removed` : ""}.`,
      );
    } catch (backupError) {
      setError(
        backupError instanceof Error
          ? backupError.message
          : "Unable to back up the database.",
      );
    } finally {
      setIsBackingUp(false);
    }
  }

  async function saveBackupSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingBackupSchedule(true);
    setError("");
    try {
      const response = await apiFetch("/api/settings/maintenance", {
        method: "PATCH",
        body: JSON.stringify({
          backupSchedule,
          backupTimeUtc,
          backupRetentionCount,
        }),
      });
      const payload = (await response.json()) as {
        backupSchedule?: BackupScheduleSettings;
        error?: string;
      };
      if (!response.ok || !payload.backupSchedule) {
        throw new Error(payload.error ?? "Unable to save backup schedule.");
      }
      setData((current) =>
        current
          ? {
              ...current,
              backupSchedule: payload.backupSchedule as BackupScheduleSettings,
            }
          : current,
      );
      setNotice(
        backupSchedule === "disabled"
          ? "Scheduled database backups disabled."
          : `Database backups scheduled ${backupSchedule} at ${backupTimeUtc} UTC.`,
      );
    } catch (scheduleError) {
      setError(
        scheduleError instanceof Error
          ? scheduleError.message
          : "Unable to save backup schedule.",
      );
    } finally {
      setIsSavingBackupSchedule(false);
    }
  }

  async function restoreBackup() {
    if (!selectedBackupFile) return;
    setShowRestoreConfirmation(false);
    setIsRestoring(true);
    setError("");
    try {
      const response = await apiFetch("/api/settings/maintenance", {
        method: "POST",
        body: JSON.stringify({
          action: "restore",
          fileName: selectedBackupFile,
          confirmFileName: selectedBackupFile,
        }),
      });
      const payload = (await response.json()) as {
        fileName?: string;
        safetyBackupFileName?: string;
        error?: string;
      };
      if (!response.ok || !payload.fileName) {
        throw new Error(payload.error ?? "Unable to restore the database backup.");
      }
      setNotice(
        `Database restored from ${payload.fileName}. Pre-restore safety backup: ${payload.safetyBackupFileName ?? "created"}. Reloading…`,
      );
      window.setTimeout(() => window.location.reload(), 1200);
    } catch (restoreError) {
      setError(
        restoreError instanceof Error
          ? restoreError.message
          : "Unable to restore the database backup.",
      );
      setIsRestoring(false);
    }
  }

  async function restoreUploadedBackup() {
    if (!uploadedBackupFile) return;
    setShowUploadRestoreConfirmation(false);
    setIsRestoring(true);
    setError("");
    try {
      const response = await apiFetch(
        `/api/settings/maintenance?action=restore-upload&fileName=${encodeURIComponent(uploadedBackupFile.name)}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/octet-stream",
            "x-openedl-restore-confirmation": "restore",
          },
          body: uploadedBackupFile,
        },
      );
      const payload = (await response.json()) as {
        fileName?: string;
        originalFileName?: string;
        safetyBackupFileName?: string;
        error?: string;
      };
      if (!response.ok || !payload.fileName) {
        throw new Error(
          payload.error ?? "Unable to restore the uploaded database backup.",
        );
      }
      setNotice(
        `Database restored from ${payload.originalFileName ?? uploadedBackupFile.name}. Pre-restore safety backup: ${payload.safetyBackupFileName ?? "created"}. Reloading…`,
      );
      window.setTimeout(() => window.location.reload(), 1200);
    } catch (restoreError) {
      setError(
        restoreError instanceof Error
          ? restoreError.message
          : "Unable to restore the uploaded database backup.",
      );
      setIsRestoring(false);
    }
  }

  async function saveAuditRetention(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingRetention(true);
    setError("");
    try {
      const response = await apiFetch("/api/settings/maintenance", {
        method: "PATCH",
        body: JSON.stringify({
          auditRetentionDays: auditRetentionEnabled ? auditRetentionDays : 0,
        }),
      });
      const payload = (await response.json()) as {
        auditRetention?: AuditRetentionSettings;
        error?: string;
      };
      if (!response.ok || !payload.auditRetention) {
        throw new Error(payload.error ?? "Unable to save audit retention.");
      }
      setData((current) =>
        current
          ? {
              ...current,
              auditRetention: payload.auditRetention as AuditRetentionSettings,
            }
          : current,
      );
      setNotice(
        payload.auditRetention.enabled
          ? `Audit records older than ${payload.auditRetention.days} days will be deleted automatically.`
          : "Automatic audit retention cleanup disabled.",
      );
    } catch (retentionError) {
      setError(
        retentionError instanceof Error
          ? retentionError.message
          : "Unable to save audit retention.",
      );
    } finally {
      setIsSavingRetention(false);
    }
  }

  async function runAuditRetentionNow() {
    setShowRetentionConfirmation(false);
    setIsRunningRetention(true);
    setError("");
    try {
      const response = await apiFetch("/api/settings/maintenance", {
        method: "POST",
        body: JSON.stringify({ action: "audit_retention" }),
      });
      const payload = (await response.json()) as {
        deleted?: number;
        settings?: AuditRetentionSettings;
        error?: string;
      };
      if (!response.ok || !payload.settings) {
        throw new Error(payload.error ?? "Unable to clean audit records.");
      }
      setData((current) =>
        current
          ? { ...current, auditRetention: payload.settings as AuditRetentionSettings }
          : current,
      );
      setNotice(
        `Audit retention cleanup complete · ${payload.deleted ?? 0} expired record${payload.deleted === 1 ? "" : "s"} deleted.`,
      );
    } catch (retentionError) {
      setError(
        retentionError instanceof Error
          ? retentionError.message
          : "Unable to clean audit records.",
      );
    } finally {
      setIsRunningRetention(false);
    }
  }

  return (
    <>
      <section className="page-heading users-heading">
        <div>
          <p className="eyebrow">Administrator tools</p>
          <h1>
            Storage
            <br />
            <em>maintenance.</em>
          </h1>
          <p className="heading-copy">
            Schedule verified SQLite backups, tune feed download ceilings,
            control audit retention, and reclaim unused pages.
          </p>
        </div>
      </section>

      {error && <p className="settings-error">{error}</p>}

      <MaintenanceCardGrid>
        <article className="panel maintenance-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Ingestion guardrails</p>
              <h2>Source safety limits</h2>
            </div>
            <span className="format-pill">Global</span>
          </div>
          <form className="maintenance-form" onSubmit={saveLimits}>
            <div className="field">
              <label htmlFor="remote-source-limit">
                Standard remote URL limit
              </label>
              <div className="unit-field">
                <input
                  id="remote-source-limit"
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  value={remoteLimit}
                  onChange={(event) =>
                    setRemoteLimit(Number(event.target.value))
                  }
                  required
                />
                <span>MB</span>
              </div>
              <small>Allowed range: 1–100 MB per response.</small>
            </div>
            <div className="field">
              <label htmlFor="api-source-limit">
                Authenticated API feed limit
              </label>
              <div className="unit-field">
                <input
                  id="api-source-limit"
                  type="number"
                  min={1}
                  max={500}
                  step={1}
                  value={apiLimit}
                  onChange={(event) => setApiLimit(Number(event.target.value))}
                  required
                />
                <span>MB</span>
              </div>
              <small>
                Allowed range: 1–500 MB. Large values require proportionally
                more application memory while parsing.
              </small>
            </div>
            <div className="profile-actions">
              <button
                className="primary-button"
                type="submit"
                disabled={isSaving}
              >
                {isSaving ? "Saving…" : "Save limits"}
              </button>
            </div>
          </form>
        </article>

        <article className="panel maintenance-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Data protection</p>
              <h2>SQLite backups</h2>
            </div>
            <span className="format-pill">
              {data?.backupSchedule.available ? "Available" : "Unavailable"}
            </span>
          </div>
          <div className="database-stats">
            <div>
              <span>Last backup</span>
              <strong>
                {dateLabel(data?.backupSchedule.lastRunAt ?? null)}
              </strong>
            </div>
            <div>
              <span>Last size</span>
              <strong>
                {data?.backupSchedule.lastSizeBytes
                  ? formatBytes(data.backupSchedule.lastSizeBytes)
                  : "—"}
              </strong>
            </div>
            <div>
              <span>Last status</span>
              <strong>{data?.backupSchedule.lastStatus ?? "never"}</strong>
            </div>
          </div>
          <div className="maintenance-action">
            <p>
              Backups use SQLite&apos;s online backup API and are verified before
              they are retained. They are stored in{" "}
              <code>{data?.backupSchedule.directory ?? "the SQLite host"}</code>
              {data?.backupSchedule.lastFileName
                ? ` · Latest: ${data.backupSchedule.lastFileName}`
                : ""}
              . Managed D1 requires provider-managed backups instead.
            </p>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setShowBackupConfirmation(true)}
              disabled={
                isBackingUp || !data?.backupSchedule.available
              }
            >
              {isBackingUp ? "Backing up…" : "Back up database now"}
            </button>
          </div>
          <div className="backup-restore">
            <div>
              <p className="eyebrow">Recovery</p>
              <h3>Restore from backup</h3>
              <p>
                Restore the complete application database from a verified
                OpenEDL backup. A safety backup of the current database is
                created first.
              </p>
            </div>
            <div className="field">
              <label htmlFor="restore-backup">Backup file</label>
              <select
                id="restore-backup"
                value={selectedBackupFile}
                disabled={isRestoring || data?.backups.length === 0}
                onChange={(event) => setSelectedBackupFile(event.target.value)}
              >
                {data?.backups.length ? (
                  data.backups.map((backup) => (
                    <option key={backup.fileName} value={backup.fileName}>
                      {dateLabel(backup.createdAt)} · {formatBytes(backup.sizeBytes)}
                    </option>
                  ))
                ) : (
                  <option value="">No backup files available</option>
                )}
              </select>
              {selectedBackupFile && <small>{selectedBackupFile}</small>}
            </div>
            <button
              className="secondary-button"
              type="button"
              disabled={isRestoring || !selectedBackupFile}
              onClick={() => setShowRestoreConfirmation(true)}
            >
              {isRestoring ? "Restoring…" : "Restore selected backup"}
            </button>
            <div className="restore-divider">
              <span>Or restore a backup file</span>
            </div>
            <div className="field">
              <label htmlFor="restore-backup-upload">SQLite backup file</label>
              <input
                id="restore-backup-upload"
                type="file"
                accept=".db,.sqlite,.sqlite3,application/vnd.sqlite3,application/octet-stream"
                disabled={isRestoring || !data?.backupSchedule.available}
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  if (file && file.size > 1_000_000_000) {
                    setUploadedBackupFile(null);
                    setError("Database backup uploads cannot exceed 1 GB.");
                    event.target.value = "";
                    return;
                  }
                  setError("");
                  setUploadedBackupFile(file);
                }}
              />
              <small>Accepted: .sqlite, .sqlite3, or .db · Maximum 1 GB</small>
            </div>
            <button
              className="secondary-button"
              type="button"
              disabled={isRestoring || !uploadedBackupFile}
              onClick={() => setShowUploadRestoreConfirmation(true)}
            >
              {isRestoring ? "Restoring…" : "Restore uploaded file"}
            </button>
          </div>
          <form
            className="maintenance-schedule backup-schedule"
            onSubmit={saveBackupSchedule}
          >
            <div className="field">
              <label htmlFor="backup-schedule">Automatic backups</label>
              <select
                id="backup-schedule"
                value={backupSchedule}
                disabled={!data?.backupSchedule.available}
                onChange={(event) =>
                  setBackupSchedule(event.target.value as VacuumSchedule)
                }
              >
                <option value="disabled">Disabled</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="backup-time">Run time</label>
              <input
                id="backup-time"
                type="time"
                step={300}
                value={backupTimeUtc}
                disabled={
                  !data?.backupSchedule.available ||
                  backupSchedule === "disabled"
                }
                onChange={(event) => setBackupTimeUtc(event.target.value)}
                required
              />
              <small>UTC</small>
            </div>
            <div className="field">
              <label htmlFor="backup-retention">Files to retain</label>
              <input
                id="backup-retention"
                type="number"
                min={1}
                max={104}
                step={1}
                value={backupRetentionCount}
                disabled={!data?.backupSchedule.available}
                onChange={(event) =>
                  setBackupRetentionCount(Number(event.target.value))
                }
                required
              />
            </div>
            <button
              className="secondary-button"
              type="submit"
              disabled={
                isSavingBackupSchedule || !data?.backupSchedule.available
              }
            >
              {isSavingBackupSchedule ? "Saving…" : "Save backup schedule"}
            </button>
            <small className="schedule-summary">
              Next run: {dateLabel(data?.backupSchedule.nextRunAt ?? null)}
              {data?.backupSchedule.lastError
                ? ` · Last error: ${data.backupSchedule.lastError}`
                : ""}
            </small>
          </form>
        </article>

        <article className="panel maintenance-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">SQLite storage</p>
              <h2>Database compaction</h2>
            </div>
          </div>
          <div className="database-stats">
            <div>
              <span>Database size</span>
              <strong>
                {data
                  ? data.database.available
                    ? formatBytes(data.database.sizeBytes)
                    : "Unavailable"
                  : "Loading…"}
              </strong>
            </div>
            <div>
              <span>Immediately reclaimable</span>
              <strong>
                {data
                  ? data.database.available
                    ? formatBytes(data.database.reclaimableBytes)
                    : "Unavailable"
                  : "Loading…"}
              </strong>
            </div>
            <div>
              <span>Free pages</span>
              <strong>
                {data?.database.available
                  ? data.database.freePageCount
                  : "Unavailable"}
              </strong>
            </div>
          </div>
          <div className="maintenance-action">
            <p>
              VACUUM rebuilds the SQLite file to return unused pages to disk.
              It can temporarily lock writes; create a backup before running it
              on production. Managed D1 deployments may not expose this
              operation.
            </p>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setShowVacuumConfirmation(true)}
              disabled={isVacuuming || !data || !data.database.available}
            >
              {isVacuuming ? "Compacting…" : "Run database VACUUM"}
            </button>
          </div>
          <form className="maintenance-schedule" onSubmit={saveVacuumSchedule}>
            <div className="field">
              <label htmlFor="vacuum-schedule">Automatic VACUUM</label>
              <select
                id="vacuum-schedule"
                value={vacuumSchedule}
                onChange={(event) =>
                  setVacuumSchedule(event.target.value as VacuumSchedule)
                }
              >
                <option value="disabled">Disabled</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="vacuum-time">Run time</label>
              <input
                id="vacuum-time"
                type="time"
                step={300}
                value={vacuumTimeUtc}
                disabled={vacuumSchedule === "disabled"}
                onChange={(event) => setVacuumTimeUtc(event.target.value)}
                required
              />
              <small>UTC</small>
            </div>
            <button
              className="secondary-button"
              type="submit"
              disabled={isSavingSchedule}
            >
              {isSavingSchedule ? "Saving…" : "Save VACUUM schedule"}
            </button>
            <small className="schedule-summary">
              Next run: {dateLabel(data?.vacuumSchedule.nextRunAt ?? null)}
              {data?.vacuumSchedule.lastRunAt
                ? ` · Last ${data.vacuumSchedule.lastStatus}: ${dateLabel(data.vacuumSchedule.lastRunAt)}`
                : ""}
              {data?.vacuumSchedule.lastError
                ? ` · Last error: ${data.vacuumSchedule.lastError}`
                : ""}
            </small>
          </form>
        </article>

        <article className="panel maintenance-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Audit lifecycle</p>
              <h2>Audit retention</h2>
            </div>
            <span className="format-pill">
              {data?.auditRetention.enabled ? "Enabled" : "Disabled"}
            </span>
          </div>
          <form className="maintenance-form" onSubmit={saveAuditRetention}>
            <label className="setting-check">
              <input
                type="checkbox"
                checked={auditRetentionEnabled}
                onChange={(event) =>
                  setAuditRetentionEnabled(event.target.checked)
                }
              />
              Automatically delete expired audit records
            </label>
            <div className="field">
              <label htmlFor="audit-retention-days">Retention period</label>
              <div className="unit-field">
                <input
                  id="audit-retention-days"
                  type="number"
                  min={1}
                  max={3650}
                  step={1}
                  value={auditRetentionDays}
                  disabled={!auditRetentionEnabled}
                  onChange={(event) =>
                    setAuditRetentionDays(Number(event.target.value))
                  }
                  required={auditRetentionEnabled}
                />
                <span>days</span>
              </div>
              <small>
                Disabled by default. When enabled, membership events and
                lifetime entries older than this period are removed daily.
              </small>
              {data?.auditRetention.lastRunAt && (
                <small>
                  Last cleanup: {dateLabel(data.auditRetention.lastRunAt)} ·{" "}
                  {data.auditRetention.lastDeleted} records deleted
                </small>
              )}
            </div>
            <div className="retention-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={
                  !data?.auditRetention.enabled || isRunningRetention
                }
                onClick={() => setShowRetentionConfirmation(true)}
              >
                {isRunningRetention ? "Cleaning…" : "Clean expired audit now"}
              </button>
              <button
                className="primary-button"
                type="submit"
                disabled={isSavingRetention}
              >
                {isSavingRetention ? "Saving…" : "Save audit retention"}
              </button>
            </div>
          </form>
        </article>
      </MaintenanceCardGrid>

      {showBackupConfirmation && (
        <div
          className="drawer-backdrop confirm-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowBackupConfirmation(false);
            }
          }}
        >
          <section
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="backup-confirm-title"
            aria-describedby="backup-confirm-description"
          >
            <div className="confirm-icon" aria-hidden="true">
              ◫
            </div>
            <p className="eyebrow">Database protection</p>
            <h2 id="backup-confirm-title">Back up the database now?</h2>
            <p id="backup-confirm-description">
              OpenEDL will create and verify a consistent SQLite backup. After
              it succeeds, older OpenEDL backups beyond the configured
              retention count will be removed.
            </p>
            <div className="confirm-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setShowBackupConfirmation(false)}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                type="button"
                autoFocus
                onClick={() => void backupNow()}
              >
                Create database backup
              </button>
            </div>
          </section>
        </div>
      )}

      {showRestoreConfirmation && (
        <div
          className="drawer-backdrop confirm-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowRestoreConfirmation(false);
            }
          }}
        >
          <section
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="restore-confirm-title"
            aria-describedby="restore-confirm-description"
          >
            <div className="confirm-icon" aria-hidden="true">
              ↺
            </div>
            <p className="eyebrow">Database recovery</p>
            <h2 id="restore-confirm-title">Restore this database backup?</h2>
            <p id="restore-confirm-description">
              This replaces all current OpenEDL data and settings with the
              contents of <code>{selectedBackupFile}</code>. OpenEDL will first
              create a safety backup of the current database, verify the
              selected file, and reload after restoration. You may need to sign
              in again.
            </p>
            <div className="confirm-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setShowRestoreConfirmation(false)}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                type="button"
                autoFocus
                onClick={() => void restoreBackup()}
              >
                Restore database
              </button>
            </div>
          </section>
        </div>
      )}

      {showUploadRestoreConfirmation && uploadedBackupFile && (
        <div
          className="drawer-backdrop confirm-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowUploadRestoreConfirmation(false);
            }
          }}
        >
          <section
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="upload-restore-confirm-title"
            aria-describedby="upload-restore-confirm-description"
          >
            <div className="confirm-icon" aria-hidden="true">
              ↑
            </div>
            <p className="eyebrow">Database recovery</p>
            <h2 id="upload-restore-confirm-title">
              Upload and restore this backup?
            </h2>
            <p id="upload-restore-confirm-description">
              OpenEDL will upload and verify <code>{uploadedBackupFile.name}</code>{" "}
              ({formatBytes(uploadedBackupFile.size)}), retain it in the backup
              directory, and create a safety backup before replacing the live
              database. The page reloads afterward and you may need to sign in
              again.
            </p>
            <div className="confirm-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setShowUploadRestoreConfirmation(false)}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                type="button"
                autoFocus
                onClick={() => void restoreUploadedBackup()}
              >
                Upload and restore database
              </button>
            </div>
          </section>
        </div>
      )}

      {showVacuumConfirmation && (
        <div
          className="drawer-backdrop confirm-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowVacuumConfirmation(false);
            }
          }}
        >
          <section
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="vacuum-confirm-title"
            aria-describedby="vacuum-confirm-description"
          >
            <div className="confirm-icon" aria-hidden="true">
              ⌁
            </div>
            <p className="eyebrow">Database maintenance</p>
            <h2 id="vacuum-confirm-title">Run VACUUM now?</h2>
            <p id="vacuum-confirm-description">
              OpenEDL will rebuild the SQLite database to reclaim unused space.
              Refreshes and management writes may pause until it finishes, so
              make sure production data is backed up first.
            </p>
            <div className="confirm-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setShowVacuumConfirmation(false)}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                type="button"
                autoFocus
                onClick={() => void vacuum()}
              >
                Run database VACUUM
              </button>
            </div>
          </section>
        </div>
      )}

      {showRetentionConfirmation && (
        <div
          className="drawer-backdrop confirm-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowRetentionConfirmation(false);
            }
          }}
        >
          <section
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="retention-confirm-title"
            aria-describedby="retention-confirm-description"
          >
            <div className="confirm-icon" aria-hidden="true">
              ≋
            </div>
            <p className="eyebrow">Audit maintenance</p>
            <h2 id="retention-confirm-title">Delete expired audit now?</h2>
            <p id="retention-confirm-description">
              OpenEDL will permanently remove membership events and lifetime
              audit entries older than the configured retention period. This
              cannot be undone without restoring a database backup.
            </p>
            <div className="confirm-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setShowRetentionConfirmation(false)}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                type="button"
                autoFocus
                onClick={() => void runAuditRetentionNow()}
              >
                Delete expired audit
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
