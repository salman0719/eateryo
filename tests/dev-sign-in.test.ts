import { describe, expect, it, vi } from "vitest";

import { createDevLinkStore, isDevSignInEnabled } from "@/lib/auth/dev-sign-in";

describe("isDevSignInEnabled", () => {
  it("is off unless the flag is set", () => {
    expect(isDevSignInEnabled({})).toBe(false);
    expect(isDevSignInEnabled({ DEV_SIGN_IN_BYPASS: "" })).toBe(false);
    expect(isDevSignInEnabled({ DEV_SIGN_IN_BYPASS: "0" })).toBe(false);
    expect(isDevSignInEnabled({ DEV_SIGN_IN_BYPASS: "nope" })).toBe(false);
  });

  it("accepts the usual on values, case- and space-insensitively", () => {
    expect(isDevSignInEnabled({ DEV_SIGN_IN_BYPASS: "1" })).toBe(true);
    expect(isDevSignInEnabled({ DEV_SIGN_IN_BYPASS: "true" })).toBe(true);
    expect(isDevSignInEnabled({ DEV_SIGN_IN_BYPASS: " Yes " })).toBe(true);
  });

  it("is off in production even when the flag is set", () => {
    expect(isDevSignInEnabled({ NODE_ENV: "production", DEV_SIGN_IN_BYPASS: "1" })).toBe(false);
  });
});

describe("createDevLinkStore", () => {
  const url = "http://localhost:3200/api/auth/magic-link/verify?token=abc";

  it("hands back the link once, for the address that asked", () => {
    const store = createDevLinkStore();
    store.remember("Owner@Cafe.test ", url);
    expect(store.take("owner@cafe.test")).toBe(url);
    expect(store.take("owner@cafe.test")).toBeNull();
  });

  it("refuses a different address", () => {
    const store = createDevLinkStore();
    store.remember("owner@cafe.test", url);
    expect(store.take("someone@else.test")).toBeNull();
    // The refusal does not consume the pending link.
    expect(store.take("owner@cafe.test")).toBe(url);
  });

  it("forgets a link older than the five-minute window", () => {
    let now = 1_000;
    const store = createDevLinkStore(() => now);
    store.remember("owner@cafe.test", url);
    now += 5 * 60 * 1000 + 1;
    expect(store.take("owner@cafe.test")).toBeNull();
  });

  it("keeps only the newest request, and can be cleared", () => {
    const store = createDevLinkStore();
    store.remember("owner@cafe.test", `${url}-old`);
    store.remember("owner@cafe.test", `${url}-new`);
    expect(store.take("owner@cafe.test")).toBe(`${url}-new`);
    store.remember("owner@cafe.test", url);
    store.clear();
    expect(store.take("owner@cafe.test")).toBeNull();
  });
});

describe("the parked link is process-wide", () => {
  const url = "http://localhost:3200/api/auth/magic-link/verify?token=shared";

  /**
   * Next gives every route entrypoint its own module instance, so the auth
   * route that parks the link and `/api/dev/magic-link` that reads it do not
   * share module state. Reloading the module is that split in miniature: the
   * link must still be there, or every local sign-in reports an expired one.
   */
  it("survives a module reload, so the reading route finds the link", async () => {
    const previous = process.env.DEV_SIGN_IN_BYPASS;
    process.env.DEV_SIGN_IN_BYPASS = "1";
    try {
      const parking = await import("@/lib/auth/dev-sign-in");
      await parking.captureDevSignInLink({ email: "owner@cafe.test", url });

      vi.resetModules();
      const reading = await import("@/lib/auth/dev-sign-in");

      expect(reading.takeDevSignInLink("owner@cafe.test")).toBe(url);
      // Still a one-time credential: the second read finds nothing.
      expect(reading.takeDevSignInLink("owner@cafe.test")).toBeNull();
    } finally {
      const cleanup = await import("@/lib/auth/dev-sign-in");
      cleanup.getDevLinkStore().clear();
      if (previous === undefined) delete process.env.DEV_SIGN_IN_BYPASS;
      else process.env.DEV_SIGN_IN_BYPASS = previous;
    }
  });
});
