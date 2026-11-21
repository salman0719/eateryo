/**
 * Browser-side preparation of a brand asset. Client-only — uses canvas, so it
 * must never be imported from server code.
 *
 * Same contract as a dish photo (`src/features/item-images/prepare.ts`): the
 * camera original is never uploaded, only the pre-sized copies. It reuses the
 * dish pipeline's source limit, error taxonomy, and canvas encoder, so owner-
 * facing failures read identically and only the copy sizes (and the `brand-`
 * file prefix, which keeps the dish-photo sweep from touching these files)
 * are brand-specific.
 */

import {
  encodeBitmapToWebP,
  ITEM_IMAGE_MAX_SOURCE_BYTES,
  ItemImagePrepareError,
  type PreparedItemImageVariant,
} from "@/features/item-images/prepare";
import type { PixelSize } from "@/features/item-images/sizes";

import { brandAssetVariants } from "./sizes";
import type { BrandAssetKind } from "./schema";

/**
 * One encoded copy, ready to be handed to the upload client. Structurally a
 * dish variant — the stored-copy matcher (`ref.ts`) works on both.
 */
export type PreparedBrandAssetVariant = PreparedItemImageVariant;

function extensionForMimeType(mimeType: string): string {
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpg";
  return "img";
}

/**
 * Check the source and decode it. Both public entry points share this so the
 * size limits and the decode message never diverge.
 */
async function decodeBrandAsset(file: File): Promise<ImageBitmap> {
  if (file.size === 0) {
    throw new ItemImagePrepareError("empty", "That file is empty. Choose another photo.");
  }
  if (file.size > ITEM_IMAGE_MAX_SOURCE_BYTES) {
    throw new ItemImagePrepareError(
      "too_large",
      "That photo is very large (over 20 MB). Resize it or take a new picture."
    );
  }

  try {
    // Orientation is honoured so a portrait phone photo never arrives sideways.
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new ItemImagePrepareError(
      "decode_failed",
      "This photo could not be read in your browser. Try a JPEG, PNG, or WebP."
    );
  }
}

/**
 * The picked image's pixel size, for the shape check before an upload. Decodes
 * and closes the bitmap, so the owner pays for one decode here and the prepare
 * step's own decode when they continue.
 */
export async function readBrandAssetSize(file: File): Promise<PixelSize> {
  const bitmap = await decodeBrandAsset(file);
  try {
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

/**
 * Decode one photo and return the copies to upload for the given slot.
 * Throws {@link ItemImagePrepareError} with a message the owner can act on.
 */
export async function prepareBrandAsset(
  file: File,
  kind: BrandAssetKind
): Promise<PreparedBrandAssetVariant[]> {
  const bitmap = await decodeBrandAsset(file);

  try {
    const variants = brandAssetVariants(kind, { width: bitmap.width, height: bitmap.height });
    const base = `brand-${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    return await Promise.all(
      variants.map(async (variant) => {
        const blob = await encodeBitmapToWebP(bitmap, variant.size.width, variant.size.height);
        return {
          name: variant.name,
          blob,
          width: variant.size.width,
          height: variant.size.height,
          filename: `${base}-${variant.name}.${extensionForMimeType(blob.type)}`,
        };
      })
    );
  } finally {
    bitmap.close();
  }
}
