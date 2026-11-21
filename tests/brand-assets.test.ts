import { beforeAll, describe, expect, it } from "vitest";

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
