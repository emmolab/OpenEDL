"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AppearanceSettings } from "./appearance-settings";
import { InitialSetup } from "./initial-setup";
import { ProfileSettings } from "./profile-settings";
import { SsoSettings } from "./sso-settings";
import { UserManagement } from "./user-management";

type Source = {
  id: number;
  name: string;
  url: string | null;
  kind: "remote" | "manual";
  type: "ip" | "domain" | "url";
  format: "auto" | "text" | "json" | "csv";
  manual_entries?: string;
  enabled: boolean;
  entry_count: number;
  status: "pending" | "healthy" | "degraded" | "disabled";
  last_checked_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  refresh_interval_minutes: number;
  next_refresh_at: string | null;
  role: "include" | "exclude";
};

type PublishedList = {
  id: number;
  name: string;
  slug: string;
  type: "ip" | "domain" | "url";
  description: string;
  updated_at: string;
  sources: Source[];
  entries: string[];
  entryCount: number;
  excludedCount: number;
  duplicateCount: number;
  healthySources: number;
};

type DashboardResponse = {
  lists: PublishedList[];
};

type SourceForm = {
  name: string;
  kind: "remote" | "manual";
  url: string;
  manualEntries: string;
  format: "auto" | "text" | "json" | "csv";
  role: "include" | "exclude";
  refreshIntervalMinutes: number;
};

type AuthProvider = {
  id: string;
  name: string;
};

type ManagementUser = {
  id: number | null;
  name: string;
  email: string;
  picture: string | null;
  provider: string;
  role: "admin" | "member";
};

type AppTheme = "signal" | "ocean" | "ember" | "midnight";

const emptyForm: SourceForm = {
  name: "",
  kind: "remote",
  url: "",
  manualEntries: "",
  format: "auto",
  role: "include",
  refreshIntervalMinutes: 60,
};

const scheduleOptions = [
  { value: 5, label: "Every 5 minutes" },
  { value: 15, label: "Every 15 minutes" },
  { value: 30, label: "Every 30 minutes" },
  { value: 60, label: "Every hour" },
  { value: 360, label: "Every 6 hours" },
  { value: 720, label: "Every 12 hours" },
  { value: 1440, label: "Daily" },
  { value: 10_080, label: "Weekly" },
] as const;

function scheduleLabel(value: number) {
  return (
    scheduleOptions.find((option) => option.value === value)?.label ??
    `every ${value} minutes`
  ).toLowerCase();
}

function initials(value: string) {
  return value
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function relativeTime(value: string | null) {
  if (!value) return "Never";
  const normalizedValue = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(
    value,
  )
    ? `${value.replace(" ", "T")}Z`
    : value;
  const date = new Date(normalizedValue);
  if (Number.isNaN(date.getTime())) return "Unknown";

  const difference = Math.round((Date.now() - date.getTime()) / 1000);
  const future = difference < 0;
  const seconds = Math.abs(difference);
  if (seconds < 60) return "Just now";
  const valueWithUnit =
    seconds < 3600
      ? `${Math.floor(seconds / 60)}m`
      : seconds < 86400
        ? `${Math.floor(seconds / 3600)}h`
        : `${Math.floor(seconds / 86400)}d`;
  return future ? `in ${valueWithUnit}` : `${valueWithUnit} ago`;
}

function displayNumber(value: number) {
  return new Intl.NumberFormat("en").format(value);
}

export function Dashboard() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [adminToken, setAdminToken] = useState(() =>
    typeof window === "undefined"
      ? ""
      : (window.sessionStorage.getItem("openedl-admin-token") ?? ""),
  );
  const [tokenDraft, setTokenDraft] = useState(() =>
    typeof window === "undefined"
      ? ""
      : (window.sessionStorage.getItem("openedl-admin-token") ?? ""),
  );
  const [needsToken, setNeedsToken] = useState(false);
  const [providers, setProviders] = useState<AuthProvider[]>([]);
  const [adminTokenEnabled, setAdminTokenEnabled] = useState(false);
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null);
  const [currentUser, setCurrentUser] = useState<ManagementUser | null>(null);
  const [appTheme, setAppTheme] = useState<AppTheme>(() => {
    if (typeof window === "undefined") return "signal";
    const saved = window.localStorage.getItem("openedl-app-theme");
    return saved === "ocean" || saved === "ember" || saved === "midnight"
      ? saved
      : "signal";
  });
  const [endpointBaseUrl, setEndpointBaseUrl] = useState("");
  const [localEmail, setLocalEmail] = useState("");
  const [localPassword, setLocalPassword] = useState("");
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [busySource, setBusySource] = useState<number | null>(null);
  const [showAddSource, setShowAddSource] = useState(false);
  const [editingManual, setEditingManual] = useState<Source | null>(null);
  const [editingList, setEditingList] = useState<PublishedList | null>(null);
  const [manualName, setManualName] = useState("");
  const [manualDraft, setManualDraft] = useState("");
  const [listName, setListName] = useState("");
  const [listSlug, setListSlug] = useState("");
  const [listDescription, setListDescription] = useState("");
  const [form, setForm] = useState<SourceForm>(emptyForm);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState(() =>
    typeof window === "undefined"
      ? ""
      : (new URLSearchParams(window.location.search).get("auth_error") ?? ""),
  );
  const [origin] = useState(() =>
    typeof window === "undefined" ? "" : window.location.origin,
  );
  const [activeView, setActiveView] = useState<
    | "overview"
    | "sources"
    | "published"
    | "users"
    | "sso"
    | "appearance"
    | "profile"
  >("overview");

  const apiFetch = useCallback(
    (path: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (adminToken) headers.set("authorization", `Bearer ${adminToken}`);
      if (init?.body) headers.set("content-type", "application/json");
      return fetch(path, { ...init, headers });
    },
    [adminToken],
  );

  const loadDashboard = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await apiFetch("/api/dashboard", { cache: "no-store" });
      if (response.status === 401) {
        setNeedsToken(true);
        setData(null);
        return;
      }
      const payload = (await response.json()) as
        | DashboardResponse
        | { error: string };
      if (!response.ok || "error" in payload) {
        throw new Error(
          "error" in payload ? payload.error : "Unable to load dashboard.",
        );
      }
      setNeedsToken(false);
      setData(payload);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Unable to load dashboard.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadDashboard();
      void Promise.all([
        fetch("/api/auth/providers")
          .then(
            async (response) =>
              (await response.json()) as {
                providers?: AuthProvider[];
                adminTokenEnabled?: boolean;
              },
          )
          .then((payload) => {
            setProviders(payload.providers ?? []);
            setAdminTokenEnabled(Boolean(payload.adminTokenEnabled));
          }),
        fetch("/api/setup", { cache: "no-store" })
          .then(async (response) => {
            const payload = (await response.json()) as {
              required?: boolean;
              error?: string;
            };
            if (!response.ok) {
              throw new Error(
                payload.error ?? "Unable to inspect initial setup.",
              );
            }
            return payload;
          })
          .then((payload) => setSetupRequired(Boolean(payload.required)))
          .catch((error) => {
            setNotice(
              error instanceof Error
                ? error.message
                : "Unable to inspect initial setup.",
            );
            setSetupRequired(false);
          }),
        apiFetch("/api/auth/session")
          .then(
            async (response) =>
              (await response.json()) as {
                user?: ManagementUser | null;
              },
          )
          .then((payload) => setCurrentUser(payload.user ?? null)),
        fetch("/api/settings/appearance", { cache: "no-store" })
          .then(
            async (response) =>
              (await response.json()) as {
                theme?: AppTheme;
                endpointBaseUrl?: string;
              },
          )
          .then((payload) => {
            if (payload.theme) setAppTheme(payload.theme);
            if (payload.endpointBaseUrl !== undefined) {
              setEndpointBaseUrl(payload.endpointBaseUrl);
            }
          }),
      ]);
    });
  }, [apiFetch, loadDashboard]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 4200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    document.documentElement.dataset.theme = appTheme;
    window.localStorage.setItem("openedl-app-theme", appTheme);
  }, [appTheme]);

  const list = data?.lists[0] ?? null;
  const endpoint = list
    ? `${endpointBaseUrl || origin}/edl/${list.slug}`
    : "";
  const activeSources =
    list?.sources.filter((source) => source.enabled).length ?? 0;
  const sourceRows = useMemo(() => list?.sources ?? [], [list]);
  const latestSuccess = sourceRows
    .map((source) => source.last_success_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);

  async function copyEndpoint() {
    if (!endpoint) return;
    await navigator.clipboard.writeText(endpoint);
    setNotice("EDL endpoint copied.");
  }

  async function refreshList() {
    if (!list) return;
    setIsRefreshing(true);
    try {
      const response = await apiFetch(`/api/lists/${list.id}/refresh`, {
        method: "POST",
      });
      const payload = (await response.json()) as {
        failed?: number;
        error?: string;
      };
      if (!response.ok && response.status !== 207) {
        throw new Error(payload.error ?? "Refresh failed.");
      }
      setNotice(
        payload.failed
          ? `Refresh complete with ${payload.failed} upstream failure${
              payload.failed === 1 ? "" : "s"
            }.`
          : "All sources refreshed successfully.",
      );
      await loadDashboard();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Refresh failed.");
    } finally {
      setIsRefreshing(false);
    }
  }

  async function refreshOne(sourceId: number) {
    setBusySource(sourceId);
    try {
      const response = await apiFetch(`/api/sources/${sourceId}/refresh`, {
        method: "POST",
      });
      const payload = (await response.json()) as {
        error?: string;
        entryCount?: number;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Source refresh failed.");
      }
      setNotice(
        `Source refreshed · ${displayNumber(payload.entryCount ?? 0)} entries.`,
      );
      await loadDashboard();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Source refresh failed.",
      );
      await loadDashboard();
    } finally {
      setBusySource(null);
    }
  }

  async function removeSource(source: Source) {
    const confirmed = window.confirm(
      `Remove “${source.name}” from this list? The cached copy will also be deleted.`,
    );
    if (!confirmed) return;

    setBusySource(source.id);
    try {
      const response = await apiFetch(`/api/sources/${source.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Unable to remove source.");
      }
      setNotice("Source removed.");
      await loadDashboard();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Unable to remove source.",
      );
    } finally {
      setBusySource(null);
    }
  }

  async function changeSchedule(sourceId: number, interval: number) {
    setBusySource(sourceId);
    try {
      const response = await apiFetch(`/api/sources/${sourceId}`, {
        method: "PATCH",
        body: JSON.stringify({ refreshIntervalMinutes: interval }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to update schedule.");
      }
      setNotice(`Schedule updated to ${scheduleLabel(interval)}.`);
      await loadDashboard();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Unable to update schedule.",
      );
    } finally {
      setBusySource(null);
    }
  }

  function editManualSource(source: Source) {
    setEditingManual(source);
    setManualName(source.name);
    setManualDraft(source.manual_entries ?? "");
    setFormError("");
  }

  async function saveManualSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingManual) return;
    setBusySource(editingManual.id);
    setFormError("");
    try {
      const response = await apiFetch(`/api/sources/${editingManual.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: manualName,
          manualEntries: manualDraft,
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        entryCount?: number;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to update manual source.");
      }
      setEditingManual(null);
      setNotice(
        `Manual source updated · ${displayNumber(payload.entryCount ?? 0)} entries.`,
      );
      await loadDashboard();
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "Unable to update manual source.",
      );
    } finally {
      setBusySource(null);
    }
  }

  function editPublishedList(listToEdit: PublishedList) {
    setEditingList(listToEdit);
    setListName(listToEdit.name);
    setListSlug(listToEdit.slug);
    setListDescription(listToEdit.description);
    setFormError("");
  }

  async function savePublishedList(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingList) return;
    setFormError("");
    try {
      const response = await apiFetch(`/api/lists/${editingList.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: listName,
          slug: listSlug,
          description: listDescription,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to update published list.");
      }
      setEditingList(null);
      setNotice("Published list and endpoint URL updated.");
      await loadDashboard();
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "Unable to update published list.",
      );
    }
  }

  async function submitSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!list) return;
    setFormError("");

    try {
      const response = await apiFetch("/api/sources", {
        method: "POST",
        body: JSON.stringify({
          listId: list.id,
          type: list.type,
          ...form,
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        refresh?: { ok?: boolean; error?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to add source.");
      }

      setForm(emptyForm);
      setShowAddSource(false);
      setNotice(
        payload.refresh?.ok === false
          ? "Source added. Its first refresh failed, so it is marked degraded."
          : "Source added and validated.",
      );
      await loadDashboard();
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Unable to add source.",
      );
    }
  }

  function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    window.sessionStorage.setItem("openedl-admin-token", tokenDraft);
    setAdminToken(tokenDraft);
    setNeedsToken(false);
  }

  async function localSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSigningIn(true);
    setNotice("");
    try {
      const response = await fetch("/api/auth/local", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: localEmail,
          password: localPassword,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to sign in.");
      }
      const sessionResponse = await fetch("/api/auth/session", {
        cache: "no-store",
      });
      const session = (await sessionResponse.json()) as {
        user?: ManagementUser | null;
      };
      setCurrentUser(session.user ?? null);
      setLocalPassword("");
      setNeedsToken(false);
      await loadDashboard();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to sign in.");
    } finally {
      setIsSigningIn(false);
    }
  }

  async function completeInitialSetup() {
    const sessionResponse = await fetch("/api/auth/session", {
      cache: "no-store",
    });
    const session = (await sessionResponse.json()) as {
      user?: ManagementUser | null;
    };
    setCurrentUser(session.user ?? null);
    setSetupRequired(false);
    setNeedsToken(false);
    await loadDashboard();
  }

  async function signOut() {
    await apiFetch("/api/auth/logout", { method: "POST" });
    window.sessionStorage.removeItem("openedl-admin-token");
    setAdminToken("");
    setTokenDraft("");
    setCurrentUser(null);
    setData(null);
    setNeedsToken(true);
  }

  if (setupRequired === null) {
    return (
      <main className="auth-shell">
        <section className="auth-card setup-loading" aria-live="polite">
          <div className="brand-mark" aria-hidden="true">
            OE
          </div>
          <div className="loading-orbit" aria-hidden="true" />
          <p>Preparing secure access…</p>
        </section>
      </main>
    );
  }

  if (setupRequired) {
    return <InitialSetup onComplete={completeInitialSetup} />;
  }

  if (needsToken) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <div className="brand-mark" aria-hidden="true">
            OE
          </div>
          <p className="eyebrow">OpenEDL control plane</p>
          <h1>Secure management access</h1>
          <p>
            Sign in with a local account or your organization&apos;s identity
            provider. Public EDL endpoints remain available without a
            management session.
          </p>
          {notice && <p className="form-error">{notice}</p>}
          <form className="local-auth-form" onSubmit={localSignIn}>
            <label htmlFor="local-email">Email address</label>
            <input
              id="local-email"
              type="email"
              value={localEmail}
              onChange={(event) => setLocalEmail(event.target.value)}
              autoComplete="username"
              required
            />
            <label htmlFor="local-password">Password</label>
            <input
              id="local-password"
              type="password"
              value={localPassword}
              onChange={(event) => setLocalPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
            <button
              className="primary-button"
              type="submit"
              disabled={isSigningIn}
            >
              {isSigningIn ? "Signing in…" : "Sign in"}
            </button>
          </form>
          {providers.length > 0 && (
            <>
              <div className="auth-divider">
                <span>or continue with SSO</span>
              </div>
              <div className="sso-options">
                {providers.map((provider) => (
                  <a
                    href={`/api/auth/login/${provider.id}?return_to=/`}
                    key={provider.id}
                  >
                    <span aria-hidden="true">
                      {provider.id === "microsoft"
                        ? "M"
                        : provider.id === "google"
                          ? "G"
                          : "↗"}
                    </span>
                    Continue with {provider.name}
                  </a>
                ))}
              </div>
            </>
          )}
          {adminTokenEnabled && (
            <div className="auth-divider">
              <span>or use recovery access</span>
            </div>
          )}
          {adminTokenEnabled && (
            <form onSubmit={unlock}>
              <label htmlFor="admin-token">Admin token</label>
              <input
                id="admin-token"
                type="password"
                value={tokenDraft}
                onChange={(event) => setTokenDraft(event.target.value)}
                autoComplete="current-password"
                required
              />
              <button className="primary-button" type="submit">
                Use admin token
              </button>
            </form>
          )}
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            OE
          </div>
          <div>
            <strong>OpenEDL</strong>
            <span>Signal control</span>
          </div>
        </div>

        <nav aria-label="Primary navigation">
          <button
            className={activeView === "overview" ? "active" : ""}
            onClick={() => setActiveView("overview")}
          >
            <span aria-hidden="true">⌂</span>
            Overview
          </button>
          <button
            className={activeView === "sources" ? "active" : ""}
            onClick={() => setActiveView("sources")}
          >
            <span aria-hidden="true">⇣</span>
            Sources
            <b>{sourceRows.length}</b>
          </button>
          <button
            className={activeView === "published" ? "active" : ""}
            onClick={() => setActiveView("published")}
          >
            <span aria-hidden="true">↗</span>
            Published lists
            <b>{data?.lists.length ?? 0}</b>
          </button>
          {currentUser?.role === "admin" && (
            <button
              className={activeView === "users" ? "active" : ""}
              onClick={() => setActiveView("users")}
            >
              <span aria-hidden="true">◎</span>
              Users
            </button>
          )}
          {currentUser?.role === "admin" && (
            <button
              className={activeView === "sso" ? "active" : ""}
              onClick={() => setActiveView("sso")}
            >
              <span aria-hidden="true">⚙</span>
              SSO settings
            </button>
          )}
          {currentUser?.role === "admin" && (
            <button
              className={activeView === "appearance" ? "active" : ""}
              onClick={() => setActiveView("appearance")}
            >
              <span aria-hidden="true">◐</span>
              Appearance
            </button>
          )}
          <button
            className={activeView === "profile" ? "active" : ""}
            onClick={() => setActiveView("profile")}
          >
            <span aria-hidden="true">◉</span>
            Profile
          </button>
        </nav>

        <div className="sidebar-foot">
          <div className="health-dot" />
          <div>
            <strong>System operational</strong>
            <span>Cached delivery enabled</span>
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <span className="environment">
              <i />
              production
            </span>
          </div>
          <div className="topbar-actions">
            <a href="/edl/perimeter-blocklist" target="_blank">
              View raw feed
            </a>
            <button
              className="icon-button"
              type="button"
              aria-label="Sign out"
              title="Sign out"
              onClick={signOut}
            >
              ↪
            </button>
            <button
              type="button"
              className="avatar"
              aria-label={currentUser?.name ?? "Administrator"}
              title={currentUser?.email}
              onClick={() => setActiveView("profile")}
            >
              {initials(currentUser?.name ?? "Administrator")}
            </button>
          </div>
        </header>

        <div className="content">
          {isLoading && !list ? (
            <section className="loading-panel" aria-live="polite">
              <div className="loading-orbit" />
              <p>Loading control plane…</p>
            </section>
          ) : activeView === "users" && currentUser?.role === "admin" ? (
            <UserManagement
              apiFetch={apiFetch}
              currentUserId={currentUser.id}
              setNotice={setNotice}
            />
          ) : activeView === "sso" && currentUser?.role === "admin" ? (
            <SsoSettings apiFetch={apiFetch} setNotice={setNotice} />
          ) : activeView === "appearance" &&
            currentUser?.role === "admin" ? (
            <AppearanceSettings
              apiFetch={apiFetch}
              theme={appTheme}
              endpointBaseUrl={endpointBaseUrl}
              onThemeChange={setAppTheme}
              onEndpointBaseUrlChange={setEndpointBaseUrl}
              setNotice={setNotice}
            />
          ) : activeView === "profile" && currentUser ? (
            <ProfileSettings
              apiFetch={apiFetch}
              user={currentUser}
              onUpdated={setCurrentUser}
              setNotice={setNotice}
            />
          ) : (
            <>
              <section className="page-heading">
                <div>
                  <p className="eyebrow">Unified threat intelligence</p>
                  <h1>
                    Threat feed,
                    <br />
                    <em>distilled.</em>
                  </h1>
                  <p className="heading-copy">
                    Aggregate noisy upstream feeds into one clean, reliable
                    endpoint your security stack can trust.
                  </p>
                </div>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => setShowAddSource(true)}
                >
                  <span aria-hidden="true">+</span>
                  Add source
                </button>
              </section>

              {list && (
                <>
                  <section className="endpoint-card">
                    <div className="endpoint-icon" aria-hidden="true">
                      ↗
                    </div>
                    <div className="endpoint-main">
                      <div>
                        <span>Published endpoint</span>
                        <strong>{list.name}</strong>
                      </div>
                      <code>{endpoint}</code>
                    </div>
                    <div className="endpoint-actions">
                      <span className="live-badge">
                        <i />
                        live
                      </span>
                      <button
                        className="copy-button"
                        type="button"
                        onClick={copyEndpoint}
                      >
                        Copy URL
                      </button>
                    </div>
                  </section>

                  <section className="metrics" aria-label="List metrics">
                    <article>
                      <span>Active sources</span>
                      <strong>{activeSources}</strong>
                      <small>
                        <i className="good" />
                        {list.healthySources} healthy
                      </small>
                    </article>
                    <article>
                      <span>Unique entries</span>
                      <strong>{displayNumber(list.entryCount)}</strong>
                      <small>
                        {displayNumber(list.duplicateCount)} duplicates removed
                      </small>
                    </article>
                    <article>
                      <span>Exclusions applied</span>
                      <strong>{displayNumber(list.excludedCount)}</strong>
                      <small>after source aggregation</small>
                    </article>
                    <article>
                      <span>Last good refresh</span>
                      <strong className="time-value">
                        {relativeTime(latestSuccess ?? null)}
                      </strong>
                      <small>stale copy retained on failure</small>
                    </article>
                  </section>

                  {activeView === "published" ? (
                    <PublishedView
                      list={list}
                      endpoint={endpoint}
                      copyEndpoint={copyEndpoint}
                      editList={() => editPublishedList(list)}
                    />
                  ) : (
                    <section className="dashboard-grid">
                      <div className="panel sources-panel">
                        <div className="panel-heading">
                          <div>
                            <p className="eyebrow">
                              {activeView === "sources"
                                ? "Source inventory"
                                : "Pipeline"}
                            </p>
                            <h2>Upstream sources</h2>
                          </div>
                          <button
                            className="secondary-button"
                            type="button"
                            onClick={refreshList}
                            disabled={isRefreshing}
                          >
                            <span
                              className={isRefreshing ? "spin" : ""}
                              aria-hidden="true"
                            >
                              ↻
                            </span>
                            {isRefreshing ? "Refreshing" : "Refresh all"}
                          </button>
                        </div>

                        <div className="source-list">
                          {sourceRows.map((source) => (
                            <article className="source-row" key={source.id}>
                              <div
                                className={`source-symbol ${source.role}`}
                                aria-hidden="true"
                              >
                                {source.role === "exclude" ? "−" : "+"}
                              </div>
                              <div className="source-name">
                                <strong>{source.name}</strong>
                                <span title={source.url ?? "Manual entries"}>
                                  {source.kind === "manual"
                                    ? "Manual entries"
                                    : source.url}
                                </span>
                              </div>
                              <div className="source-count">
                                <strong>
                                  {displayNumber(source.entry_count)}
                                </strong>
                                <span>entries</span>
                              </div>
                              <label className="source-schedule">
                                <span className="sr-only">
                                  Refresh schedule for {source.name}
                                </span>
                                <select
                                  value={source.refresh_interval_minutes}
                                  onChange={(event) =>
                                    changeSchedule(
                                      source.id,
                                      Number(event.target.value),
                                    )
                                  }
                                  disabled={
                                    source.kind === "manual" ||
                                    busySource === source.id
                                  }
                                >
                                  {scheduleOptions.map((option) => (
                                    <option
                                      value={option.value}
                                      key={option.value}
                                    >
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                                <small>
                                  {source.kind === "manual"
                                    ? "manual"
                                    : `next ${relativeTime(source.next_refresh_at)}`}
                                </small>
                              </label>
                              <div className={`status ${source.status}`}>
                                <i />
                                {source.status}
                              </div>
                              <div className="source-time">
                                <span>
                                  {relativeTime(source.last_checked_at)}
                                </span>
                                <small>{source.role}</small>
                              </div>
                              <div className="row-actions">
                                <button
                                  type="button"
                                  aria-label={`Refresh ${source.name}`}
                                  title="Refresh source"
                                  onClick={() => refreshOne(source.id)}
                                  disabled={busySource === source.id}
                                >
                                  <span
                                    className={
                                      busySource === source.id ? "spin" : ""
                                    }
                                  >
                                    ↻
                                  </span>
                                </button>
                                {source.kind === "manual" && (
                                  <button
                                    type="button"
                                    aria-label={`Edit ${source.name}`}
                                    title="Edit manual source"
                                    onClick={() => editManualSource(source)}
                                    disabled={busySource === source.id}
                                  >
                                    ✎
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="danger-action"
                                  aria-label={`Remove ${source.name}`}
                                  title="Remove source"
                                  onClick={() => removeSource(source)}
                                  disabled={busySource === source.id}
                                >
                                  ×
                                </button>
                              </div>
                              {source.last_error && (
                                <p className="source-error">
                                  {source.last_error}
                                </p>
                              )}
                            </article>
                          ))}
                          <button
                            type="button"
                            className="add-row"
                            onClick={() => setShowAddSource(true)}
                          >
                            <span>+</span>
                            Add another source
                          </button>
                        </div>
                      </div>

                      <aside className="panel preview-panel">
                        <div className="panel-heading">
                          <div>
                            <p className="eyebrow">Output sample</p>
                            <h2>Live preview</h2>
                          </div>
                          <span className="format-pill">
                            {list.type.toUpperCase()}
                          </span>
                        </div>
                        <div className="code-preview">
                          <div className="code-toolbar">
                            <span />
                            <span />
                            <span />
                            <small>plain text · one entry per line</small>
                          </div>
                          <ol>
                            {list.entries.slice(0, 8).map((entry) => (
                              <li key={entry}>
                                <code>{entry}</code>
                              </li>
                            ))}
                          </ol>
                          {list.entries.length > 8 && (
                            <div className="code-fade">
                              + {displayNumber(list.entries.length - 8)} more
                            </div>
                          )}
                        </div>
                        <div className="preview-summary">
                          <div>
                            <span>Sources</span>
                            <strong>{activeSources}</strong>
                          </div>
                          <div>
                            <span>Unique</span>
                            <strong>{displayNumber(list.entryCount)}</strong>
                          </div>
                          <div>
                            <span>Excluded</span>
                            <strong>{displayNumber(list.excludedCount)}</strong>
                          </div>
                        </div>
                      </aside>
                    </section>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </main>

      {showAddSource && list && (
        <div
          className="drawer-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowAddSource(false);
          }}
        >
          <aside
            className="source-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="source-drawer-title"
          >
            <div className="drawer-heading">
              <div>
                <p className="eyebrow">Connect intelligence</p>
                <h2 id="source-drawer-title">Add a source</h2>
              </div>
              <button
                type="button"
                aria-label="Close source form"
                onClick={() => setShowAddSource(false)}
              >
                ×
              </button>
            </div>

            <form onSubmit={submitSource}>
              <div className="field">
                <label htmlFor="source-name">Source name</label>
                <input
                  id="source-name"
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                  placeholder="e.g. Emerging Threats Block IPs"
                  required
                  autoFocus
                />
              </div>

              <div className="segmented">
                <button
                  type="button"
                  className={form.kind === "remote" ? "active" : ""}
                  onClick={() => setForm({ ...form, kind: "remote" })}
                >
                  Remote URL
                </button>
                <button
                  type="button"
                  className={form.kind === "manual" ? "active" : ""}
                  onClick={() => setForm({ ...form, kind: "manual" })}
                >
                  Manual entries
                </button>
              </div>

              {form.kind === "remote" ? (
                <div className="field">
                  <label htmlFor="source-url">Source URL</label>
                  <input
                    id="source-url"
                    type="url"
                    value={form.url}
                    onChange={(event) =>
                      setForm({ ...form, url: event.target.value })
                    }
                    placeholder="https://example.com/blocklist.txt"
                    required
                  />
                  <small>HTTP and HTTPS only. Private networks are blocked.</small>
                </div>
              ) : (
                <div className="field">
                  <label htmlFor="manual-entries">Entries</label>
                  <textarea
                    id="manual-entries"
                    value={form.manualEntries}
                    onChange={(event) =>
                      setForm({ ...form, manualEntries: event.target.value })
                    }
                    placeholder={"203.0.113.40\n198.51.100.0/24"}
                    rows={7}
                    required
                  />
                  <small>One {list.type.toUpperCase()} entry per line.</small>
                </div>
              )}

              <div className="form-grid">
                <div className="field">
                  <label htmlFor="source-role">Rule</label>
                  <select
                    id="source-role"
                    value={form.role}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        role: event.target.value as SourceForm["role"],
                      })
                    }
                  >
                    <option value="include">Include entries</option>
                    <option value="exclude">Exclude entries</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="source-format">Format</label>
                  <select
                    id="source-format"
                    value={form.format}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        format: event.target.value as SourceForm["format"],
                      })
                    }
                  >
                    <option value="auto">Auto detect</option>
                    <option value="text">Plain text</option>
                    <option value="csv">CSV</option>
                    <option value="json">JSON values</option>
                  </select>
                </div>
              </div>

              {form.kind === "remote" && (
                <div className="field">
                  <label htmlFor="refresh-schedule">Refresh schedule</label>
                  <select
                    id="refresh-schedule"
                    value={form.refreshIntervalMinutes}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        refreshIntervalMinutes: Number(event.target.value),
                      })
                    }
                  >
                    {scheduleOptions.map((option) => (
                      <option value={option.value} key={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <small>
                    A five-minute scheduler refreshes sources only when due.
                  </small>
                </div>
              )}

              <div className="type-lock">
                <span>Output type</span>
                <strong>{list.type.toUpperCase()} list</strong>
                <small>
                  A published EDL cannot mix IP, domain, and URL entries.
                </small>
              </div>

              {formError && <p className="form-error">{formError}</p>}

              <div className="drawer-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setShowAddSource(false)}
                >
                  Cancel
                </button>
                <button className="primary-button" type="submit">
                  Add & validate
                </button>
              </div>
            </form>
          </aside>
        </div>
      )}

      {editingManual && (
        <div
          className="drawer-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setEditingManual(null);
          }}
        >
          <aside
            className="source-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="manual-editor-title"
          >
            <div className="drawer-heading">
              <div>
                <p className="eyebrow">Manual intelligence</p>
                <h2 id="manual-editor-title">Edit manual source</h2>
              </div>
              <button
                type="button"
                aria-label="Close manual source editor"
                onClick={() => setEditingManual(null)}
              >
                ×
              </button>
            </div>
            <form onSubmit={saveManualSource}>
              <div className="field">
                <label htmlFor="manual-source-name">Source name</label>
                <input
                  id="manual-source-name"
                  value={manualName}
                  onChange={(event) => setManualName(event.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="manual-source-entries">Entries</label>
                <textarea
                  id="manual-source-entries"
                  value={manualDraft}
                  onChange={(event) => setManualDraft(event.target.value)}
                  rows={16}
                  required
                  autoFocus
                />
                <small>
                  One {editingManual.type.toUpperCase()} entry per line.
                  Invalid values are ignored; at least one valid entry is
                  required.
                </small>
              </div>
              <div className="type-lock">
                <span>Aggregation rule</span>
                <strong>{editingManual.role}</strong>
                <small>
                  Exclusion sources continue to take priority over all includes.
                </small>
              </div>
              {formError && <p className="form-error">{formError}</p>}
              <div className="drawer-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setEditingManual(null)}
                >
                  Cancel
                </button>
                <button
                  className="primary-button"
                  type="submit"
                  disabled={busySource === editingManual.id}
                >
                  Save &amp; validate
                </button>
              </div>
            </form>
          </aside>
        </div>
      )}

      {editingList && (
        <div
          className="drawer-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setEditingList(null);
          }}
        >
          <aside
            className="source-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="list-editor-title"
          >
            <div className="drawer-heading">
              <div>
                <p className="eyebrow">Published endpoint</p>
                <h2 id="list-editor-title">Edit published list</h2>
              </div>
              <button
                type="button"
                aria-label="Close published list editor"
                onClick={() => setEditingList(null)}
              >
                ×
              </button>
            </div>
            <form onSubmit={savePublishedList}>
              <div className="field">
                <label htmlFor="published-list-name">List name</label>
                <input
                  id="published-list-name"
                  value={listName}
                  onChange={(event) => setListName(event.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="published-list-slug">Endpoint URL slug</label>
                <div className="slug-field">
                  <code>/edl/</code>
                  <input
                    id="published-list-slug"
                    value={listSlug}
                    onChange={(event) =>
                      setListSlug(
                        event.target.value
                          .toLowerCase()
                          .replace(/[^a-z0-9-]/g, "-"),
                      )
                    }
                    pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                    required
                  />
                </div>
                <small>
                  Changing this immediately changes the URL configured on
                  downstream security platforms.
                </small>
              </div>
              <div className="field">
                <label htmlFor="published-list-description">Description</label>
                <textarea
                  id="published-list-description"
                  value={listDescription}
                  onChange={(event) => setListDescription(event.target.value)}
                  rows={5}
                  maxLength={500}
                />
              </div>
              <div className="type-lock">
                <span>List type</span>
                <strong>{editingList.type.toUpperCase()}</strong>
                <small>
                  The list type remains fixed so existing source validation
                  stays consistent.
                </small>
              </div>
              {formError && <p className="form-error">{formError}</p>}
              <div className="drawer-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setEditingList(null)}
                >
                  Cancel
                </button>
                <button className="primary-button" type="submit">
                  Save published list
                </button>
              </div>
            </form>
          </aside>
        </div>
      )}

      {notice && (
        <div className="toast" role="status">
          <span>✓</span>
          {notice}
        </div>
      )}
    </div>
  );
}

function PublishedView({
  list,
  endpoint,
  copyEndpoint,
  editList,
}: {
  list: PublishedList;
  endpoint: string;
  copyEndpoint: () => void;
  editList: () => void;
}) {
  return (
    <section className="published-layout">
      <article className="panel publish-card">
        <div className="publish-title">
          <div>
            <p className="eyebrow">Universal list endpoint</p>
            <h2>{list.name}</h2>
          </div>
          <button className="secondary-button" type="button" onClick={editList}>
            Edit list
          </button>
        </div>
        <p>{list.description}</p>
        <div className="integration-url">
          <code>{endpoint}</code>
          <button type="button" onClick={copyEndpoint}>
            Copy
          </button>
        </div>
        <div className="integration-notes">
          <div>
            <strong>Content type</strong>
            <span>text/plain; charset=utf-8</span>
          </div>
          <div>
            <strong>Cache policy</strong>
            <span>5 minute edge cache</span>
          </div>
          <div>
            <strong>Conditional fetches</strong>
            <span>ETag / If-None-Match</span>
          </div>
        </div>
      </article>
      <article className="panel instruction-card">
        <p className="eyebrow">Vendor-neutral delivery</p>
        <h2>Use it anywhere</h2>
        <ol>
          <li>
            <span>1</span>
            <p>Copy the stable HTTPS endpoint.</p>
          </li>
          <li>
            <span>2</span>
            <p>
              Add it as an <strong>{list.type.toUpperCase()} list</strong> on
              any compatible firewall, gateway, or security platform.
            </p>
          </li>
          <li>
            <span>3</span>
            <p>Choose the platform refresh interval and verify retrieval.</p>
          </li>
        </ol>
      </article>
    </section>
  );
}
