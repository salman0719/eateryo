import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * Wrong-password regression — a failed `twoFactor.enable` (wrong password)
 * carries no `totpUri` and must stay on the password form. Otherwise the
 * setup UI advances to an empty verify step: no QR, no key, and `Copy key`
 * copies nothing. Static rendering pins the initial step; the `active`
 * gate is a pure function of status, so the error branches pin directly.
 */

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    twoFactor: {
      enable: async () => ({ data: null, error: { message: "Invalid password" } }),
      verifyTotp: async () => ({ data: null, error: { message: "Invalid code" } }),
    },
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
}));

import {
  activeEnrolmentForStatus,
  SetupTwoFactorForm,
} from "@/components/auth/setup-two-factor-form";

describe("SetupTwoFactorForm wrong-password gate", () => {
  it("starts on the password step, never the verify form", () => {
    const html = renderToStaticMarkup(createElement(SetupTwoFactorForm, { callbackURL: "/admin" }));
    expect(html).toContain("Confirm your password");
    expect(html).toContain("Start setup");
    expect(html).not.toContain("Authentication code");
    expect(html).not.toContain("Copy key");
  });

  it("a failed enable without a URI stays on the password step", () => {
    expect(activeEnrolmentForStatus({ kind: "error", message: "Invalid password" })).toBeNull();
  });

  it("a verify error keeps the URI so the key and QR stay visible", () => {
    const totpUri = "otpauth://totp/Eateryo?secret=JBSWY3DPEHPK3PXP&issuer=Eateryo";
    expect(
      activeEnrolmentForStatus({
        kind: "error",
        message: "That code didn't work.",
        totpUri,
        backupCodes: ["aaa", "bbb"],
      })
    ).toEqual({ totpUri, backupCodes: ["aaa", "bbb"] });
  });
});
