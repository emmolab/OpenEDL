"use client";

type AppTheme = "signal" | "ocean" | "ember" | "midnight";

type Props = {
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  theme: AppTheme;
  onThemeChange: (theme: AppTheme) => void;
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
  onThemeChange,
  setNotice,
}: Props) {
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

    </>
  );
}
