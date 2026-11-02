import { describe, expect, it } from "vitest";

import { mapItemImageUploadError } from "@/features/item-images/errors";

/**
 * What an owner is told when a dish photo fails to attach.
 *
 * The cases that matter in practice: the feature not being configured (the
 * host's SDK reports it as a bare status 503, so our own body code has to
 * survive on `cause`), being signed out, an oversized photo, and a file the
 * host refuses. None of them may leak a provider message.
 */

/** The shape the UploadThing client throws for a non-2xx response. */
function sdkError(code: string, status: number, cause: unknown = null) {
  return Object.assign(new Error(`Request to /api/uploadthing failed with status ${status}`), {
    code,
    cause,
  });
}

describe("mapItemImageUploadError", () => {
  it("recognises our own not-configured 503 from the response body", () => {
    const mapped = mapItemImageUploadError(
      sdkError("INTERNAL_SERVER_ERROR", 503, {
        error: { code: "not_configured", message: "Dish photo storage is not set up." },
      })
    );
    expect(mapped.code).toBe("not_configured");
    expect(mapped.message).toMatch(/not set up on this server/i);
  });

  it("treats a bare 503 as not configured", () => {
    expect(mapItemImageUploadError(sdkError("INTERNAL_SERVER_ERROR", 503)).code).toBe(
      "not_configured"
    );
  });

  it("asks the owner to sign in when the session is missing", () => {
    expect(mapItemImageUploadError(sdkError("FORBIDDEN", 403)).code).toBe("sign_in");
    expect(mapItemImageUploadError(sdkError("UNAUTHORIZED", 401)).code).toBe("sign_in");
  });

  it("reports a photo the host considers too large", () => {
    expect(mapItemImageUploadError(sdkError("TOO_LARGE", 413)).code).toBe("too_large");
  });

  it("reports an unsupported file", () => {
    expect(mapItemImageUploadError(sdkError("BAD_REQUEST", 400)).code).toBe("unsupported");
  });

  it("falls back to a retry message for anything else", () => {
    for (const error of [new Error("boom"), null, undefined, "nope"]) {
      const mapped = mapItemImageUploadError(error);
      expect(mapped.code).toBe("failed");
      expect(mapped.message).not.toMatch(/boom|UPLOADTHING_TOKEN|500/);
    }
  });
});
