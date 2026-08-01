"use client";

import { FormEvent, useState } from "react";
import {
  DEFAULT_CUSTOM_THEME,
  type AppTheme,
  type CustomThemeColors,
} from "../lib/appearance";

type Props = {
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  theme: AppTheme;
  customTheme: CustomThemeColors;
  onThemeChange: (theme: AppTheme) => void;
  onCustomThemeChange: (theme: CustomThemeColors) => void;
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

const customColorFields: Array<{
  key: keyof CustomThemeColors;
  label: string;
  description: string;
}> = [
  { key: "navigation", label: "Navigation", description: "Sidebar and buttons" },
  { key: "accent", label: "Accent", description: "Highlights and active states" },
  { key: "background", label: "Background", description: "Page canvas" },
  { key: "surface", label: "Surface", description: "Panels and controls" },
  { key: "text", label: "Text", description: "Primary copy" },
  { key: "muted", label: "Muted text", description: "Labels and supporting copy" },
];

export function AppearanceSettings({
  apiFetch,
  theme,
  customTheme,
  onThemeChange,
  onCustomThemeChange,
  setNotice,
}: Props) {
  const [draft, setDraft] = useState(customTheme);
  const [isSaving, setIsSaving] = useState(false);

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
        customTheme?: CustomThemeColors;
        error?: string;
      };
      if (!response.ok || !payload.theme) {
        throw new Error(payload.error ?? "Unable to update application theme.");
      }
      onThemeChange(payload.theme);
      if (payload.customTheme) onCustomThemeChange(payload.customTheme);
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

  async function saveCustomTheme(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    try {
      const response = await apiFetch("/api/settings/appearance", {
        method: "PATCH",
        body: JSON.stringify({ theme: "custom", customTheme: draft }),
      });
      const payload = (await response.json()) as {
        theme?: AppTheme;
        customTheme?: CustomThemeColors;
        error?: string;
      };
      if (!response.ok || !payload.theme || !payload.customTheme) {
        throw new Error(payload.error ?? "Unable to save the custom theme.");
      }
      onCustomThemeChange(payload.customTheme);
      onThemeChange(payload.theme);
      setDraft(payload.customTheme);
      setNotice("Custom theme saved and applied for every user.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Unable to save the custom theme.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  const customPreview = [
    customTheme.navigation,
    customTheme.accent,
    customTheme.background,
  ];

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
            Choose or create the palette used across the dashboard and sign-in
            page for every OpenEDL user.
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
          <button
            className={theme === "custom" ? "active" : ""}
            type="button"
            onClick={() => selectTheme("custom")}
          >
            <span className="appearance-preview">
              {customPreview.map((color, index) => (
                <i style={{ background: color }} key={`${color}-${index}`} />
              ))}
            </span>
            <strong>Custom</strong>
            <small>Your own shared palette, configured below.</small>
            <b>{theme === "custom" ? "Current theme" : "Use theme"}</b>
          </button>
        </div>

        <form className="custom-theme-form" onSubmit={saveCustomTheme}>
          <div className="custom-theme-heading">
            <div>
              <p className="eyebrow">Custom palette</p>
              <h3>Choose your colours</h3>
              <p>
                OpenEDL derives borders, hover states, and contrast colours from
                these six values.
              </p>
            </div>
            <span
              className="custom-theme-sample"
              style={{
                background: draft.navigation,
                color: draft.accent,
                borderColor: draft.accent,
              }}
            >
              EDL <i style={{ background: draft.accent }} />
            </span>
          </div>
          <div className="custom-color-grid">
            {customColorFields.map((field) => (
              <label className="custom-color-field" key={field.key}>
                <input
                  type="color"
                  value={draft[field.key]}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      [field.key]: event.target.value,
                    }))
                  }
                />
                <span>
                  <strong>{field.label}</strong>
                  <small>{field.description}</small>
                </span>
                <code>{draft[field.key].toUpperCase()}</code>
              </label>
            ))}
          </div>
          <div className="custom-theme-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => setDraft(DEFAULT_CUSTOM_THEME)}
            >
              Reset palette
            </button>
            <button className="primary-button" type="submit" disabled={isSaving}>
              {isSaving ? "Saving…" : "Save & apply custom theme"}
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
