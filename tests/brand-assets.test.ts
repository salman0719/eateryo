import { beforeAll, describe, expect, it } from "vitest";

import {
  aspectLabel,
  BRAND_COVER_MIN_ASPECT,
  BRAND_LOGO_MAX_ASPECT,
  BRAND_LOGO_MIN_ASPECT,
  brandAssetAspectWarning,
} from "@/features/brand-assets/aspect";
import {
  BRAND_COVER_DISPLAY_EDGE,
  BRAND_LOGO_DISPLAY_EDGE,
  brandAssetVariants,
} from "@/features/brand-assets/sizes";
import { brandAssetCopy, brandAssetKey, buildBrandAssetImage } from "@/features/brand-assets/ref";
import {
  brandAssetImageSchema,
  brandAssetKindSchema,
  type BrandAssetImage,
} from "@/features/brand-assets/schema";
import {
  createRestaurant,
  getRestaurantForUser,
  setRestaurantBrandAssetsForOwner,
} from "@/features/tenancy/repo";
import { createTestDb, seedUser, type TestDb } from "./helpers/pg-test-db";

const LOGO: BrandAssetImage = {
  url: "https://cdn.test/brand-logo-display.webp",
  key: "brand-logo-key",
  width: 512,
  height: 512,
  thumb: {
    url: "https://cdn.test/brand-logo-thumb.webp",
    key: "brand-logo-thumb-key",
    width: 256,
    height: 256,
  },
};

const COVER: BrandAssetImage = {
  url: "https://cdn.test/brand-cover-display.webp",
  key: "brand-cover-key",
  width: 1600,
  height: 762,
  thumb: null,
};

describe("brand asset copies", () => {
  it("sizes the cover for the diner band and the logo for a tile", () => {
    const cover = brandAssetVariants("cover", { width: 2400, height: 1143 });
    expect(cover[0]).toMatchObject({
      name: "display",
      size: { width: BRAND_COVER_DISPLAY_EDGE, height: 762 },
    });

    const logo = brandAssetVariants("logo", { width: 1024, height: 1024 });
    expect(logo[0]).toMatchObject({
      name: "display",
      size: { width: BRAND_LOGO_DISPLAY_EDGE, height: BRAND_LOGO_DISPLAY_EDGE },
    });
  });

  it("keeps the aspect ratio and never enlarges a small source", () => {
    const small = brandAssetVariants("cover", { width: 200, height: 100 });
    expect(small[0]).toMatchObject({ name: "display", size: { width: 200, height: 100 } });
    // Already at thumb scale: no second copy of the same picture.
    expect(small).toHaveLength(1);

    // A display copy above thumb scale still gets its row-sized copy.
    expect(brandAssetVariants("logo", { width: 1024, height: 1024 })).toHaveLength(2);
  });

  it("builds the reference by file name, never by upload order", () => {
    const image = buildBrandAssetImage(
      [
        { name: "display", filename: "brand-logo-display.webp", width: 512, height: 512 },
        { name: "thumb", filename: "brand-logo-thumb.webp", width: 256, height: 256 },
      ],
      [
        // Host answers thumb first.
        { name: "brand-logo-thumb.webp", key: "brand-logo-thumb-key", url: LOGO.thumb!.url },
        { name: "brand-logo-display.webp", key: LOGO.key, url: LOGO.url },
      ]
    );
    expect(image).toMatchObject({ url: LOGO.url, key: LOGO.key });
    expect(image?.thumb).toMatchObject({ url: LOGO.thumb!.url });
  });

  it("refuses a broken upload without a display copy", () => {
    expect(
      buildBrandAssetImage(
        [{ name: "display", filename: "brand-logo-display.webp", width: 512, height: 512 }],
        []
      )
    ).toBeNull();
  });

  it("serves the thumbnail when one was uploaded", () => {
    expect(brandAssetCopy(LOGO)).toMatchObject({ url: LOGO.thumb!.url });
    expect(brandAssetCopy(COVER)).toMatchObject({ url: COVER.url });
    expect(brandAssetCopy(null)).toBeNull();
  });

  it("identifies the photo by its stored key", () => {
    expect(brandAssetKey(LOGO)).toBe(LOGO.key);
    expect(brandAssetKey(null)).toBeNull();
  });
});

describe("brand asset shape warnings", () => {
  it("accepts a squarish logo and a wide cover without a word", () => {
    expect(brandAssetAspectWarning("logo", { width: 512, height: 512 })).toBeNull();
    // 3:4 and 4:3 are the edges of "squarish" and both pass.
    expect(brandAssetAspectWarning("logo", { width: 900, height: 1200 })).toBeNull();
    expect(brandAssetAspectWarning("logo", { width: 1200, height: 900 })).toBeNull();
    expect(brandAssetAspectWarning("cover", { width: 2400, height: 1000 })).toBeNull();
    // 3:2 is the floor for a cover.
    expect(brandAssetAspectWarning("cover", { width: 3000, height: 2000 })).toBeNull();
  });

  it("warns about a tall logo but still describes the file", () => {
    const warning = brandAssetAspectWarning("logo", { width: 1000, height: 1500 });
    expect(warning).toMatchObject({ aspect: 2 / 3, label: "2:3" });
    expect(warning?.message).toContain("square tile");
    expect(warning?.message).toContain("2:3");
  });

  it("warns about a cover that is not wide enough", () => {
    const warning = brandAssetAspectWarning("cover", { width: 1200, height: 1600 });
    expect(warning).toMatchObject({ label: "3:4" });
    expect(warning?.message).toContain("wide band");

    // Just under the 3:2 floor is still flagged; just over it is not.
    expect(brandAssetAspectWarning("cover", { width: 1499, height: 1000 })).not.toBeNull();
    expect(
      brandAssetAspectWarning("cover", {
        width: Math.ceil(BRAND_COVER_MIN_ASPECT * 1000),
        height: 1000,
      })
    ).toBeNull();
  });

  it("flags a wide logo just past the squarish range", () => {
    expect(
      brandAssetAspectWarning("logo", {
        width: Math.floor(BRAND_LOGO_MAX_ASPECT * 1000) + 5,
        height: 1000,
      })
    ).not.toBeNull();
    expect(
      brandAssetAspectWarning("logo", {
        width: Math.floor(BRAND_LOGO_MIN_ASPECT * 1000) - 5,
        height: 1000,
      })
    ).not.toBeNull();
  });

  it("labels odd shapes as a ratio rather than a huge fraction", () => {
    expect(aspectLabel({ width: 1200, height: 1600 })).toBe("3:4");
    expect(aspectLabel({ width: 1600, height: 900 })).toBe("16:9");
    expect(aspectLabel({ width: 1001, height: 999 })).toBe("1:1");
    expect(aspectLabel({ width: 2000, height: 873 })).toBe("2.29:1");
  });

  it("does not invent an aspect problem for a zero-sized image", () => {
    expect(brandAssetAspectWarning("logo", { width: 0, height: 0 })).toBeNull();
    expect(brandAssetAspectWarning("cover", { width: 0, height: 500 })).toBeNull();
  });
});

describe("brand asset schema", () => {
  it("accepts a stored logo or cover", () => {
    expect(brandAssetImageSchema.parse(LOGO)).toEqual(LOGO);
    expect(brandAssetImageSchema.parse(COVER)).toEqual(COVER);
  });

  it("rejects non-https URLs that could point an <img> anywhere", () => {
    expect(() =>
      brandAssetImageSchema.parse({ ...LOGO, url: "http://cdn.test/logo.webp" })
    ).toThrow();
    expect(() => brandAssetImageSchema.parse({ ...LOGO, url: "javascript:alert(1)" })).toThrow();
  });

  it("knows the two brand slots", () => {
    expect(brandAssetKindSchema.options).toEqual(["logo", "cover"]);
  });
});

describe("restaurant brand assets", () => {
  let db: TestDb;
  let owner: string;
  let staff: string;
  let outsider: string;
  let restaurantId: string;

  beforeAll(async () => {
    ({ db } = await createTestDb());
    owner = await seedUser(db, "brand-owner@cafe.test", "Owner");
    staff = await seedUser(db, "brand-staff@cafe.test", "Staff");
    outsider = await seedUser(db, "brand-outsider@cafe.test", "Outsider");
    const created = await createRestaurant(db, owner, "Brand Café");
    restaurantId = created.id;
    const { restaurantMembership } = await import("@/lib/db/schema");
    await db.insert(restaurantMembership).values({ restaurantId, userId: staff, role: "staff" });
  }, 30_000);

  it("starts with no brand assets", async () => {
    const fetched = await getRestaurantForUser(db, owner, restaurantId);
    expect(fetched).toMatchObject({ logo: null, cover: null });
  });

  it("lets an owner set the logo and cover independently", async () => {
    const withLogo = await setRestaurantBrandAssetsForOwner(db, owner, restaurantId, {
      logo: LOGO,
    });
    expect(withLogo).toMatchObject({ logo: LOGO, cover: null });

    const withBoth = await setRestaurantBrandAssetsForOwner(db, owner, restaurantId, {
      cover: COVER,
    });
    expect(withBoth).toMatchObject({ logo: LOGO, cover: COVER });
  });

  it("clears one slot with null while the other survives", async () => {
    const cleared = await setRestaurantBrandAssetsForOwner(db, owner, restaurantId, {
      logo: null,
    });
    expect(cleared).toMatchObject({ logo: null, cover: COVER });
  });

  it("refuses staff and outsiders without leaking the row", async () => {
    expect(
      await setRestaurantBrandAssetsForOwner(db, staff, restaurantId, { logo: LOGO })
    ).toBeNull();
    expect(
      await setRestaurantBrandAssetsForOwner(db, outsider, restaurantId, { logo: LOGO })
    ).toBeNull();

    // And the owner's assets are untouched.
    const fetched = await getRestaurantForUser(db, owner, restaurantId);
    expect(fetched).toMatchObject({ logo: null, cover: COVER });
  });
});
