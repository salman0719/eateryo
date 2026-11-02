import { describe, expect, it } from "vitest";

import { buildMenuItemImage } from "@/features/item-images/ref";
import {
  fitWithin,
  itemImageVariants,
  ITEM_IMAGE_DISPLAY_EDGE,
  ITEM_IMAGE_THUMB_EDGE,
} from "@/features/item-images/sizes";

/**
 * How a dish photo is pre-sized, and how the file host's reply becomes the
 * reference a menu item stores.
 *
 * These are the rules that keep the diner's page off an image optimizer: an
 * uploaded copy is never larger than the page shows, never enlarged from a
 * smaller original, and the display copy is always the one attached — never
 * the thumbnail, whichever order the host answers in.
 */

describe("fitWithin", () => {
  it("scales the longest edge and keeps the aspect ratio", () => {
    expect(fitWithin({ width: 4000, height: 3000 }, 1024)).toEqual({ width: 1024, height: 768 });
    expect(fitWithin({ width: 3000, height: 4000 }, 1024)).toEqual({ width: 768, height: 1024 });
  });

  it("never enlarges a smaller photo", () => {
    expect(fitWithin({ width: 300, height: 200 }, 1024)).toEqual({ width: 300, height: 200 });
  });

  it("keeps a very wide photo at least one pixel tall", () => {
    const size = fitWithin({ width: 8000, height: 6 }, 1024);
    expect(size.width).toBe(1024);
    expect(size.height).toBeGreaterThanOrEqual(1);
  });

  it("refuses an empty size", () => {
    expect(() => fitWithin({ width: 0, height: 0 }, 1024)).toThrow();
  });
});

describe("itemImageVariants", () => {
  it("plans a display copy and a thumbnail for a camera photo", () => {
    const variants = itemImageVariants({ width: 4032, height: 3024 });
    expect(variants).toEqual([
      { name: "display", size: { width: 1024, height: 768 } },
      { name: "thumb", size: { width: 256, height: 192 } },
    ]);
    expect(ITEM_IMAGE_DISPLAY_EDGE).toBe(1024);
    expect(ITEM_IMAGE_THUMB_EDGE).toBe(256);
  });

  it("skips the thumbnail when the picture is already thumbnail-sized", () => {
    expect(itemImageVariants({ width: 240, height: 180 })).toEqual([
      { name: "display", size: { width: 240, height: 180 } },
    ]);
  });
});

describe("buildMenuItemImage", () => {
  const prepared = [
    { name: "display" as const, filename: "dish-a-display.webp", width: 1024, height: 768 },
    { name: "thumb" as const, filename: "dish-a-thumb.webp", width: 256, height: 192 },
  ];

  it("attaches the display copy and keeps the thumbnail beside it", () => {
    const image = buildMenuItemImage(prepared, [
      { name: "dish-a-thumb.webp", key: "thumb-key", url: "https://abc123.ufs.sh/f/thumb-key" },
      {
        name: "dish-a-display.webp",
        key: "display-key",
        url: "https://abc123.ufs.sh/f/display-key",
      },
    ]);

    expect(image).toEqual({
      url: "https://abc123.ufs.sh/f/display-key",
      key: "display-key",
      width: 1024,
      height: 768,
      thumb: {
        url: "https://abc123.ufs.sh/f/thumb-key",
        key: "thumb-key",
        width: 256,
        height: 192,
      },
    });
  });

  it("stores no thumbnail when only the display copy was made", () => {
    const image = buildMenuItemImage(
      [{ name: "display", filename: "dish-b-display.webp", width: 240, height: 180 }],
      [{ name: "dish-b-display.webp", key: "k", url: "https://abc123.ufs.sh/f/k" }]
    );
    expect(image?.thumb).toBeNull();
  });

  it("reports an unusable reply instead of inventing a photo", () => {
    expect(
      buildMenuItemImage(prepared, [
        { name: "dish-a-thumb.webp", key: "thumb-key", url: "https://abc123.ufs.sh/f/thumb-key" },
      ])
    ).toBeNull();
  });
});
