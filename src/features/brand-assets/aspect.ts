/**
 * Whether a picked image has the shape its slot wants. Pure geometry — the
 * decision is testable without a canvas, and every surface that picks a brand
 * asset (Settings today, the menu config and live preview later) asks the same
 * question here.
 *
 * Nothing in here blocks an upload. A wrong-shaped photo is a warning the owner
 * can overrule: refusing the only logo they have would be worse than a cropped
 * one, so the caller shows the trade-off and lets them continue.
 */

import type { PixelSize } from "@/features/item-images/sizes";

import type { BrandAssetKind } from "./schema";

/** A logo is squarish: between 3:4 portrait and 4:3 landscape. */
export const BRAND_LOGO_MIN_ASPECT = 3 / 4;
export const BRAND_LOGO_MAX_ASPECT = 4 / 3;

/**
 * A cover is wide-ish: 3:2 or wider. The band is far wider than that, so
 * anything below this is cropped hard rather than trimmed.
 */
export const BRAND_COVER_MIN_ASPECT = 3 / 2;

export interface BrandAssetAspectWarning {
  /** The picked image's width ÷ height. */
  aspect: number;
  /** The shape in words for the message, e.g. `3:4` or `1.8:1`. */
  label: string;
  /** What continuing would cost, in terms the owner can picture. */
  message: string;
}

function greatestCommonDivisor(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y > 0) {
    const remainder = x % y;
    x = y;
    y = remainder;
  }
  return x || 1;
}

/** A short label for an image's shape, readable at a glance. */
export function aspectLabel(size: PixelSize): string {
  const width = Math.max(1, Math.round(size.width));
  const height = Math.max(1, Math.round(size.height));
  const divisor = greatestCommonDivisor(width, height);
  const short = width / divisor;
  const tall = height / divisor;
  // Whole-number shapes read best ("3:4"); an odd crop gets a ratio instead.
  if (short <= 40 && tall <= 40) return `${short}:${tall}`;
  const aspect = width / height;
  const rounded = (value: number) => Number(value.toFixed(2)).toString();
  return aspect >= 1 ? `${rounded(aspect)}:1` : `1:${rounded(1 / aspect)}`;
}

/**
 * Null when the image suits the slot, otherwise the warning to show before the
 * upload starts. A zero-sized image is not an aspect problem — the prepare
 * step already refuses it.
 */
export function brandAssetAspectWarning(
  kind: BrandAssetKind,
  size: PixelSize
): BrandAssetAspectWarning | null {
  if (!(size.width > 0) || !(size.height > 0)) return null;
  const aspect = size.width / size.height;
  const label = aspectLabel(size);

  if (kind === "logo") {
    if (aspect >= BRAND_LOGO_MIN_ASPECT && aspect <= BRAND_LOGO_MAX_ASPECT) return null;
    return {
      aspect,
      label,
      message:
        `That logo is ${label}, not square. The logo sits in a square tile, so it will be ` +
        "cropped to fit and may look distorted. A square image (1:1) looks best.",
    };
  }

  if (aspect >= BRAND_COVER_MIN_ASPECT) return null;
  return {
    aspect,
    label,
    message:
      `That photo is ${label}, not wide. The cover is a wide band, so it will be cropped ` +
      "hard and may look distorted. A photo 3:2 or wider looks best.",
  };
}
