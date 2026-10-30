/**
 * Browser-side preparation of a dish photo. Client-only — uses canvas, so it
 * must never be imported from server code.
 *
 * The owner's camera original is never uploaded. It is decoded, drawn into the
 * copies described by `sizes.ts`, and re-encoded, so what reaches the CDN (and
 * therefore a diner's phone) is a few-hundred-KB file at the size the page
 * shows. That is what keeps the page off an image optimizer: the picture is
 * already the right size when it arrives.
 */

import { itemImageVariants, type ItemImageVariantName } from "./sizes";

/**
 * Largest original we are willing to decode. Phone photos land well under
 * this; a file above it is more likely a scan or an export than a dish, and a
 * phone browser should not be asked to hold it in memory.
 */
export const ITEM_IMAGE_MAX_SOURCE_BYTES = 20 * 1024 * 1024;

/** WebP keeps a 1024px dish photo near 100–200 KB at this quality. */
const ENCODE_QUALITY = 0.82;

export type ItemImagePrepareErrorCode = "empty" | "too_large" | "decode_failed";

export class ItemImagePrepareError extends Error {
  readonly code: ItemImagePrepareErrorCode;

  constructor(code: ItemImagePrepareErrorCode, message: string) {
    super(message);
    this.name = "ItemImagePrepareError";
    this.code = code;
  }
}

/** One encoded copy, ready to be handed to the upload client. */
export interface PreparedItemImageVariant {
  name: ItemImageVariantName;
  blob: Blob;
  width: number;
  height: number;
  filename: string;
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpg";
  return "img";
}

async function encodeVariant(bitmap: ImageBitmap, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new ItemImagePrepareError("decode_failed", "Your browser could not prepare this photo.");
  }
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", ENCODE_QUALITY)
  );
  if (!blob) {
    throw new ItemImagePrepareError("decode_failed", "Your browser could not prepare this photo.");
  }
  // Where a browser cannot encode WebP, toBlob falls back to PNG and says so
  // in the blob's own type. The caller names the file from that type, so the
  // name on the CDN never disagrees with the bytes.
  return blob;
}

/**
 * Decode one photo and return the copies to upload. Throws
 * {@link ItemImagePrepareError} with a message the owner can act on.
 */
export async function prepareItemImage(file: File): Promise<PreparedItemImageVariant[]> {
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
    const variants = itemImageVariants({ width: bitmap.width, height: bitmap.height });
    const base = `dish-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    return await Promise.all(
      variants.map(async (variant) => {
        const blob = await encodeVariant(bitmap, variant.size.width, variant.size.height);
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
