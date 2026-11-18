import { describe, expect, it } from "vitest";

import {
  decideMenuOpen,
  decideSessionState,
  isSessionGateMessage,
  menuOpenBlockedMessage,
  sessionAnswerPending,
  sessionLoaderCovers,
  type SessionRead,
} from "@/features/session/state";

/**
 * 015: reloading a menu URL read as signed out because "the session has not
 * answered yet" and "the server said nobody" were the same value. These pin
 * the distinction and the access matrix it feeds.
 */
describe("session state", () => {
  it("treats a read in flight as unknown, not signed out", () => {
    // Better Auth's first observable state on every page load.
    expect(decideSessionState({ hasUser: false, pending: true, error: null })).toBe("unknown");
    // And again when a refetch reopens the question, even after a 401.
    expect(decideSessionState({ hasUser: false, pending: true, error: { status: 401 } })).toBe(
      "unknown"
    );
  });

  it("only calls an answered empty read a sign-out", () => {
    expect(decideSessionState({ hasUser: false, pending: false, error: null })).toBe("signed-out");
  });

  it("reads the client's 401 as that empty answer, not as a failure", () => {
    expect(decideSessionState({ hasUser: false, pending: false, error: { status: 401 } })).toBe(
      "signed-out"
    );
  });

  it("never turns a failed read into a sign-out", () => {
    expect(decideSessionState({ hasUser: false, pending: false, error: { status: 500 } })).toBe(
      "unknown"
    );
    expect(
      decideSessionState({ hasUser: false, pending: false, error: new TypeError("offline") })
    ).toBe("unknown");
  });

  it("believes a session it already has over any error or refetch", () => {
    expect(decideSessionState({ hasUser: true, pending: true, error: { status: 500 } })).toBe(
      "signed-in"
    );
  });
});

describe("session hint", () => {
  it("stops waiting for a browser that holds no session hint", () => {
    expect(sessionAnswerPending({ state: "unknown", hint: "none" })).toBe(false);
  });

  it("waits while a hint says a session may exist", () => {
    expect(sessionAnswerPending({ state: "unknown", hint: "hinted" })).toBe(true);
  });

  it("waits when the hint has not been read yet — the prerendered frame", () => {
    expect(sessionAnswerPending({ state: "unknown", hint: "unknown" })).toBe(true);
  });

  it("never holds once the read has answered", () => {
    expect(sessionAnswerPending({ state: "signed-in", hint: "hinted" })).toBe(false);
    expect(sessionAnswerPending({ state: "signed-out", hint: "hinted" })).toBe(false);
  });
});

describe("session loader", () => {
  /** A settled visitor: nothing is out, so nothing is covered. */
  const settled = {
    sessionPending: false,
    sessionCheckGaveUp: false,
    signedIn: false,
    workspacePending: false,
    workspaceFailed: false,
    libraryLoading: false,
  };

  it("covers the shell while the session read is still out", () => {
    expect(sessionLoaderCovers({ ...settled, sessionPending: true })).toBe(true);
  });

  it("keeps covering until the café and the library have answered too", () => {
    expect(sessionLoaderCovers({ ...settled, signedIn: true, workspacePending: true })).toBe(true);
    expect(sessionLoaderCovers({ ...settled, signedIn: true, libraryLoading: true })).toBe(true);
  });

  it("never covers a visitor, and lifts once the account is settled", () => {
    expect(sessionLoaderCovers(settled)).toBe(false);
    expect(sessionLoaderCovers({ ...settled, signedIn: true })).toBe(false);
  });

  it("hands a failed café read to the shell, which offers a retry", () => {
    // The café list stays `null` after a failure, so `pending` never goes
    // false on its own: waiting on it would spin forever.
    expect(
      sessionLoaderCovers({
        ...settled,
        signedIn: true,
        workspacePending: true,
        workspaceFailed: true,
      })
    ).toBe(false);
  });

  it("hands a session read that gave up to the shell's own card", () => {
    expect(
      sessionLoaderCovers({ ...settled, sessionPending: true, sessionCheckGaveUp: true })
    ).toBe(false);
  });
});

describe("menu access", () => {
  const me = "acct_me";
  const someoneElse = "acct_other";

  it("waits — never blocks — while the session is unknown", () => {
    expect(decideMenuOpen({ session: "unknown", stampAccountId: me, accountKey: null })).toEqual({
      state: "wait",
    });
    expect(
      decideMenuOpen({ session: "unknown", stampAccountId: someoneElse, accountKey: me })
    ).toEqual({ state: "wait" });
    expect(decideMenuOpen({ session: "unknown", stampAccountId: null, accountKey: null })).toEqual({
      state: "wait",
    });
  });

  it("opens the caller's own stamped menu once the session settles", () => {
    expect(decideMenuOpen({ session: "signed-in", stampAccountId: me, accountKey: me })).toEqual({
      state: "open",
    });
  });

  it("opens anonymous drafts to anyone, signed in or out", () => {
    expect(
      decideMenuOpen({ session: "signed-in", stampAccountId: undefined, accountKey: me })
    ).toEqual({ state: "open" });
    expect(decideMenuOpen({ session: "signed-out", stampAccountId: "", accountKey: null })).toEqual(
      {
        state: "open",
      }
    );
  });

  it("keeps the privacy wall for a stamped row with nobody known to own it", () => {
    expect(decideMenuOpen({ session: "signed-out", stampAccountId: me, accountKey: null })).toEqual(
      {
        state: "blocked",
        reason: "signed-out",
      }
    );
  });

  it("opens a published menu the server listed, even under another account's stamp", () => {
    expect(
      decideMenuOpen({
        session: "signed-in",
        stampAccountId: someoneElse,
        accountKey: me,
        sharedPublished: true,
      })
    ).toEqual({ state: "open" });
    expect(
      decideMenuOpen({
        session: "signed-in",
        stampAccountId: someoneElse,
        accountKey: me,
        sharedPublished: false,
      })
    ).toEqual({ state: "blocked", reason: "other-account" });
  });

  it("waits for the account menu read before refusing another account's row", () => {
    expect(
      decideMenuOpen({
        session: "signed-in",
        stampAccountId: someoneElse,
        accountKey: me,
        accountReadPending: true,
      })
    ).toEqual({ state: "wait" });
    expect(
      decideMenuOpen({
        session: "signed-in",
        stampAccountId: someoneElse,
        accountKey: me,
        accountReadPending: false,
      })
    ).toEqual({ state: "blocked", reason: "other-account" });
  });

  it("keeps a row that belongs to another account on this device shut", () => {
    expect(
      decideMenuOpen({ session: "signed-in", stampAccountId: someoneElse, accountKey: me })
    ).toEqual({ state: "blocked", reason: "other-account" });
  });

  it("says what is true, with the action that follows", () => {
    expect(menuOpenBlockedMessage("signed-out")).toContain("on this device");
    expect(menuOpenBlockedMessage("signed-out")).toContain("sign in");
    expect(menuOpenBlockedMessage("other-account")).toContain("different account");
  });

  it("recognises only its own sentences, so recovery clears nothing else", () => {
    expect(isSessionGateMessage(menuOpenBlockedMessage("signed-out"))).toBe(true);
    expect(isSessionGateMessage(menuOpenBlockedMessage("other-account"))).toBe(true);
    expect(isSessionGateMessage("Storage unavailable — edits are kept in memory only.")).toBe(
      false
    );
    expect(isSessionGateMessage(null)).toBe(false);
  });

  it("does not refuse a reload: the real load sequence only ever waits", () => {
    // The states Better Auth's atom publishes on a fresh load of a menu URL,
    // in order (session-atom.mjs: initial, first fetch in flight, session).
    // Before the fix the second state already read as "signed out", which is
    // what posted the ownership wall and bounced to My menus.
    const loadSequence: SessionRead[] = [
      { hasUser: false, pending: true, error: null },
      { hasUser: false, pending: true, error: null },
      { hasUser: true, pending: false, error: null },
    ];
    const decisions = loadSequence.map((read) =>
      decideMenuOpen({
        session: decideSessionState(read),
        stampAccountId: me,
        accountKey: read.hasUser ? me : null,
      })
    );
    expect(decisions).toEqual([{ state: "wait" }, { state: "wait" }, { state: "open" }]);
    expect(decisions.some((decision) => decision.state === "blocked")).toBe(false);
  });
});
