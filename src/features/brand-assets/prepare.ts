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
 * Decode one photo and return the copies to upload for the given slot.
 * Throws {@link ItemImagePrepareError} with a message the owner can act on.
 */
export async function prepareBrandAsset(
  file: File,
  kind: BrandAssetKind
): Promise<PreparedBrandAssetVariant[]> {
  if (file.size === 0) {
    throw new ItemImagePrepareError("empty", "That file is empty. Choose another photo.");
  }
  if (file.size > ITEM_IMAGE_MAX_SOURCE_BYTES) {
    throw new ItemImagePrepareError(
      "too_large",
      "That photo is very large (over 20 MB). Resize it or take a new picture."
    );
  }

  let bitmap: ImageBitmap;
  try {
    // Orientation is honoured so a portrait phone photo never arrives sideways.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new ItemImagePrepareError(
      "decode_failed",
      "This photo could not be read in your browser. Try a JPEG, PNG, or WebP."
    );
  }

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
