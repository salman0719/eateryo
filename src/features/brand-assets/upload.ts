/**
 * Uploading a brand asset from the owner's browser (`uploadthing/client`).
 * Client-safe: talks HTTP to `/api/uploadthing` and never imports the file
 * router's implementation — only its type.
 *
 * Mirrors `src/features/item-images/upload.ts`: the browser sends the
 * pre-sized copies, the server only authorizes, and the result is the
 * reference stored on the restaurant record. The menu-config and
 * live-preview entry points will call this same function.
 */

import { genUploader } from "uploadthing/client";

import type { OurFileRouter } from "@/app/api/uploadthing/core";
import type { BrandAssetImage, BrandAssetKind } from "./schema";

import { ItemImageError, mapItemImageUploadError } from "@/features/item-images/errors";
import { ItemImagePrepareError } from "@/features/item-images/prepare";
import { prepareBrandAsset, type PreparedBrandAssetVariant } from "./prepare";
import { buildBrandAssetImage } from "./ref";

/**
 * An explicit relative URL keeps the client from guessing the origin from
 * `window`/`VERCEL_URL` and makes the endpoint obvious at the call site.
 */
const { uploadFiles } = genUploader<OurFileRouter>({ url: "/api/uploadthing" });

/**
 * The file router's per-file limit; a prepared copy is far below it. Must
 * stay at or under the `brandAssetImage` route's `maxFileSize`.
 */
const MAX_UPLOADED_BYTES = 4 * 1024 * 1024;

const BRAND_WORDS = {
  notConfigured:
    "Brand photos are not set up on this server yet. Ask the operator to configure photo storage.",
  signIn: "Sign in to add brand photos.",
};

/**
 * Prepare and upload one logo or cover photo. `onProgress` reports 0–100 for
 * the transfer (decoding and resizing happen first and are not a percentage).
 */
export async function uploadBrandAsset(
  file: File,
  kind: BrandAssetKind,
  options: { onProgress?: (percent: number) => void } = {}
): Promise<BrandAssetImage> {
  // One error type leaves the UI: a photo that failed to decode is as much a
  // failed attach as one the host refused.
  let prepared: PreparedBrandAssetVariant[];
  try {
    prepared = await prepareBrandAsset(file, kind);
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
    uploaded = await uploadFiles("brandAssetImage", {
      files,
      // `totalProgress` covers every prepared copy (display + thumb); `progress`
      // is per-file and can exceed 100 because XHR counts multipart framing
      // bytes on top of the file size, so clamp the value the UI prints.
      onUploadProgress: ({ totalProgress }) =>
        options.onProgress?.(Math.min(100, Math.max(0, Math.round(totalProgress)))),
    });
  } catch (error) {
    throw mapItemImageUploadError(error, BRAND_WORDS);
  }

  const image = buildBrandAssetImage(
    prepared.map(({ name, filename, width, height }) => ({ name, filename, width, height })),
    uploaded.map((file) => ({ name: file.name, key: file.key, url: file.ufsUrl }))
  );
  if (!image) {
    throw new ItemImageError("failed", "The upload finished without a usable photo. Try again.");
  }
  return image;
}
