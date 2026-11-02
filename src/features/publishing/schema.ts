import { z } from "zod";

/**
 * Publishing contracts (Step 9), validated at every boundary like the rest
 * of the app. This module stays client-safe (no Drizzle, no server imports).
 *
 * Publishing is no longer a page builder: it snapshots the menu so table
 * ordering can price it, and marks it as being served. There is no public
 * menu address, so a publication has no URL, no theme, and no view count —
 * only whether it is live and whether the draft has changes the snapshot
 * has not seen. The reserved slug survives because a menu's own order page
 * (`/r/<restaurant>/m/<menu>/order`) still addresses it.
 */

/** Long enough for a café name, short enough to stay shareable. */
export const SLUG_MAX_LENGTH = 48;

/**
 * Address segments are lowercase ASCII with single hyphens — no spaces, no
 * accents, no leading/trailing or doubled hyphens. Anything else would need
 * percent-encoding in a URL.
 */
export const MENU_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const menuSlugSchema = z
  .string()
  .trim()
  .min(1, "An address needs at least one character.")
  .max(SLUG_MAX_LENGTH, `Keep the address to ${SLUG_MAX_LENGTH} characters or fewer.`)
  .regex(
    MENU_SLUG_PATTERN,
    "Use lowercase letters, numbers, and single hyphens (e.g. lunch-menu)."
  );

/** POST /api/menus/[menuId]/publication — publish (or publish changes). */
export const publishBodySchema = z.object({
  /** Omit to keep the current address, or derive one from the menu title. */
  slug: menuSlugSchema.optional(),
});

/**
 * What the editor needs to know about one menu's publication. `null` means
 * the menu has never been published.
 */
export const publicationStatusSchema = z.object({
  menuId: z.string().min(1),
  restaurantId: z.string().min(1),
  /** True only while table ordering actually offers this menu. */
  isLive: z.boolean(),
  publishedAt: z.string().nullable(),
  liveRevisionId: z.string().nullable(),
  /** The menu revision the live snapshot was published from. */
  sourceUpdatedAt: z.string().nullable(),
  /** Draft edits exist that diners do not see yet. */
  hasUnpublishedChanges: z.boolean(),
});

export type PublicationStatus = z.infer<typeof publicationStatusSchema>;
