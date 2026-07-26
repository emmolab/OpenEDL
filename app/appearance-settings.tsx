"use client";

import { FormEvent, useState } from "react";

type AppTheme = "signal" | "ocean" | "ember" | "midnight";

type Props = {
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  theme: AppTheme;
  endpointBaseUrl: string;
  onThemeChange: (theme: AppTheme) => void;
  onEndpointBaseUrlChange: (value: string) => void;
  setNotice: (message: string) => void;
};

const themes = [
  {
    id: "signal" as const,
    name: "Signal Green",
    description: "The original high-contrast threat intelligence palette.",
    colors: ["#173b2b", "#c8f257", "#f4f6f2"],
  },
  {
    id: "ocean" as const,
    name: "Ocean Blue",
    description: "A calm blue control plane with cyan highlights.",
    colors: ["#15374a", "#67d5ff", "#f1f5f8"],
  },
  {
    id: "ember" as const,
    name: "Ember Copper",
    description: "Warm copper navigation with amber signals.",
    colors: ["#4a231c", "#ffd166", "#f8f2ed"],
  },
  {
    id: "midnight" as const,
    name: "Midnight",
    description: "A true dark interface with bright lime intelligence signals.",
    colors: ["#0b110d", "#9ee35d", "#18221b"],
  },
] as const;

export function AppearanceSettings({
  apiFetch,
  theme,
  endpointBaseUrl,
  onThemeChange,
  onEndpointBaseUrlChange,
  setNotice,
}: Props) {
  const [baseUrlDraft, setBaseUrlDraft] = useState(endpointBaseUrl);
  const [baseUrlError, setBaseUrlError] = useState("");
  async function selectTheme(nextTheme: AppTheme) {
    const previousTheme = theme;
    onThemeChange(nextTheme);
    try {
      const response = await apiFetch("/api/settings/appearance", {
        method: "PATCH",
        body: JSON.stringify({ theme: nextTheme }),
      });
      const payload = (await response.json()) as {
        theme?: AppTheme;
        error?: string;
      };
      if (!response.ok || !payload.theme) {
        throw new Error(payload.error ?? "Unable to update application theme.");
      }
      onThemeChange(payload.theme);
      setNotice("Application theme updated for every user.");
    } catch (error) {
      onThemeChange(previousTheme);
      setNotice(
        error instanceof Error
          ? error.message
          : "Unable to update application theme.",
      );
    }
  }

  async function saveBaseUrl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBaseUrlError("");
    try {
      const response = await apiFetch("/api/settings/appearance", {
        method: "PATCH",
        body: JSON.stringify({ endpointBaseUrl: baseUrlDraft }),
      });
      const payload = (await response.json()) as {
        endpointBaseUrl?: string;
        error?: string;
      };
      if (!response.ok || payload.endpointBaseUrl === undefined) {
        throw new Error(payload.error ?? "Unable to update public endpoint URL.");
      }
      setBaseUrlDraft(payload.endpointBaseUrl);
      onEndpointBaseUrlChange(payload.endpointBaseUrl);
      setNotice("Public endpoint base URL updated.");
    } catch (error) {
      setBaseUrlError(
        error instanceof Error
          ? error.message
          : "Unable to update public endpoint URL.",
      );
    }
  }

  return (
    <>
      <section className="page-heading users-heading">
        <div>
          <p className="eyebrow">Application appearance</p>
          <h1>
            Global
            <br />
            <em>theme.</em>
          </h1>
          <p className="heading-copy">
            Choose the palette used across the dashboard and sign-in page for
            every OpenEDL user.
          </p>
        </div>
      </section>

      <section className="panel appearance-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Shared setting</p>
            <h2>Application theme</h2>
          </div>
          <span className="format-pill">Admin controlled</span>
        </div>
        <div className="appearance-grid">
          {themes.map((option) => (
            <button
              className={theme === option.id ? "active" : ""}
              type="button"
              key={option.id}
              onClick={() => selectTheme(option.id)}
            >
              <span className="appearance-preview">
                {option.colors.map((color) => (
                  <i style={{ background: color }} key={color} />
                ))}
              </span>
              <strong>{option.name}</strong>
              <small>{option.description}</small>
              <b>{theme === option.id ? "Current theme" : "Use theme"}</b>
            </button>
          ))}
        </div>
      </section>

      <section className="panel public-url-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Reverse proxy</p>
            <h2>Public endpoint base URL</h2>
          </div>
        </div>
        <form className="public-url-form" onSubmit={saveBaseUrl}>
          <div className="field">
            <label htmlFor="endpoint-base-url">Public origin</label>
            <input
              id="endpoint-base-url"
              type="url"
              value={baseUrlDraft}
              onChange={(event) => setBaseUrlDraft(event.target.value)}
              placeholder="https://edl.example.com"
            />
            <small>
              Used when displaying and copying published EDL URLs. Leave blank
              to use the browser&apos;s current origin.
            </small>
          </div>
          {baseUrlError && <p className="form-error">{baseUrlError}</p>}
          <div className="profile-actions">
            <button className="primary-button" type="submit">
              Save public URL
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
