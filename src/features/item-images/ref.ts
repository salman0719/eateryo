/**
 * Reading a stored dish photo — pure helpers shared by the editor and the
 * diner's page. No browser APIs, no storage, no upload code: both sides only
 * need to know which of the pre-sized copies to ask the CDN for.
 */

import type { MenuItemImage } from "@/features/menu/schema";

/** One copy of a photo, ready to hand to a plain `<img>`. */
export interface ItemImageCopy {
  url: string;
  width: number;
  height: number;
}

/**
 * The copy a menu row should load: the thumbnail when one was uploaded,
 * otherwise the display copy (which is already small enough to serve as both).
 *
 * Rows are small, so this keeps a phone on café Wi-Fi from downloading
 * 1024px photos it will only show at 64px.
 */
export function itemImageCopy(image: MenuItemImage | null | undefined): ItemImageCopy | null {
  if (!image) return null;
  if (image.thumb) {
    return { url: image.thumb.url, width: image.thumb.width, height: image.thumb.height };
  }
  return { url: image.url, width: image.width, height: image.height };
}

/**
 * A stable identity for "which photo is this": the stored file's key, not its
 * URL. Used by the publish diff to tell a replaced photo from a re-saved one
 * that happens to render at the same address.
 */
export function itemImageKey(image: MenuItemImage | null | undefined): string | null {
  return image?.key ?? null;
}
