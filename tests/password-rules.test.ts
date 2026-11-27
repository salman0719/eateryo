import { describe, expect, it } from "vitest";

import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  passwordRuleStatus,
  passwordStrength,
  validateNewPassword,
} from "@/lib/auth/passwords";

/**
 * P2 — the settled password rules, enforced server-side and mirrored in
 * the set-password checklist from the same module. The messages below are
 * the prototype's copy; the order is length, email, common, confirmation.
 */

const EMAIL = "owner@cafe.test";

describe("password rules", () => {
  it("holds the settled bounds", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(10);
    expect(MAX_PASSWORD_LENGTH).toBe(128);
  });

  it("accepts a strong password", () => {
    expect(validateNewPassword("correct horse 9!", "correct horse 9!", EMAIL)).toBeNull();
    expect(passwordRuleStatus("correct horse 9!", EMAIL)).toEqual({
      longEnough: true,
      notEmail: true,
      notCommon: true,
    });
  });

  it("refuses short passwords first", () => {
    expect(validateNewPassword("short1!", "short1!", EMAIL)).toBe("Use at least 10 characters.");
  });

  it("refuses the address and its local part", () => {
    expect(validateNewPassword(EMAIL, EMAIL, EMAIL)).toBe(
      "Your password can't be your email address."
    );
    expect(validateNewPassword("OWNER@CAFE.TEST", "OWNER@CAFE.TEST", EMAIL)).toBe(
      "Your password can't be your email address."
    );
    expect(validateNewPassword("owner", "owner", EMAIL)).toBe("Use at least 10 characters.");
    expect(validateNewPassword("owner-owner1", "owner-owner1", EMAIL)).toBeNull();
  });

  it("refuses commonly used passwords", () => {
    expect(validateNewPassword("password123", "password123", EMAIL)).toBe(
      "That password is too common. Choose another."
    );
    expect(validateNewPassword("QWERTYUIOP", "QWERTYUIOP", EMAIL)).toBe(
      "That password is too common. Choose another."
    );
  });

  it("refuses mismatched confirmation last", () => {
    expect(validateNewPassword("correct horse 9!", "correct horse 8!", EMAIL)).toBe(
      "The two passwords don't match."
    );
  });

  it("refuses overlong passwords", () => {
    const long = "a".repeat(MAX_PASSWORD_LENGTH + 1);
    expect(validateNewPassword(long, long, EMAIL)).toBe("Use at most 128 characters.");
  });

  it("scores strength for the meter without gating", () => {
    expect(passwordStrength("short")).toBe(0);
    expect(passwordStrength("tenletters")).toBe(1);
    expect(passwordStrength("fourteenletters!")).toBe(3);
    expect(passwordStrength("Correct horse 9!")).toBe(4);
  });
});
