/**
 * UploadThing file router for dish photos and brand assets — server-only.
 *
 * A menu item's photo is uploaded straight from the owner's browser to our
 * file host; nothing passes through a server action, and the app never keeps
 * the bytes. The browser sends two pre-sized copies of one picture (see
 * `src/features/item-images/prepare.ts`), which is why this endpoint accepts
 * two files rather than one camera original: the diner's page then renders a
 * plain `<img>` from the CDN and no image optimizer is involved. Brand
 * assets (restaurant logo + cover, see `src/features/brand-assets/`) ride
 * the same pattern through their own route, so a replaced brand file is
 * likewise never deleted here: a published page may still serve the old one.
 *
 * Authorization: every upload requires a signed-in account. The client is
 * never trusted to say who it is — the session is read from the request, and
 * an anonymous uploader gets FORBIDDEN before any presigned URL is minted.
 *
 * Files are never deleted from here: a published revision snapshots documents,
 * so replacing a dish photo on a draft must not break the photo diners are
 * still being served (see `menuItemImageSchema`).
 */

import { createUploadthing, type FileRouter } from "uploadthing/next";
import { UploadThingError } from "uploadthing/server";

import { getSessionUserId } from "@/lib/auth/session";
import { logInfo } from "@/lib/observability/log";

const f = createUploadthing();

/**
 * The largest copy the browser may send. A prepared display copy is a few
 * hundred KB; anything near this limit means the client skipped resizing, not
 * that a café took a bigger photo.
 */
const MAX_FILE_SIZE = "4MB" as const;

/** Session gate shared by both routes: the wording names the asset. */
async function requireSignedIn(message: string): Promise<{ userId: string }> {
  const userId = await getSessionUserId();
  if (!userId) {
    throw new UploadThingError({ code: "FORBIDDEN", message });
  }
  return { userId };
}

export const ourFileRouter = {
  menuItemImage: f({ image: { maxFileSize: MAX_FILE_SIZE, maxFileCount: 2 } })
    .middleware(async () => requireSignedIn("Sign in to add dish photos."))
    .onUploadComplete(async ({ metadata, file }) => {
      logInfo("menu_item_image_uploaded", {
        userId: metadata.userId,
        fileKey: file.key,
        bytes: file.size,
      });
      // Nothing about the account goes back to the browser; it already has the
      // file key and CDN URL from the upload response.
      return {};
    }),
  brandAssetImage: f({ image: { maxFileSize: MAX_FILE_SIZE, maxFileCount: 2 } })
    .middleware(async () => requireSignedIn("Sign in to add brand photos."))
    .onUploadComplete(async ({ metadata, file }) => {
      logInfo("brand_asset_image_uploaded", {
        userId: metadata.userId,
        fileKey: file.key,
        bytes: file.size,
      });
      return {};
    }),
} satisfies FileRouter;

export type OurFileRouter = typeof ourFileRouter;
