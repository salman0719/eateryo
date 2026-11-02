/**
 * Reading a stored dish photo — pure helpers shared by the editor and the
 * diner's page. No browser APIs, no storage, no upload code: both sides only
 * need to know which of the pre-sized copies to ask the CDN for.
 */

import type { MenuItemImage } from "@/features/menu/schema";

import type { ItemImageVariantName } from "./sizes";

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

/** One copy the browser prepared: what it is and the pixels it holds. */
export interface PreparedPhotoFile {
  name: ItemImageVariantName;
  /** File name sent to the CDN; the upload response is matched by it. */
  filename: string;
  width: number;
  height: number;
}

/** One uploaded file, as the file host reports it back. */
export interface UploadedPhotoFile {
  name: string;
  key: string;
  url: string;
}

/**
 * Turn prepared copies plus the host's reply into the reference a menu item
 * stores. Returns null when the reply does not contain the display copy — that
 * is a broken upload, not a photo, and the caller reports it as a failure.
 *
 * Matching is by file name, never by array position: the host is free to
 * answer in any order, and attaching the thumbnail as the display copy would
 * leave diners with a permanently blurry dish.
 */
export function buildMenuItemImage(
  prepared: ReadonlyArray<PreparedPhotoFile>,
  uploaded: ReadonlyArray<UploadedPhotoFile>
): MenuItemImage | null {
  const byName = new Map(uploaded.map((file) => [file.name, file]));
  const displayPrepared = prepared.find((file) => file.name === "display");
  const display = displayPrepared ? byName.get(displayPrepared.filename) : undefined;
  if (!displayPrepared || !display) return null;

  const image: MenuItemImage = {
    url: display.url,
    key: display.key,
    width: displayPrepared.width,
    height: displayPrepared.height,
    thumb: null,
  };

  const thumbPrepared = prepared.find((file) => file.name === "thumb");
  const thumb = thumbPrepared ? byName.get(thumbPrepared.filename) : undefined;
  if (thumbPrepared && thumb) {
    image.thumb = {
      url: thumb.url,
      key: thumb.key,
      width: thumbPrepared.width,
      height: thumbPrepared.height,
    };
  }

  return image;
}
