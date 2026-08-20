import { useLayoutEffect, useState } from "react";

const STORAGE_KEY = "t3-codex:presentation-preferences:v1";

export type ColorScheme = "system" | "light" | "dark";
export type TimestampFormat = "locale" | "12-hour" | "24-hour";

export interface PresentationPreferences {
  readonly colorScheme: ColorScheme;
  readonly groupProjects: boolean;
  readonly timestampFormat: TimestampFormat;
  readonly interfaceFontSize: number;
  readonly promptFontSize: number;
  readonly codeFontSize: number;
}

export const DEFAULT_PRESENTATION_PREFERENCES: PresentationPreferences = {
  colorScheme: "system",
  groupProjects: true,
  timestampFormat: "locale",
  interfaceFontSize: 16,
  promptFontSize: 15,
  codeFontSize: 12,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

export function normalizePresentationPreferences(value: unknown): PresentationPreferences {
  if (!isRecord(value)) return DEFAULT_PRESENTATION_PREFERENCES;
  return {
    colorScheme:
      value.colorScheme === "light" || value.colorScheme === "dark" ? value.colorScheme : "system",
    groupProjects:
      typeof value.groupProjects === "boolean"
        ? value.groupProjects
        : DEFAULT_PRESENTATION_PREFERENCES.groupProjects,
    timestampFormat:
      value.timestampFormat === "12-hour" || value.timestampFormat === "24-hour"
        ? value.timestampFormat
        : "locale",
    interfaceFontSize: boundedNumber(value.interfaceFontSize, 16, 13, 19),
    promptFontSize: boundedNumber(value.promptFontSize, 15, 12, 20),
    codeFontSize: boundedNumber(value.codeFontSize, 12, 10, 18),
  };
}

function readPreferences(): PresentationPreferences {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === null
      ? DEFAULT_PRESENTATION_PREFERENCES
      : normalizePresentationPreferences(JSON.parse(raw) as unknown);
  } catch {
    return DEFAULT_PRESENTATION_PREFERENCES;
  }
}

function applyPreferences(preferences: PresentationPreferences): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const applyColorScheme = () => {
    const dark =
      preferences.colorScheme === "dark" || (preferences.colorScheme === "system" && media.matches);
    document.documentElement.classList.toggle("dark", dark);
  };
  applyColorScheme();
  document.documentElement.style.setProperty(
    "--interface-font-size",
    `${preferences.interfaceFontSize}px`,
  );
  document.documentElement.style.setProperty(
    "--prompt-font-size",
    `${preferences.promptFontSize}px`,
  );
  document.documentElement.style.setProperty("--code-font-size", `${preferences.codeFontSize}px`);
  media.addEventListener("change", applyColorScheme);
  return () => media.removeEventListener("change", applyColorScheme);
}

export function usePresentationPreferences() {
  const [preferences, setPreferences] = useState(readPreferences);

  useLayoutEffect(() => applyPreferences(preferences), [preferences]);

  const updatePreferences = (change: Partial<PresentationPreferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...change };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const restoreDefaults = () => {
    window.localStorage.removeItem(STORAGE_KEY);
    setPreferences(DEFAULT_PRESENTATION_PREFERENCES);
  };

  const isDefault =
    JSON.stringify(preferences) === JSON.stringify(DEFAULT_PRESENTATION_PREFERENCES);

  return { preferences, updatePreferences, restoreDefaults, isDefault };
}
