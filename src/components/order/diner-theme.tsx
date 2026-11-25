"use client";

import { createContext, useContext, type CSSProperties, type ReactNode } from "react";

import { dinerThemeStyle, isDarkDinerPreset } from "@/features/diner-theme/presets";
import { dinerThemePresetOf, type DinerTheme } from "@/features/diner-theme/schema";

/**
 * The preset's `--color-*` overrides for this diner subtree. Portalled
 * diner surfaces (`CustomizeSheet`, `OrderSheet`, the closed-menu tooltip)
 * render into `document.body` on a real page — outside the provider's
 * `<div>` — so they read this context and re-apply the same vars on their
 * own portal root. Inside a `PhoneFrame` the portal target already sits
 * under the provider, so re-applying is a harmless no-op.
 */
const DinerThemeVarsContext = createContext<CSSProperties>({});

export function useDinerThemeVars(): CSSProperties {
  return useContext(DinerThemeVarsContext);
}

/**
 * Diner theme scope: overrides `--color-*` vars on the diner subtree only,
 * so Tailwind role utilities (`bg-accent-700`, `text-ink-900`, …) re-skin
 * with no component edits. Never applied at `:root` — a leak would repaint
 * the owner app. Null theme = no overrides (shipped Eucalyptus).
 */
export function DinerThemeProvider({
  theme,
  children,
  className = "",
}: {
  theme: DinerTheme;
  children: ReactNode;
  /** Extra layout classes; the themed page wash (`bg-background`) is always on. */
  className?: string;
}) {
  const preset = dinerThemePresetOf(theme);
  const style = dinerThemeStyle(preset) as CSSProperties;
  return (
    <div
      data-diner-theme={preset}
      data-dark={isDarkDinerPreset(preset) ? "true" : "false"}
      style={style}
      className={`w-full bg-background ${className}`.trim()}
    >
      <DinerThemeVarsContext.Provider value={style}>{children}</DinerThemeVarsContext.Provider>
    </div>
  );
}
