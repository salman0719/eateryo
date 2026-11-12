/**
 * Canonical menu schema — the single source of truth for AI output,
 * UI state, stored records, and imported files (see PLAN.md §6).
 *
 * Do NOT define competing menu types elsewhere; import from here
 * (or from `./types` for derived helper types).
 *
 * Honesty rules (PLAN.md §5B):
 * - Missing prices, descriptions, dietary labels, or ingredients are
 *   `null`/empty — never invented.
 * - Uncertainty is recorded in `reviewNotes`, never silently resolved.
 * - A null price stops flagging when the item's size variants carry the
 *   prices (per-size pricing has a null root `price` by design) or via
 *   explicit owner acceptance (`unpricedAccepted`, e.g. "market price") —
 *   never by inventing a number.
 * - Stable app-generated IDs (`generateId()` in `./menu-utils`), never
 *   names, identify categories and items.
 *
 * Conventions:
 * - `sortOrder` is a dense 0-based position within its parent array.
 *   Helpers in `./menu-utils` renumber after every edit.
 * - Timestamps are ISO 8601 strings (`new Date().toISOString()`).
 * - `currency` is the literal code/symbol as seen on the menu
 *   (e.g. "USD", "$", "€") or `null` when not shown.
 */

import { z } from "zod";

/** Current version of the stored menu document format. Bump on breaking changes. */
export const SCHEMA_VERSION = 1 as const;

export const menuVariantSchema = z.object({
  name: z.string().min(1),
  price: z.number().nullable(),
});

export const menuOptionChoiceSchema = z.object({
  name: z.string().min(1),
  priceDelta: z.number().nullable(),
});

export const menuOptionSchema = z.object({
  name: z.string().min(1),
  choices: z.array(menuOptionChoiceSchema).default([]),
});

/**
 * One stored copy of a dish photo, as served from the file host's CDN.
 *
 * `url` is absolute and https: the diner's page renders it directly from the
 * CDN, and a stored document must never be able to point an `<img>` at a
 * `javascript:`/`data:` address or a plain-http origin.
 */
export const storedMenuItemPhotoSchema = z.object({
  url: z.string().refine((value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "Photo URLs must be absolute https URLs."),
  /** UploadThing file key — the handle for this stored object. */
  key: z.string().min(1),
  /** Real pixel size of this copy, so the page reserves space while it loads. */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

/**
 * A dish photo attached to a menu item (owner-supplied, never invented).
 *
 * Two pre-sized copies are uploaded per photo: the display copy (the base
 * fields) and an optional smaller `thumb` for a menu row. Both are sized in
 * the browser before upload, so the page renders a plain `<img>` straight
 * from the CDN — no image optimizer, no per-request resizing. `thumb` is
 * null when the source was already small enough that a second copy would be
 * the same picture twice.
 *
 * Old files are deliberately never deleted on replace/remove: a published
 * revision snapshots documents, so the previous photo may still be the one
 * diners are served until the owner republishes.
 */
export const menuItemImageSchema = storedMenuItemPhotoSchema.extend({
  thumb: storedMenuItemPhotoSchema.nullable().default(null),
});

export const menuItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  price: z.number().nullable(),
  currency: z.string().min(1).nullable(),
  sortOrder: z.number().int().nonnegative(),
  available: z.boolean().nullable(),
  dietaryLabels: z.array(z.string().min(1)).default([]),
  variants: z.array(menuVariantSchema).default([]),
  options: z.array(menuOptionSchema).default([]),
  reviewNotes: z.array(z.string().min(1)).default([]),
  /** Owner-confirmed intentionally unpriced (e.g. "market price").
   * Set only by an explicit "leave unpriced" action — never by the AI —
   * so a null price stops flagging without inventing a number. */
  unpricedAccepted: z.boolean().default(false),
  /**
   * Owner-attached photo. Optional so documents saved before dish photos
   * existed (and the AI's output, which never has one) stay valid.
   */
  image: menuItemImageSchema.optional(),
});

export const menuCategorySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  sortOrder: z.number().int().nonnegative(),
  items: z.array(menuItemSchema).default([]),
});

export const menuSourceSchema = z.object({
  originalFileName: z.string().min(1).optional(),
  extractedAt: z.string().min(1).optional(),
  /** e.g. "gemini" for live extraction, "demo" for sample data. */
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  /**
   * The title exactly as read from the photo, kept when onboarding names the
   * menu itself ("Main Menu"): it is the only place the café's name can be
   * found, and it is what the first-run café-name suggestion reads. Never
   * rendered as the menu's title.
   */
  originalTitle: z.string().min(1).optional(),
});

export const menuDocumentSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string().min(1),
  title: z.string().min(1),
  currency: z.string().min(1).nullable(),
  categories: z.array(menuCategorySchema).default([]),
  source: menuSourceSchema.optional(),
  updatedAt: z.string().min(1),
});

export type StoredMenuItemPhoto = z.infer<typeof storedMenuItemPhotoSchema>;
export type MenuItemImage = z.infer<typeof menuItemImageSchema>;
export type MenuVariant = z.infer<typeof menuVariantSchema>;
export type MenuOptionChoice = z.infer<typeof menuOptionChoiceSchema>;
export type MenuOption = z.infer<typeof menuOptionSchema>;
export type MenuItem = z.infer<typeof menuItemSchema>;
export type MenuCategory = z.infer<typeof menuCategorySchema>;
export type MenuSource = z.infer<typeof menuSourceSchema>;
export type MenuDocument = z.infer<typeof menuDocumentSchema>;
