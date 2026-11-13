import { describe, expect, it } from "vitest";

import {
  accountReadState,
  decideLocalDraftClaim,
  decideLocalDraftClaimSurface,
  decidePublishJourneyClaim,
  deriveClaimGate,
  resolveAutoClaimTarget,
  resumeBannerReady,
} from "@/features/menus/claim-local-drafts";

/**
 * R1 claim rules: sign-in auto-imports every unseen browser draft, whether
 * or not the account already holds menus. There are no remembered answers:
 * every sign-in evaluates the live rows. Storage failures must never lose
 * a draft.
 */

const NEW_ACCOUNT = {
  localCount: 2,
  accountMenuCount: 0,
  restaurantCount: 0,
  ownedRestaurantCount: 0,
};

describe("decideLocalDraftClaim", () => {
  it("auto-imports for a brand-new account", () => {
    expect(decideLocalDraftClaim(NEW_ACCOUNT)).toBe("auto-import");
  });

  it("does nothing without browser-only menus", () => {
    expect(decideLocalDraftClaim({ ...NEW_ACCOUNT, localCount: 0 })).toBe("none");
  });

  it("auto-imports even when the account already has menus", () => {
    // No offer banner: sign-in claims every unseen draft in one go, and the
    // import target reuses the owned café rather than minting a new one.
    expect(
      decideLocalDraftClaim({
        ...NEW_ACCOUNT,
        accountMenuCount: 3,
        restaurantCount: 1,
        ownedRestaurantCount: 1,
      })
    ).toBe("auto-import");
  });

  it("auto-imports when the account holds no menus, even with a restaurant", () => {
    // "Auto-import" says nothing about *creating* a café — where the import
    // lands is resolveAutoClaimTarget's job (and it reuses an owned one).
    expect(
      decideLocalDraftClaim({ ...NEW_ACCOUNT, restaurantCount: 1, ownedRestaurantCount: 1 })
    ).toBe("auto-import");
  });

  it("stays quiet for staff-only accounts, who have nowhere to import", () => {
    expect(
      decideLocalDraftClaim({
        ...NEW_ACCOUNT,
        accountMenuCount: 4,
        restaurantCount: 1,
        ownedRestaurantCount: 0,
      })
    ).toBe("none");
  });

  it("swallows the browser on a shared device: whoever signs in owns what was there", () => {
    // No fork, no queue — the first sign-in adopts the drafts, marked so
    // they never render signed out again.
    expect(decideLocalDraftClaim(NEW_ACCOUNT)).toBe("auto-import");
  });
});

describe("decidePublishJourneyClaim", () => {
  const JOURNEY = {
    signedIn: true,
    mayFile: true,
    journeyDraftLocal: true,
    alreadyClaimed: false,
  };

  it("attaches the journey draft with no prior-menu check", () => {
    // The emailed link is consent for that menu: prior account menus,
    // remembered answers, and café count never enter this decision.
    expect(decidePublishJourneyClaim(JOURNEY)).toBe(true);
  });

  it("stays out when there is nothing local to attach", () => {
    expect(decidePublishJourneyClaim({ ...JOURNEY, journeyDraftLocal: false })).toBe(false);
  });

  it("never files twice, signs out, or files without a writable home", () => {
    expect(decidePublishJourneyClaim({ ...JOURNEY, alreadyClaimed: true })).toBe(false);
    expect(decidePublishJourneyClaim({ ...JOURNEY, signedIn: false })).toBe(false);
    expect(decidePublishJourneyClaim({ ...JOURNEY, mayFile: false })).toBe(false);
  });
});

describe("resolveAutoClaimTarget", () => {
  const OWNED = { id: "rest-1", name: "Sunny Side Café" };

  it("reuses the café the account already owns", () => {
    // The bug: an owned café with no menus yet used to get a second café
    // minted next to it, without the owner asking.
    expect(resolveAutoClaimTarget([OWNED], ["Sunny Side Café — Lunch"])).toEqual({
      kind: "reuse",
      restaurantId: "rest-1",
      restaurantName: "Sunny Side Café",
    });
  });

  it("creates a café named from the drafts when the account owns none", () => {
    expect(resolveAutoClaimTarget([], ["My Café — Lunch Menu", "My Café — Dinner Menu"])).toEqual({
      kind: "create",
      name: "My Café",
    });
  });

  it("falls back to a plain name when the drafts name no place", () => {
    expect(resolveAutoClaimTarget([], ["Main Menu"])).toEqual({
      kind: "create",
      name: "My restaurant",
    });
  });

  it("reuses rather than guesses a name, whatever the drafts are called", () => {
    expect(resolveAutoClaimTarget([OWNED], [])).toMatchObject({ kind: "reuse" });
    expect(resolveAutoClaimTarget([OWNED], ["Main Menu"])).toMatchObject({ kind: "reuse" });
  });
});

/**
 * 002: an account read that *failed* must not look like one still in flight.
 * The gate settles either way, but a failure may never be read as "the
 * account holds nothing" — that would push a browser's drafts at a server
 * that did not answer.
 */
describe("claim gate", () => {
  const accountKey = "user-a";

  function claimInputs(overrides: Partial<Parameters<typeof decideLocalDraftClaim>[0]> = {}) {
    return {
      localCount: 2,
      accountMenuCount: 0,
      restaurantCount: 0,
      ownedRestaurantCount: 0,
      ...overrides,
    };
  }

  it("reads a marker for another account as still loading", () => {
    expect(accountReadState({ accountKey, settledFor: null, failedFor: null })).toBe("loading");
    expect(accountReadState({ accountKey, settledFor: "user-b", failedFor: null })).toBe("loading");
    expect(accountReadState({ accountKey, settledFor: accountKey, failedFor: null })).toBe("ready");
    expect(accountReadState({ accountKey, settledFor: null, failedFor: accountKey })).toBe(
      "failed"
    );
    // A later success outranks the old failure.
    expect(accountReadState({ accountKey, settledFor: accountKey, failedFor: accountKey })).toBe(
      "ready"
    );
  });

  it("stays pending while any read is in flight", () => {
    expect(
      deriveClaimGate({
        sessionPending: true,
        signedIn: false,
        menus: "ready",
        restaurants: "ready",
      })
    ).toEqual({ pending: true, incomplete: false });
    expect(
      deriveClaimGate({
        sessionPending: false,
        signedIn: true,
        menus: "ready",
        restaurants: "loading",
      })
    ).toEqual({ pending: true, incomplete: false });
  });

  it("settles as incomplete when a read failed, and as open when both are in", () => {
    expect(
      deriveClaimGate({
        sessionPending: false,
        signedIn: true,
        menus: "failed",
        restaurants: "ready",
      })
    ).toEqual({ pending: false, incomplete: true });
    expect(
      deriveClaimGate({
        sessionPending: false,
        signedIn: true,
        menus: "ready",
        restaurants: "ready",
      })
    ).toEqual({ pending: false, incomplete: false });
    // Signed out settles immediately, and a remembered failure is not news.
    expect(
      deriveClaimGate({
        sessionPending: false,
        signedIn: false,
        menus: "failed",
        restaurants: "failed",
      })
    ).toEqual({ pending: false, incomplete: false });
  });

  it("never auto-imports on an unknown account", () => {
    const claim = claimInputs();
    // Same inputs that would auto-import on a settled, empty account…
    expect(
      decideLocalDraftClaimSurface({
        gate: { pending: false, incomplete: false },
        signedIn: true,
        claim,
      })
    ).toBe("auto-import");
    // …are "unavailable" while a read is missing, never "auto-import".
    expect(
      decideLocalDraftClaimSurface({
        gate: { pending: false, incomplete: true },
        signedIn: true,
        claim,
      })
    ).toBe("unavailable");
    expect(
      decideLocalDraftClaimSurface({
        gate: { pending: true, incomplete: false },
        signedIn: true,
        claim,
      })
    ).toBe("pending");
  });

  it("keeps the ordinary decisions and the signed-out case", () => {
    const gate = deriveClaimGate({
      sessionPending: false,
      signedIn: true,
      menus: "ready",
      restaurants: "ready",
    });
    expect(
      decideLocalDraftClaimSurface({
        gate,
        signedIn: true,
        claim: claimInputs({ accountMenuCount: 3, ownedRestaurantCount: 1 }),
      })
    ).toBe("auto-import");
    expect(
      decideLocalDraftClaimSurface({ gate, signedIn: true, claim: claimInputs({ localCount: 0 }) })
    ).toBe("none");
    expect(decideLocalDraftClaimSurface({ gate, signedIn: false, claim: claimInputs() })).toBe(
      "none"
    );
  });
});

/**
 * 017 — the resume banner's copy ("“X” is saved in this browser, not published
 * yet") is read off the account's id set, which is empty after a failed read
 * just as it is before one. It speaks only on a list that answered, or with no
 * account to wait for.
 */
describe("resumeBannerReady", () => {
  const open = { pending: false, incomplete: false };
  const failed = { pending: false, incomplete: true };

  it("waits for the browser library, whatever else is known", () => {
    expect(
      resumeBannerReady({
        libraryLoading: true,
        gate: open,
        signedIn: true,
        accountMenusSettled: true,
      })
    ).toBe(false);
    expect(
      resumeBannerReady({
        libraryLoading: true,
        gate: open,
        signedIn: false,
        accountMenusSettled: false,
      })
    ).toBe(false);
  });

  it("waits while either account read is still in flight", () => {
    expect(
      resumeBannerReady({
        libraryLoading: false,
        gate: { pending: true, incomplete: false },
        signedIn: true,
        accountMenusSettled: false,
      })
    ).toBe(false);
  });

  it("speaks signed out: the library is the whole truth", () => {
    expect(
      resumeBannerReady({
        libraryLoading: false,
        gate: open,
        signedIn: false,
        accountMenusSettled: false,
      })
    ).toBe(true);
  });

  it("speaks for a signed-in account whose menu list answered", () => {
    expect(
      resumeBannerReady({
        libraryLoading: false,
        gate: open,
        signedIn: true,
        accountMenusSettled: true,
      })
    ).toBe(true);
    // The restaurant read is not part of this banner's claim: it needs the
    // menu list to tell a draft from an account menu, and nothing more.
    expect(
      resumeBannerReady({
        libraryLoading: false,
        gate: failed,
        signedIn: true,
        accountMenusSettled: true,
      })
    ).toBe(true);
  });

  it("stays quiet when the menu list failed — it cannot tell an account menu from a draft", () => {
    expect(
      resumeBannerReady({
        libraryLoading: false,
        gate: failed,
        signedIn: true,
        accountMenusSettled: false,
      })
    ).toBe(false);
  });
});
