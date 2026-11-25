import type { CSSProperties } from "react";

import type { DinerThemePreset } from "./schema";

/**
 * Preset variable overrides for the diner subtree. Values come from the
 * gitignored lab set (`local/prototype/diner-page-themes/themes.json`);
 * washes derive via `color-mix` in the provider, so presets ship brand +
 * surfaces + ink + lines + shape/type only. Eucalyptus is `{}` — no
 * overrides, the shipped look.
 */

type PresetDef = {
  label: string;
  blurb: string;
  dark?: boolean;
  radius?: string;
  display?: string;
  overrides: Record<string, string>;
};

export const DINER_THEME_PRESETS_UI: Record<DinerThemePreset, PresetDef> = {
  eucalyptus: { label: "Eucalyptus", blurb: "Shipped look. Safe default.", overrides: {} },
  tinted: {
    label: "Eucalyptus tinted",
    blurb: "Same eucalyptus hues with more coverage.",
    overrides: {
      "--color-accent-700": "#3a5b4f",
      "--color-accent-800": "#2a443a",
      "--color-background": "#e3eee8",
      "--color-ink-600": "#4c6056",
      "--color-ink-900": "#1f2a25",
      "--color-line-200": "#bfd2c8",
      "--color-line-300": "#96ada1",
      "--color-surface-100": "#d7e6de",
      "--color-surface-50": "#eff6f2",
      "--color-surface-base": "#f9fcfb",
    },
  },
  terracotta: {
    label: "Terracotta",
    blurb: "Warm cream + terracotta actions, serif names.",
    radius: "18px",
    display: '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif',
    overrides: {
      "--color-accent-700": "#b4553a",
      "--color-accent-800": "#8e3f2a",
      "--color-background": "#f6ede2",
      "--color-ink-600": "#6b5f52",
      "--color-ink-900": "#2f2a24",
      "--color-line-200": "#e2d3c2",
      "--color-line-300": "#c7b29d",
      "--color-on-accent": "#fff8f0",
      "--color-surface-100": "#f0e2d1",
      "--color-surface-50": "#fbf3e8",
      "--color-surface-base": "#fffaf3",
    },
  },
  ink: {
    label: "Ink & Citron",
    blurb: "Near-black + olive signal (citron stays the swatch for contrast).",
    radius: "4px",
    display: '"Arial Black","Helvetica Neue",Arial,sans-serif',
    overrides: {
      "--color-accent-700": "#67700f",
      "--color-accent-800": "#4c530a",
      "--color-background": "#f3f0e8",
      "--color-ink-600": "#5b5b54",
      "--color-ink-900": "#141414",
      "--color-line-200": "#d8d3c5",
      "--color-line-300": "#b7b1a2",
      "--color-on-accent": "#141414",
      "--color-surface-100": "#e9e5da",
      "--color-surface-50": "#f7f3e9",
      "--color-surface-base": "#fffdf7",
    },
  },
  harbour: {
    label: "Harbour Blue",
    blurb: "Cool daylight café.",
    overrides: {
      "--color-accent-700": "#2f5f8f",
      "--color-accent-800": "#234a71",
      "--color-background": "#e8eff6",
      "--color-ink-600": "#54687d",
      "--color-ink-900": "#1f2a36",
      "--color-line-200": "#c9d6e3",
      "--color-line-300": "#9db0c3",
      "--color-surface-100": "#dde7f1",
      "--color-surface-50": "#f2f6fb",
      "--color-surface-base": "#ffffff",
    },
  },
  lilac: {
    label: "Lilac",
    blurb: "Soft light purple on the shipped shape.",
    overrides: {
      "--color-accent-700": "#65449b",
      "--color-accent-800": "#4e3479",
      "--color-background": "#efeaf6",
      "--color-ink-600": "#635a74",
      "--color-ink-900": "#2a2333",
      "--color-line-200": "#d4c8e4",
      "--color-line-300": "#ab9ac3",
      "--color-surface-100": "#e2d7f0",
      "--color-surface-50": "#f6f1fb",
      "--color-surface-base": "#fffdff",
    },
  },
  notturno: {
    label: "Notturno",
    blurb: "Evening plum + amber.",
    dark: true,
    radius: "14px",
    display: '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif',
    overrides: {
      "--color-accent-700": "#e0a45a",
      "--color-accent-800": "#c9863c",
      "--color-accent-900": "#f2c98d",
      "--color-background": "#1c141a",
      "--color-ink-400": "#9a7f8d",
      "--color-ink-500": "#b89aa9",
      "--color-ink-600": "#c9b3bf",
      "--color-ink-700": "#ddc3cf",
      "--color-ink-800": "#f0ddd0",
      "--color-ink-900": "#f8ede2",
      "--color-line-100": "#33222d",
      "--color-line-200": "#4a3542",
      "--color-line-300": "#6b4f5f",
      "--color-on-accent": "#24160e",
      "--color-surface-100": "#3a2a35",
      "--color-surface-200": "#4e3846",
      "--color-surface-50": "#231820",
      "--color-surface-base": "#2a1e27",
    },
  },
  abyss: {
    label: "Abyss Blue",
    blurb: "Deep-sea night blue.",
    dark: true,
    overrides: {
      "--color-accent-700": "#7fb8ec",
      "--color-accent-800": "#5d97cf",
      "--color-accent-900": "#bcd9f4",
      "--color-background": "#101e2e",
      "--color-ink-400": "#7e96b0",
      "--color-ink-500": "#93a9c2",
      "--color-ink-600": "#a9bfd4",
      "--color-ink-700": "#c4d6e8",
      "--color-ink-800": "#d8e6f4",
      "--color-ink-900": "#eaf2fa",
      "--color-line-100": "#1e344e",
      "--color-line-200": "#2e4a66",
      "--color-line-300": "#4b6c8d",
      "--color-on-accent": "#0e1a28",
      "--color-surface-100": "#26405c",
      "--color-surface-200": "#33517a",
      "--color-surface-50": "#13202f",
      "--color-surface-base": "#18293e",
    },
  },
  grape: {
    label: "Grape Night",
    blurb: "Ultraviolet night purple.",
    dark: true,
    overrides: {
      "--color-accent-700": "#c9a6f2",
      "--color-accent-800": "#a67fe0",
      "--color-accent-900": "#ddc9f8",
      "--color-background": "#1c1429",
      "--color-ink-400": "#8d7aae",
      "--color-ink-500": "#a995c6",
      "--color-ink-600": "#bfaed6",
      "--color-ink-700": "#d3c2ea",
      "--color-ink-800": "#e6d8f8",
      "--color-ink-900": "#f2eafc",
      "--color-line-100": "#31254a",
      "--color-line-200": "#463467",
      "--color-line-300": "#6b558c",
      "--color-on-accent": "#221334",
      "--color-surface-100": "#3a2c54",
      "--color-surface-200": "#4e3d72",
      "--color-surface-50": "#211830",
      "--color-surface-base": "#271d3a",
    },
  },
};

export function dinerThemeStyle(preset: DinerThemePreset): CSSProperties {
  const def = DINER_THEME_PRESETS_UI[preset];
  return {
    ...def.overrides,
    ...(def.radius ? ({ "--diner-radius": def.radius } as CSSProperties) : null),
    ...(def.display ? ({ "--diner-display": def.display } as CSSProperties) : null),
  };
}

export function isDarkDinerPreset(preset: DinerThemePreset): boolean {
  return DINER_THEME_PRESETS_UI[preset].dark === true;
}
