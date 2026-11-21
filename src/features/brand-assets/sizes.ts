import {
  fitWithin,
  ITEM_IMAGE_THUMB_EDGE,
  type ItemImageVariant,
  type PixelSize,
} from "@/features/item-images/sizes";

import type { BrandAssetKind } from "./schema";

/**
 * How big the copies of a brand asset are. Same geometry as dish photos —
 * {@link fitWithin} keeps the aspect ratio and never enlarges — only the
 * display edge differs per slot:
 * - `logo` (512px): a settings tile / diner monogram at 2x, with room for a
 *   future small header lockup.
 * - `cover` (1600px): the diner cover band (at most ~896px wide) at ~2x.
 * Both keep the 256px thumb for small rows, skipped when the display copy
 * is already that small.
 */
export const BRAND_LOGO_DISPLAY_EDGE = 512;
export const BRAND_COVER_DISPLAY_EDGE = 1600;

export function brandAssetDisplayEdge(kind: BrandAssetKind): number {
  return kind === "logo" ? BRAND_LOGO_DISPLAY_EDGE : BRAND_COVER_DISPLAY_EDGE;
}

/** The copies one upload needs, in the order they are uploaded. */
export function brandAssetVariants(kind: BrandAssetKind, size: PixelSize): ItemImageVariant[] {
  const display = fitWithin(size, brandAssetDisplayEdge(kind));
  const variants: ItemImageVariant[] = [{ name: "display", size: display }];
  if (Math.max(display.width, display.height) > ITEM_IMAGE_THUMB_EDGE) {
    variants.push({ name: "thumb", size: fitWithin(display, ITEM_IMAGE_THUMB_EDGE) });
  }
  return variants;
}
