"use client";

import { ChangeEvent, FormEvent, useState } from "react";
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
  brandingImageVersion: string | null;
  onBrandingImageChange: (version: string | null) => void;
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
  brandingImageVersion,
  onBrandingImageChange,
  setNotice,
}: Props) {
  const [draft, setDraft] = useState(customTheme);
  const [isSaving, setIsSaving] = useState(false);
  const [brandingDraft, setBrandingDraft] = useState<string | null>(null);
  const [isSavingBranding, setIsSavingBranding] = useState(false);

  function selectBrandingImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setNotice("Choose a PNG, JPEG, or WebP image.");
      return;
    }
    if (file.size > 1024 * 1024) {
      setNotice("Branding images must be 1 MB or smaller.");
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") setBrandingDraft(reader.result);
    });
    reader.addEventListener("error", () => {
      setNotice("Unable to read the selected image.");
    });
    reader.readAsDataURL(file);
  }

  async function saveBrandingImage() {
    if (!brandingDraft) return;
    setIsSavingBranding(true);
    try {
      const response = await apiFetch("/api/settings/branding", {
        method: "PATCH",
        body: JSON.stringify({ imageDataUrl: brandingDraft }),
      });
      const payload = (await response.json()) as {
        brandingImage?: { version?: string };
        error?: string;
      };
      if (!response.ok || !payload.brandingImage?.version) {
        throw new Error(payload.error ?? "Unable to update application branding.");
      }
      onBrandingImageChange(payload.brandingImage.version);
      setBrandingDraft(null);
      setNotice("Application logo and favicon updated.");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Unable to update application branding.",
      );
    } finally {
      setIsSavingBranding(false);
    }
  }

  async function resetBrandingImage() {
    if (
      !window.confirm(
        "Restore the default OpenEDL logo and favicon? The uploaded image will be removed.",
      )
    ) {
      return;
    }
    setIsSavingBranding(true);
    try {
      const response = await apiFetch("/api/settings/branding", {
        method: "DELETE",
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Unable to reset application branding.");
      }
      onBrandingImageChange(null);
      setBrandingDraft(null);
      setNotice("Default OpenEDL logo and favicon restored.");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Unable to reset application branding.",
      );
    } finally {
      setIsSavingBranding(false);
    }
  }

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
    draft.navigation,
    draft.accent,
    draft.background,
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
            Upload shared branding and choose the palette used across the
            dashboard and sign-in page for every OpenEDL user.
          </p>
        </div>
      </section>

      <section className="panel branding-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Shared branding</p>
            <h2>Application logo &amp; favicon</h2>
          </div>
          <span className="format-pill">PNG · JPEG · WebP</span>
        </div>
        <div className="branding-editor">
          <div
            className={`branding-preview${brandingDraft || brandingImageVersion ? " has-image" : ""}`}
            style={
              brandingDraft || brandingImageVersion
                ? {
                    backgroundImage: `url("${
                      brandingDraft ??
                      `/api/branding/image?v=${encodeURIComponent(brandingImageVersion ?? "")}`
                    }")`,
                  }
                : undefined
            }
            aria-label="Application logo preview"
          >
            {brandingDraft || brandingImageVersion ? null : "OE"}
          </div>
          <div className="branding-copy">
            <strong>Upload one image for every OpenEDL brand mark</strong>
            <p>
              The image appears on sign-in, first-run setup, dashboard
              navigation, and as the browser favicon. A square image with a
              transparent background works best. Maximum size: 1 MB.
            </p>
            <div className="branding-actions">
              <label className="secondary-button branding-file-button">
                Choose image
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={selectBrandingImage}
                />
              </label>
              <button
                className="primary-button"
                type="button"
                disabled={!brandingDraft || isSavingBranding}
                onClick={saveBrandingImage}
              >
                {isSavingBranding ? "Saving…" : "Save logo & favicon"}
              </button>
              {(brandingDraft || brandingImageVersion) && (
                <button
                  className="secondary-button"
                  type="button"
                  disabled={isSavingBranding}
                  onClick={
                    brandingDraft
                      ? () => setBrandingDraft(null)
                      : resetBrandingImage
                  }
                >
                  {brandingDraft ? "Cancel selection" : "Restore default"}
                </button>
              )}
            </div>
          </div>
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
