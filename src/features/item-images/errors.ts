/**
 * Why a dish photo could not be attached, in the owner's terms.
 *
 * The upload client throws its own error shape (`UploadThingError` with a code
 * from the HTTP status), and the file host does not forward our JSON message
 * verbatim — a 503 comes back as a generic "failed with status 503". This
 * module is the one place that turns those shapes into sentences an owner can
 * act on, and it is pure so the mapping is tested rather than guessed.
 *
 * Nothing here repeats a provider message or a credential: the operator-facing
 * detail stays in the server log.
 */

import type { ItemImagePrepareErrorCode } from "./prepare";

export type ItemImageErrorCode =
  | ItemImagePrepareErrorCode
  | "sign_in"
  | "not_configured"
  | "unsupported"
  | "failed";

export class ItemImageError extends Error {
  readonly code: ItemImageErrorCode;

  constructor(code: ItemImageErrorCode, message: string) {
    super(message);
    this.name = "ItemImageError";
    this.code = code;
  }
}

/** The `code` the SDK attaches to a failed request, when it attaches one. */
function uploadedErrorCode(error: unknown): string {
  if (typeof error !== "object" || error === null || !("code" in error)) return "";
  const code = (error as { code: unknown }).code;
  return typeof code === "string" ? code : "";
}

/**
 * The `code` from the response body our own route returned, which the SDK puts
 * on `cause` (it survives even though it does not become the SDK's own code).
 */
function responseBodyCode(error: unknown): string {
  if (typeof error !== "object" || error === null || !("cause" in error)) return "";
  const cause = (error as { cause: unknown }).cause;
  if (typeof cause !== "object" || cause === null || !("error" in cause)) return "";
  const body = (cause as { error: unknown }).error;
  if (typeof body !== "object" || body === null || !("code" in body)) return "";
  const code = (body as { code: unknown }).code;
  return typeof code === "string" ? code : "";
}

/** `... failed with status 503` → "503", when the SDK includes it. */
function statusFromMessage(message: string): string {
  return /status\s+(\d{3})/i.exec(message)?.[1] ?? "";
}

export function mapItemImageUploadError(error: unknown): ItemImageError {
  const code = uploadedErrorCode(error);
  const bodyCode = responseBodyCode(error);
  const message = error instanceof Error ? error.message : "";
  const status = statusFromMessage(message);

  if (bodyCode === "not_configured" || code === "not_configured") {
    return new ItemImageError(
      "not_configured",
      "Dish photos are not set up on this server yet. Ask the operator to configure photo storage."
    );
  }
  if (code === "FORBIDDEN" || code === "UNAUTHORIZED" || status === "403" || status === "401") {
    return new ItemImageError("sign_in", "Sign in to add dish photos to your menu.");
  }
  if (code === "TOO_LARGE" || status === "413") {
    return new ItemImageError("too_large", "That photo is too large to upload. Try a smaller one.");
  }
  if (code === "BAD_REQUEST" || status === "400") {
    return new ItemImageError(
      "unsupported",
      "That file type is not supported. Use a photo (JPEG, PNG, WebP)."
    );
  }
  if (status === "503" || /not set up|UPLOADTHING_TOKEN/i.test(message)) {
    return new ItemImageError(
      "not_configured",
      "Dish photos are not set up on this server yet. Ask the operator to configure photo storage."
    );
  }
  return new ItemImageError(
    "failed",
    "The photo could not be uploaded. Check your connection and try again."
  );
}
