export const APP_THEMES = [
  "signal",
  "ocean",
  "ember",
  "midnight",
  "custom",
] as const;

export type AppTheme = (typeof APP_THEMES)[number];

export type CustomThemeColors = {
  navigation: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  muted: string;
};

export const DEFAULT_CUSTOM_THEME: CustomThemeColors = {
  navigation: "#242038",
  accent: "#ffb000",
  background: "#f5f3f8",
  surface: "#ffffff",
  text: "#211d2b",
  muted: "#716b7a",
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const CUSTOM_COLOR_KEYS = [
  "navigation",
  "accent",
  "background",
  "surface",
  "text",
  "muted",
] as const;

export function isAppTheme(value: unknown): value is AppTheme {
  return typeof value === "string" && APP_THEMES.includes(value as AppTheme);
}

export function parseCustomThemeColors(
  value: unknown,
): CustomThemeColors | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const colors = value as Record<string, unknown>;
  const parsed = {} as CustomThemeColors;
  for (const key of CUSTOM_COLOR_KEYS) {
    const color = colors[key];
    if (typeof color !== "string" || !HEX_COLOR.test(color)) return null;
    parsed[key] = color.toLowerCase();
  }
  return parsed;
}

function colorChannels(color: string) {
  return [1, 3, 5].map((offset) =>
    Number.parseInt(color.slice(offset, offset + 2), 16),
  );
}

export function isDarkColor(color: string) {
  const [red, green, blue] = colorChannels(color).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return red * 0.2126 + green * 0.7152 + blue * 0.0722 < 0.32;
}

export function contrastingTextColor(color: string) {
  return isDarkColor(color) ? "#ffffff" : "#111111";
}
