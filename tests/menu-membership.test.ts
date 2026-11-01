import { describe, expect, it } from "vitest";

import { decideMenuMembership, membershipFlag } from "@/features/menus/membership";

/**
 * 003 — the editor said "Saved in this browser" on the first frame of every
 * account menu, and offered "Add it to your account" for a menu the account
 * already held, because an empty id set meant "not read yet" and "not on the
 * account" at once. This is that decision, with the answers kept apart.
 *
 * 016 — a read that *failed* was folded into "not on the account", which is
 * the same false claim once the account does hold the menu, so the failure is
 * its own answer.
 */

describe("decideMenuMembership", () => {
  it("is browser-only for a signed-out visitor, whatever the list says", () => {
    // No account exists to hold the menu, so nothing has to be waited for.
    expect(
      decideMenuMembership({
        signedIn: false,
        readSettled: false,
        readFailed: false,
        onServer: false,
      })
    ).toBe("browser");
    expect(
      decideMenuMembership({
        signedIn: false,
        readSettled: true,
        readFailed: true,
        onServer: false,
      })
    ).toBe("browser");
  });

  it("is unknown while the account's menu list has not answered", () => {
    expect(
      decideMenuMembership({
        signedIn: true,
        readSettled: false,
        readFailed: false,
        onServer: false,
      })
    ).toBe("unknown");
  });

  it("names the membership a settled read proved", () => {
    expect(
      decideMenuMembership({ signedIn: true, readSettled: true, readFailed: false, onServer: true })
    ).toBe("account");
    expect(
      decideMenuMembership({ signedIn: true, readSettled: true, readFailed: false, onServer: false })
    ).toBe("browser");
  });

  it("trusts one menu's own proof over an unread list", () => {
    // A deep link syncs the menu before the list lands; that is already an
    // answer about this menu, so it must never render as still checking.
    expect(
      decideMenuMembership({ signedIn: true, readSettled: false, readFailed: false, onServer: true })
    ).toBe("account");
  });

  it("names a failed read instead of claiming the browser", () => {
    expect(
      decideMenuMembership({ signedIn: true, readSettled: true, readFailed: true, onServer: false })
    ).toBe("unreachable");
  });

  it("lets a menu's own proof outrank a failed list read", () => {
    // Its id is already known, so the failure says nothing about it.
    expect(
      decideMenuMembership({ signedIn: true, readSettled: true, readFailed: true, onServer: true })
    ).toBe("account");
  });
});

describe("membershipFlag", () => {
  it("maps the answers onto the boolean-or-null the UI takes", () => {
    expect(membershipFlag("account")).toBe(true);
    expect(membershipFlag("browser")).toBe(false);
    expect(membershipFlag("unknown")).toBeNull();
    // "I couldn't check" is not a storage location either; the surfaces that
    // must tell it from a wait take the failure as their own prop (016).
    expect(membershipFlag("unreachable")).toBeNull();
  });
});
