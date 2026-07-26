"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type ProviderSetting = {
  id: string;
  name: string;
  issuer: string;
  discoveryUrl: string;
  clientId: string;
  scopes: string;
  enabled: boolean;
  managed: boolean;
  hasClientSecret: boolean;
};

type Props = {
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  setNotice: (message: string) => void;
};

type ProviderForm = {
  preset: "google" | "microsoft" | "custom";
  id: string;
  name: string;
  issuer: string;
  discoveryUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  enabled: boolean;
};

const emptyProvider: ProviderForm = {
  preset: "custom",
  id: "",
  name: "",
  issuer: "",
  discoveryUrl: "",
  clientId: "",
  clientSecret: "",
  scopes: "openid profile email",
  enabled: true,
};

function presetProvider(preset: ProviderForm["preset"]): ProviderForm {
  if (preset === "google") {
    return {
      ...emptyProvider,
      preset,
      id: "google",
      name: "Google",
      issuer: "https://accounts.google.com",
      discoveryUrl:
        "https://accounts.google.com/.well-known/openid-configuration",
    };
  }
  if (preset === "microsoft") {
    return {
      ...emptyProvider,
      preset,
      id: "microsoft",
      name: "Microsoft",
      issuer: "https://login.microsoftonline.com/organizations/v2.0",
      discoveryUrl:
        "https://login.microsoftonline.com/organizations/v2.0/.well-known/openid-configuration",
    };
  }
  return { ...emptyProvider };
}

export function SsoSettings({ apiFetch, setNotice }: Props) {
  const [providers, setProviders] = useState<ProviderSetting[]>([]);
  const [encryptionConfigured, setEncryptionConfigured] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProviderForm>(emptyProvider);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [origin] = useState(() =>
    typeof window === "undefined" ? "" : window.location.origin,
  );

  const loadProviders = useCallback(async () => {
    try {
      const response = await apiFetch("/api/settings/sso", {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        providers?: ProviderSetting[];
        encryptionConfigured?: boolean;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load SSO settings.");
      }
      setProviders(payload.providers ?? []);
      setEncryptionConfigured(Boolean(payload.encryptionConfigured));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load SSO settings.",
      );
    }
  }, [apiFetch]);

  useEffect(() => {
    queueMicrotask(() => void loadProviders());
  }, [loadProviders]);

  function startCreate() {
    setEditingId(null);
    setForm(emptyProvider);
    setError("");
    setShowForm(true);
  }

  function startEdit(provider: ProviderSetting) {
    setEditingId(provider.id);
    setForm({
      preset: "custom",
      id: provider.id,
      name: provider.name,
      issuer: provider.issuer,
      discoveryUrl: provider.discoveryUrl,
      clientId: provider.clientId,
      clientSecret: "",
      scopes: provider.scopes,
      enabled: provider.enabled,
    });
    setError("");
    setShowForm(true);
  }

  async function saveProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(editingId ?? "new");
    try {
      const path = editingId
        ? `/api/settings/sso/${editingId}`
        : "/api/settings/sso";
      const response = await apiFetch(path, {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify({
          ...form,
          clientSecret: form.clientSecret || undefined,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to save provider.");
      }
      setShowForm(false);
      setForm(emptyProvider);
      setNotice(editingId ? "SSO provider updated." : "SSO provider created.");
      await loadProviders();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save provider.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function toggleProvider(provider: ProviderSetting) {
    setBusy(provider.id);
    try {
      const response = await apiFetch(`/api/settings/sso/${provider.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !provider.enabled }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Update failed.");
      setNotice(provider.enabled ? "SSO provider disabled." : "SSO provider enabled.");
      await loadProviders();
    } catch (toggleError) {
      setError(
        toggleError instanceof Error ? toggleError.message : "Update failed.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function testProvider(provider: ProviderSetting) {
    setBusy(provider.id);
    try {
      const response = await apiFetch(
        `/api/settings/sso/${provider.id}/test`,
        { method: "POST" },
      );
      const payload = (await response.json()) as {
        issuer?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Provider test failed.");
      }
      setNotice(`Discovery succeeded · ${payload.issuer}`);
    } catch (testError) {
      setError(
        testError instanceof Error ? testError.message : "Provider test failed.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function removeProvider(provider: ProviderSetting) {
    if (!window.confirm(`Delete the “${provider.name}” SSO configuration?`)) {
      return;
    }
    setBusy(provider.id);
    try {
      const response = await apiFetch(`/api/settings/sso/${provider.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Unable to delete provider.");
      }
      setNotice("SSO provider deleted.");
      await loadProviders();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete provider.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <section className="page-heading users-heading">
        <div>
          <p className="eyebrow">Identity federation</p>
          <h1>
            SSO
            <br />
            <em>configuration.</em>
          </h1>
          <p className="heading-copy">
            Connect Google, Microsoft Entra ID, or any standards-compliant OIDC
            provider without editing application code.
          </p>
        </div>
        <button
          className="primary-button"
          type="button"
          onClick={startCreate}
          disabled={!encryptionConfigured}
        >
          <span aria-hidden="true">+</span>
          Add provider
        </button>
      </section>

      {!encryptionConfigured && (
        <section className="settings-warning">
          <strong>Encryption key required</strong>
          <p>
            Set <code>CONFIG_ENCRYPTION_KEY</code> to a base64-encoded 32-byte
            key. GUI-managed client secrets are encrypted with AES-GCM before
            being stored in the database.
          </p>
        </section>
      )}

      <section className="panel settings-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Sign-in methods</p>
            <h2>OIDC providers</h2>
          </div>
          <span className="format-pill">{providers.length} configured</span>
        </div>
        {error && <p className="user-error">{error}</p>}
        <div className="provider-list">
          {providers.length === 0 ? (
            <div className="users-empty">No SSO providers configured.</div>
          ) : (
            providers.map((provider) => (
              <article className="provider-row" key={provider.id}>
                <div className="provider-symbol">
                  {provider.id === "google"
                    ? "G"
                    : provider.id === "microsoft"
                      ? "M"
                      : "↗"}
                </div>
                <div className="provider-identity">
                  <strong>{provider.name}</strong>
                  <span>{provider.issuer}</span>
                </div>
                <div className="provider-client">
                  <span>Client ID</span>
                  <code>{provider.clientId}</code>
                </div>
                <div className="provider-origin">
                  {provider.managed ? "GUI managed" : "Environment"}
                </div>
                <div className="user-state">
                  <button
                    type="button"
                    className={provider.enabled ? "enabled" : "disabled"}
                    disabled={!provider.managed || busy === provider.id}
                    onClick={() => toggleProvider(provider)}
                  >
                    <i />
                    {provider.enabled ? "Enabled" : "Disabled"}
                  </button>
                </div>
                <div className="provider-actions">
                  <button
                    type="button"
                    disabled={busy === provider.id}
                    onClick={() => testProvider(provider)}
                  >
                    Test
                  </button>
                  {provider.managed && (
                    <>
                      <button
                        type="button"
                        disabled={busy === provider.id}
                        onClick={() => startEdit(provider)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="delete-user"
                        disabled={busy === provider.id}
                        onClick={() => removeProvider(provider)}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
                <code className="provider-callback">
                  {`${origin}/api/auth/callback/${provider.id}`}
                </code>
              </article>
            ))
          )}
        </div>
      </section>

      {showForm && (
        <div
          className="drawer-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowForm(false);
          }}
        >
          <aside
            className="source-drawer sso-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sso-form-title"
          >
            <div className="drawer-heading">
              <div>
                <p className="eyebrow">OIDC configuration</p>
                <h2 id="sso-form-title">
                  {editingId ? "Edit provider" : "Add provider"}
                </h2>
              </div>
              <button
                type="button"
                aria-label="Close SSO form"
                onClick={() => setShowForm(false)}
              >
                ×
              </button>
            </div>
            <form onSubmit={saveProvider}>
              {!editingId && (
                <div className="field">
                  <label htmlFor="provider-preset">Provider template</label>
                  <select
                    id="provider-preset"
                    value={form.preset}
                    onChange={(event) =>
                      setForm(
                        presetProvider(
                          event.target.value as ProviderForm["preset"],
                        ),
                      )
                    }
                  >
                    <option value="custom">Custom OIDC</option>
                    <option value="google">Google</option>
                    <option value="microsoft">Microsoft Entra ID</option>
                  </select>
                </div>
              )}
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="provider-id">Provider id</label>
                  <input
                    id="provider-id"
                    value={form.id}
                    disabled={Boolean(editingId)}
                    onChange={(event) =>
                      setForm({ ...form, id: event.target.value.toLowerCase() })
                    }
                    placeholder="acme-sso"
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="provider-name">Display name</label>
                  <input
                    id="provider-name"
                    value={form.name}
                    onChange={(event) =>
                      setForm({ ...form, name: event.target.value })
                    }
                    required
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="provider-issuer">Issuer URL</label>
                <input
                  id="provider-issuer"
                  type="url"
                  value={form.issuer}
                  onChange={(event) =>
                    setForm({ ...form, issuer: event.target.value })
                  }
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="provider-discovery">Discovery URL</label>
                <input
                  id="provider-discovery"
                  type="url"
                  value={form.discoveryUrl}
                  onChange={(event) =>
                    setForm({ ...form, discoveryUrl: event.target.value })
                  }
                  placeholder="Defaults to issuer/.well-known/openid-configuration"
                />
              </div>
              <div className="field">
                <label htmlFor="provider-client-id">Client ID</label>
                <input
                  id="provider-client-id"
                  value={form.clientId}
                  onChange={(event) =>
                    setForm({ ...form, clientId: event.target.value })
                  }
                  autoComplete="off"
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="provider-client-secret">
                  Client secret {editingId && "(leave blank to keep current)"}
                </label>
                <input
                  id="provider-client-secret"
                  type="password"
                  value={form.clientSecret}
                  onChange={(event) =>
                    setForm({ ...form, clientSecret: event.target.value })
                  }
                  autoComplete="new-password"
                  required={!editingId}
                />
              </div>
              <div className="field">
                <label htmlFor="provider-scopes">Scopes</label>
                <input
                  id="provider-scopes"
                  value={form.scopes}
                  onChange={(event) =>
                    setForm({ ...form, scopes: event.target.value })
                  }
                  required
                />
              </div>
              <label className="setting-check">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(event) =>
                    setForm({ ...form, enabled: event.target.checked })
                  }
                />
                Enable this provider on the sign-in screen
              </label>
              {error && <p className="form-error">{error}</p>}
              <div className="drawer-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </button>
                <button
                  className="primary-button"
                  type="submit"
                  disabled={busy !== null}
                >
                  Save provider
                </button>
              </div>
            </form>
          </aside>
        </div>
      )}
    </>
  );
}
