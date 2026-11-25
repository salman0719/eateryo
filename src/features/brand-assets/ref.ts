/**
 * Reading a stored brand asset — pure helpers shared by Settings and (later)
 * the diner page, the menu config, and the live preview. No browser APIs, no
 * storage, no upload code.
 *
 * A brand asset is the same stored shape as a dish photo, so these are the
 * dish-photo helpers under brand names: one place to fix the matching, and
 * the call sites read as the slot they serve. If brand copies ever diverge
 * (a focal point, a third copy), this is where the fork happens.
 */

import { buildMenuItemImage, itemImageCopy, itemImageKey } from "@/features/item-images/ref";

/** Turn prepared copies plus the host's reply into the reference the restaurant stores. */
export const buildBrandAssetImage = buildMenuItemImage;

/** The copy a tile or band should load: the thumbnail when one was uploaded. */
export const brandAssetCopy = itemImageCopy;

/** Stable identity for "which photo is this": the stored file's key, not its URL. */
export const brandAssetKey = itemImageKey;
