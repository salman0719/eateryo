import { describe, expect, it } from "vitest";

import { decideMenuMembership, membershipFlag } from "@/features/menus/membership";

/**
 * 003 — the editor said "Saved in this browser" on the first frame of every
 * account menu, and offered "Add it to your account" for a menu the account
 * already held, because an empty id set meant "not read yet" and "not on the
 * account" at once. This is that decision, with the three answers kept apart.
 */

describe("decideMenuMembership", () => {
  it("is browser-only for a signed-out visitor, whatever the list says", () => {
    // No account exists to hold the menu, so nothing has to be waited for.
    expect(
      decideMenuMembership({ signedIn: false, readSettled: false, onServer: false })
    ).toBe("browser");
    expect(
      decideMenuMembership({ signedIn: false, readSettled: true, onServer: false })
    ).toBe("browser");
  });

  it("is unknown while the account's menu list has not answered", () => {
    expect(
      decideMenuMembership({ signedIn: true, readSettled: false, onServer: false })
    ).toBe("unknown");
  });

  it("names the membership a settled read proved", () => {
    expect(decideMenuMembership({ signedIn: true, readSettled: true, onServer: true })).toBe(
      "account"
    );
    expect(decideMenuMembership({ signedIn: true, readSettled: true, onServer: false })).toBe(
      "browser"
    );
  });

  it("trusts one menu's own proof over an unread list", () => {
    // A deep link syncs the menu before the list lands; that is already an
    // answer about this menu, so it must never render as still checking.
    expect(decideMenuMembership({ signedIn: true, readSettled: false, onServer: true })).toBe(
      "account"
    );
  });
});

describe("membershipFlag", () => {
  it("maps the three answers onto the boolean-or-null the UI takes", () => {
    expect(membershipFlag("account")).toBe(true);
    expect(membershipFlag("browser")).toBe(false);
    expect(membershipFlag("unknown")).toBeNull();
  });
});
