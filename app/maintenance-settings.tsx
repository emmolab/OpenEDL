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

export function MaintenanceSettings({ apiFetch, setNotice }: Props) {
  const [data, setData] = useState<MaintenanceData | null>(null);
  const [remoteLimit, setRemoteLimit] = useState(2);
  const [apiLimit, setApiLimit] = useState(20);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isVacuuming, setIsVacuuming] = useState(false);

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
    const confirmed = window.confirm(
      "Compact the OpenEDL database now? Refreshes and management writes may pause while VACUUM runs. Back up production data first.",
    );
    if (!confirmed) return;
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
            Tune feed download ceilings and reclaim unused SQLite pages from
            the management portal.
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
              onClick={vacuum}
              disabled={isVacuuming || !data || !data.database.available}
            >
              {isVacuuming ? "Compacting…" : "Run database VACUUM"}
            </button>
          </div>
        </article>
      </section>
    </>
  );
}
