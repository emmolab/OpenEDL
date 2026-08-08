"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type AuditData = {
  lists: Array<{
    id: number;
    name: string;
    slug: string;
    type: "ip" | "domain" | "url";
  }>;
  active: Array<{
    listId: number;
    listName: string;
    listType: "ip" | "domain" | "url";
    entry: string;
    sourceNames: string[];
  }>;
  activeCount: number;
  allTimeBlockedCount: number;
  events: Array<{
    id: number;
    list_id: number;
    list_name: string;
    list_type: "ip" | "domain" | "url";
    entry: string;
    action: "blocked" | "unblocked";
    reason: string;
    sourceNames: string[];
    occurred_at: string;
  }>;
  note: string;
};

type Props = {
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  canUnblock: boolean;
  setNotice: (message: string) => void;
};

function dateLabel(value: string) {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime())
    ? "Unknown"
    : new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

function reasonLabel(value: string) {
  return value.replaceAll("_", " ");
}

function displayNumber(value: number) {
  return new Intl.NumberFormat("en").format(value);
}

export function BlockAudit({ apiFetch, canUnblock, setNotice }: Props) {
  const [data, setData] = useState<AuditData | null>(null);
  const [query, setQuery] = useState("");
  const [selectedList, setSelectedList] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [busyEntry, setBusyEntry] = useState("");

  const load = useCallback(
    async (nextQuery: string, nextList: string) => {
      setIsLoading(true);
      setError("");
      try {
        const params = new URLSearchParams();
        if (nextQuery.trim()) params.set("q", nextQuery.trim());
        if (nextList) params.set("listId", nextList);
        const response = await apiFetch(`/api/audit/blocks?${params}`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as AuditData & { error?: string };
        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to load block audit.");
        }
        setData(payload);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load block audit.",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [apiFetch],
  );

  useEffect(() => {
    queueMicrotask(() => void load("", ""));
  }, [load]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load(query, selectedList);
  }

  async function unblock(listId: number, entry: string) {
    if (
      !window.confirm(
        `Exclude ${entry} from this published list? Downstream security tools will stop receiving it on their next pull.`,
      )
    ) {
      return;
    }
    setBusyEntry(`${listId}:${entry}`);
    setError("");
    try {
      const response = await apiFetch("/api/audit/blocks", {
        method: "POST",
        body: JSON.stringify({ action: "unblock", listId, entry }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to unblock entry.");
      }
      setNotice(`${entry} added to the list's manual exclusions.`);
      await load(query, selectedList);
    } catch (unblockError) {
      setError(
        unblockError instanceof Error
          ? unblockError.message
          : "Unable to unblock entry.",
      );
    } finally {
      setBusyEntry("");
    }
  }

  return (
    <>
      <section className="page-heading users-heading">
        <div>
          <p className="eyebrow">Published-list change history</p>
          <h1>
            Block
            <br />
            <em>audit.</em>
          </h1>
          <p className="heading-copy">
            Search IP, domain, and URL entries, see which upstream sources
            contributed each block, and place active entries into managed
            exclusions.
          </p>
        </div>
      </section>

      {error && <p className="settings-error">{error}</p>}

      <aside className="audit-note">{data?.note ?? "Loading audit scope…"}</aside>

      <section className="audit-summary" aria-label="Block totals">
        <article>
          <span>Unique entries in retained audit</span>
          <strong>{displayNumber(data?.allTimeBlockedCount ?? 0)}</strong>
          <small>Lifetime total while retention allows</small>
        </article>
        <article>
          <span>Currently published</span>
          <strong>{displayNumber(data?.activeCount ?? 0)}</strong>
          <small>For the selected published lists</small>
        </article>
      </section>

      <form className="audit-filters" onSubmit={search}>
        <div className="field">
          <label htmlFor="audit-query">IP, domain, or URL entry</label>
          <input
            id="audit-query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="203.0.113.8 or malware.example"
          />
        </div>
        <div className="field">
          <label htmlFor="audit-list">Published list</label>
          <select
            id="audit-list"
            value={selectedList}
            onChange={(event) => setSelectedList(event.target.value)}
          >
            <option value="">All lists</option>
            {data?.lists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name} ({list.type.toUpperCase()})
              </option>
            ))}
          </select>
        </div>
        <button className="primary-button" type="submit" disabled={isLoading}>
          {isLoading ? "Searching…" : "Search audit"}
        </button>
      </form>

      <section className="audit-grid">
        <article className="panel audit-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Current EDL membership</p>
              <h2>Active blocks</h2>
            </div>
            <span className="format-pill">{data?.activeCount ?? 0}</span>
          </div>
          <div className="audit-table" role="table" aria-label="Active blocks">
            {data?.active.map((row) => (
              <div className="audit-row" role="row" key={`${row.listId}:${row.entry}`}>
                <div>
                  <code>{row.entry}</code>
                  <span>
                    {row.listName} · {row.listType.toUpperCase()}
                  </span>
                  <small className="audit-sources">
                    Upstream: {row.sourceNames.join(", ") || "Source unavailable"}
                  </small>
                </div>
                {canUnblock && (
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={busyEntry === `${row.listId}:${row.entry}`}
                    onClick={() => void unblock(row.listId, row.entry)}
                  >
                    {busyEntry === `${row.listId}:${row.entry}`
                      ? "Excluding…"
                      : "Unblock"}
                  </button>
                )}
              </div>
            ))}
            {!isLoading && data?.active.length === 0 && (
              <div className="users-empty">No matching active blocks.</div>
            )}
          </div>
        </article>

        <article className="panel audit-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Recorded membership changes</p>
              <h2>Recent activity</h2>
            </div>
          </div>
          <div className="audit-table" role="table" aria-label="Block history">
            {data?.events.map((event) => (
              <div className="audit-row audit-event" role="row" key={event.id}>
                <div>
                  <code>{event.entry}</code>
                  <span>
                    {event.list_name} ({event.list_type.toUpperCase()}) ·{" "}
                    {dateLabel(event.occurred_at)} ·{" "}
                    {reasonLabel(event.reason)}
                  </span>
                  <small className="audit-sources">
                    Upstream: {event.sourceNames.join(", ") || "Source unavailable"}
                  </small>
                </div>
                <span className={`audit-action ${event.action}`}>
                  {event.action}
                </span>
              </div>
            ))}
            {!isLoading && data?.events.length === 0 && (
              <div className="users-empty">
                No changes recorded yet. New source and list changes will appear here.
              </div>
            )}
          </div>
        </article>
      </section>
    </>
  );
}
