"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

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
  vacuumSchedule: VacuumScheduleSettings;
  auditRetention: AuditRetentionSettings;
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
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: "never" | "success" | "failed";
  lastError: string | null;
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

export function MaintenanceSettings({ apiFetch, setNotice }: Props) {
  const [data, setData] = useState<MaintenanceData | null>(null);
  const [remoteLimit, setRemoteLimit] = useState(2);
  const [apiLimit, setApiLimit] = useState(20);
  const [vacuumSchedule, setVacuumSchedule] =
    useState<VacuumSchedule>("disabled");
  const [auditRetentionEnabled, setAuditRetentionEnabled] = useState(false);
  const [auditRetentionDays, setAuditRetentionDays] = useState(90);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isVacuuming, setIsVacuuming] = useState(false);
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);
  const [isSavingRetention, setIsSavingRetention] = useState(false);
  const [isRunningRetention, setIsRunningRetention] = useState(false);
  const [showVacuumConfirmation, setShowVacuumConfirmation] = useState(false);
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
    if (!showVacuumConfirmation && !showRetentionConfirmation) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowVacuumConfirmation(false);
        setShowRetentionConfirmation(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [showRetentionConfirmation, showVacuumConfirmation]);

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
        body: JSON.stringify({ vacuumSchedule }),
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
          : `Database VACUUM scheduled ${vacuumSchedule}.`,
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
            Tune feed download ceilings, control audit retention, and reclaim
            unused SQLite pages from the management portal.
          </p>
        </div>
      </section>

      {error && <p className="settings-error">{error}</p>}

      <section className="maintenance-grid">
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
          <form className="vacuum-schedule" onSubmit={saveVacuumSchedule}>
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
              <small>
                Next run: {dateLabel(data?.vacuumSchedule.nextRunAt ?? null)}
                {data?.vacuumSchedule.lastRunAt
                  ? ` · Last ${data.vacuumSchedule.lastStatus}: ${dateLabel(data.vacuumSchedule.lastRunAt)}`
                  : ""}
              </small>
              {data?.vacuumSchedule.lastError && (
                <small className="schedule-error">
                  Last error: {data.vacuumSchedule.lastError}
                </small>
              )}
            </div>
            <button
              className="secondary-button"
              type="submit"
              disabled={isSavingSchedule}
            >
              {isSavingSchedule ? "Saving…" : "Save VACUUM schedule"}
            </button>
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
      </section>

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
