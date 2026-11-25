import { z } from "zod";

import { menuItemImageSchema, type MenuItemImage } from "@/features/menu/schema";

/**
 * Brand assets — the restaurant logo and cover photo (Settings step).
 *
 * Deliberately the same stored shape and pipeline as a dish photo: two
 * pre-sized copies uploaded from the browser, rendered later as a plain
 * `<img>` from the CDN with `object-fit: cover` — never `next/image`.
 * The page therefore needs no new uploader, no new file host, and no new
 * optimizer exemption; the menu-config and live-preview entry points reuse
 * this module unchanged.
 *
 * Old files are never deleted on replace/remove: a published page may still
 * be serving the previous asset until the owner republishes (same rule as
 * dish photos). A focal point / crop control is a later step — until then
 * the stored pixels stay whole and the render crops.
 */
export const brandAssetImageSchema = menuItemImageSchema;

/** A stored logo or cover photo on the restaurant record. */
export type BrandAssetImage = MenuItemImage;

/** Which brand slot an upload targets. */
export const brandAssetKindSchema = z.enum(["logo", "cover"]);

export type BrandAssetKind = z.infer<typeof brandAssetKindSchema>;
