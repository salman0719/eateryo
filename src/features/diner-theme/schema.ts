import { z } from "zod";

/**
 * Diner page theme (V1): a preset id stored on the restaurant, or null for
 * the shipped Eucalyptus look. Presets only — no free colour strings, so a
 * saved value can never inject arbitrary CSS.
 */
export const DINER_THEME_PRESETS = [
  "eucalyptus",
  "tinted",
  "terracotta",
  "ink",
  "harbour",
  "lilac",
  "notturno",
  "abyss",
  "grape",
] as const;

export type DinerThemePreset = (typeof DINER_THEME_PRESETS)[number];

export const dinerThemeSchema = z.object({ preset: z.enum(DINER_THEME_PRESETS) }).nullable();

export type DinerTheme = z.infer<typeof dinerThemeSchema>;

export function normalizeDinerTheme(value: unknown): DinerTheme {
  const parsed = dinerThemeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Null (today's look) renders as Eucalyptus everywhere. */
export function dinerThemePresetOf(theme: DinerTheme): DinerThemePreset {
  return theme?.preset ?? "eucalyptus";
}
