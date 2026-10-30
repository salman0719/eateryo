/**
 * Uploading a dish photo from the owner's browser (`uploadthing/client`).
 * Client-safe: talks HTTP to `/api/uploadthing` and never imports the file
 * router's implementation — only its type.
 *
 * The bytes go straight from this browser to the file host; our server only
 * authorizes the upload. The result is the reference stored on the menu item:
 * the CDN URL, the file key, and the real pixel size of each copy.
 */

import { genUploader } from "uploadthing/client";

import type { OurFileRouter } from "@/app/api/uploadthing/core";
import type { MenuItemImage } from "@/features/menu/schema";

import { ItemImageError, mapItemImageUploadError } from "./errors";
import { ItemImagePrepareError, prepareItemImage, type PreparedItemImageVariant } from "./prepare";
import { buildMenuItemImage } from "./ref";

/**
 * An explicit relative URL keeps the client from guessing the origin from
 * `window`/`VERCEL_URL` and makes the endpoint obvious at the call site.
 */
const { uploadFiles } = genUploader<OurFileRouter>({ url: "/api/uploadthing" });

/** The file router's per-file limit; a prepared copy is far below it. */
const MAX_UPLOADED_BYTES = 4 * 1024 * 1024;

/**
 * Prepare and upload one dish photo. `onProgress` reports 0–100 for the
 * transfer (decoding and resizing happen first and are not a percentage).
 */
export async function uploadItemImage(
  file: File,
  options: { onProgress?: (percent: number) => void } = {}
): Promise<MenuItemImage> {
  // One error type leaves the UI: a photo that failed to decode is as much a
  // failed attach as one the host refused.
  let prepared: PreparedItemImageVariant[];
  try {
    prepared = await prepareItemImage(file);
  } catch (error) {
    if (error instanceof ItemImagePrepareError) {
      throw new ItemImageError(error.code, error.message);
    }
    throw error;
  }

  const oversized = prepared.find((variant) => variant.blob.size > MAX_UPLOADED_BYTES);
  if (oversized) {
    throw new ItemImageError("too_large", "That photo is too large even after resizing.");
  }

  const files = prepared.map(
    (variant) =>
      new File([variant.blob], variant.filename, { type: variant.blob.type || "image/webp" })
  );

  let uploaded;
  try {
    uploaded = await uploadFiles("menuItemImage", {
      files,
      onUploadProgress: ({ progress }) => options.onProgress?.(Math.round(progress)),
    });
  } catch (error) {
    throw mapItemImageUploadError(error);
  }

  const image = buildMenuItemImage(
    prepared.map(({ name, filename, width, height }) => ({ name, filename, width, height })),
    uploaded.map((file) => ({ name: file.name, key: file.key, url: file.ufsUrl }))
  );
  if (!image) {
    throw new ItemImageError("failed", "The upload finished without a usable photo. Try again.");
  }
  return image;
}
