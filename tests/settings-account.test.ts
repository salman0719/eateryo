import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { UsageSummary } from "@/features/usage/schema";

/**
 * R0.5 — the `/launch` cleanup, then the Settings reorder. Export and account
 * deletion moved to Settings as two separate cards (a neutral "Data &
 * privacy" export and the final "Danger zone — delete your account"), and
 * usage sits with the café sections. Static rendering is enough: the gate is
 * a session decision, the nudge is a pure function, and the loading skeleton
 * pins that no usage numbers render before the account data lands.
 */

const sessionState = vi.hoisted(() => ({
  user: null as { id: string; email: string; name: string } | null,
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: sessionState.user ? { user: sessionState.user } : null,
      isPending: false,
    }),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: () => {}, refresh: () => {} }),
}));

import { AccountDangerZone, AccountExportCard } from "@/components/launch/data-controls";
import { UsagePanel, extractNudge } from "@/components/settings/usage-panel";
import LaunchPage from "@/app/launch/page";

function usage(overrides: Partial<UsageSummary> = {}): UsageSummary {
  return {
    periodStart: "2026-10-01T00:00:00.000Z",
    periodEnd: "2026-11-01T00:00:00.000Z",
    requests: 3,
    succeeded: 3,
    failed: 0,
    pages: 5,
    inputTokens: 12000,
    outputTokens: 800,
    costMicros: 1500,
    unpricedRequests: 0,
    cap: 150,
    remaining: 147,
    ratesConfigured: true,
    ...overrides,
  };
}

function signIn() {
  sessionState.user = { id: "u-1", email: "owner@cafe.test", name: "Owner" };
}

describe("extractNudge", () => {
  it("points at capture while free extractions remain", () => {
    expect(extractNudge(usage({ remaining: 147, cap: 150 }))).toEqual({
      href: "/",
      label: "Upload a menu photo",
      body: "147 of 150 free extractions left this month.",
    });
  });

  it("returns null at zero so the panel shows the reset date instead", () => {
    expect(extractNudge(usage({ remaining: 0, requests: 150 }))).toBeNull();
  });
});

describe("account cards sign-in gate", () => {
  it("renders neither card when signed out", () => {
    sessionState.user = null;
    expect(renderToStaticMarkup(createElement(AccountExportCard))).toBe("");
    expect(renderToStaticMarkup(createElement(AccountDangerZone))).toBe("");
  });

  it("keeps export in a neutral card and deletion in the danger zone", () => {
    signIn();
    try {
      const exportHtml = renderToStaticMarkup(createElement(AccountExportCard));
      expect(exportHtml).toContain("Data &amp; privacy");
      expect(exportHtml).toContain("Export my data");
      expect(exportHtml).not.toContain("Delete my account");

      const dangerHtml = renderToStaticMarkup(createElement(AccountDangerZone));
      expect(dangerHtml).toContain("Danger zone — delete your account");
      expect(dangerHtml).toContain("Delete my account");
      expect(dangerHtml).not.toContain("Export my data");
    } finally {
      sessionState.user = null;
    }
  });
});

describe("UsagePanel loading", () => {
  it("skeleton-first: no usage numbers before the account data lands", () => {
    signIn();
    try {
      const html = renderToStaticMarkup(createElement(UsagePanel, { restaurantId: "cafe-1" }));
      expect(html).toContain("Checking your usage");
      expect(html).not.toContain("free extractions used");
    } finally {
      sessionState.user = null;
    }
  });
});

describe("launch page cleanup", () => {
  it("keeps the marketing and checklist entry, without the account sections", () => {
    signIn();
    try {
      const html = renderToStaticMarkup(createElement(LaunchPage));
      expect(html).toContain("Free while it lasts");
      expect(html).not.toContain("Export my data");
      expect(html).not.toContain("Delete my account");
      expect(html).not.toContain("AI extraction this month");
    } finally {
      sessionState.user = null;
    }
  });
});
