import { describe, expect, it } from "vitest";

import { mapAccountStatus } from "@/features/payments/repo";

/**
 * The `requirements.pending_verification` trap (2026-11-21): a fresh café
 * account that just finished onboarding has charges on, payouts still
 * verifying, details submitted — and that must read `active`, never
 * `restricted`. Payouts pending never blocks a charge.
 */

describe("mapAccountStatus", () => {
  it("treats charges-on with payouts pending as active, not paused", () => {
    expect(
      mapAccountStatus({ chargesEnabled: true, payoutsEnabled: false, detailsSubmitted: true })
    ).toBe("active");
  });

  it("treats fully capable accounts as active", () => {
    expect(
      mapAccountStatus({ chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true })
    ).toBe("active");
  });

  it("treats a submitted account that still cannot charge as restricted", () => {
    expect(
      mapAccountStatus({ chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: true })
    ).toBe("restricted");
  });

  it("treats an unsubmitted account as still onboarding", () => {
    expect(
      mapAccountStatus({ chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false })
    ).toBe("pending");
    expect(
      mapAccountStatus({ chargesEnabled: null, payoutsEnabled: null, detailsSubmitted: null })
    ).toBe("pending");
  });
});
