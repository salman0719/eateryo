/**
 * How big the copies of a dish photo are. Pure geometry, no browser APIs, so
 * the sizing rules are testable without a canvas.
 *
 * Every photo is stored pre-sized: the page then serves it straight from the
 * CDN, and no image optimizer (Vercel's or otherwise) is involved in rendering
 * a menu. Two copies are kept:
 * - `display` — the largest copy we ever serve (longest edge 1024px)
 * - `thumb` — a menu-row copy (longest edge 256px), skipped when the display
 *   copy is already that small, because two identical files help nobody.
 */

/** Largest edge of the copy a diner's page can ever show. */
export const ITEM_IMAGE_DISPLAY_EDGE = 1024;
/** Largest edge of the row thumbnail. */
export const ITEM_IMAGE_THUMB_EDGE = 256;

export type ItemImageVariantName = "display" | "thumb";

export interface PixelSize {
  width: number;
  height: number;
}

export interface ItemImageVariant {
  name: ItemImageVariantName;
  size: PixelSize;
}

/**
 * Scale a photo to fit inside an `edge`-pixel square, keeping its aspect
 * ratio. Never enlarges: a picture smaller than the limit keeps its own
 * pixels rather than being blown up into a blurry copy.
 */
export function fitWithin(size: PixelSize, edge: number): PixelSize {
  const width = Math.max(0, size.width);
  const height = Math.max(0, size.height);
  const longest = Math.max(width, height);
  if (longest <= 0) throw new Error("A photo must have a positive size.");
  if (longest <= edge) return { width: Math.round(width), height: Math.round(height) };
  const scale = edge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** The copies one original needs, in the order they are uploaded. */
export function itemImageVariants(size: PixelSize): ItemImageVariant[] {
  const display = fitWithin(size, ITEM_IMAGE_DISPLAY_EDGE);
  const variants: ItemImageVariant[] = [{ name: "display", size: display }];
  if (Math.max(display.width, display.height) > ITEM_IMAGE_THUMB_EDGE) {
    variants.push({ name: "thumb", size: fitWithin(display, ITEM_IMAGE_THUMB_EDGE) });
  }
  return variants;
}
