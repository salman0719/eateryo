import { describe, expect, it } from "vitest";

import { ACCOUNT_STAGES, deriveAccountStage, stageIndex } from "@/features/platform/stage";

/**
 * B2 — Reads: list, detail, stage (PGlite, no external services).
 *
 * The plan's list: stage derivation for every branch; counts match the
 * seeded rows; cursor pagination has no duplicates and no gaps; a
 * suspended account still appears with its status; a deleted café does
 * not break the list.
 */

describe("account stage derivation", () => {
  it("reads signed-up when every count is zero", () => {
    expect(
      deriveAccountStage({ cafeCount: 0, menuCount: 0, liveCount: 0, orderCount: 0 })
    ).toBe("signed_up");
  });

  it("reads cafe when only the café exists", () => {
    expect(
      deriveAccountStage({ cafeCount: 1, menuCount: 0, liveCount: 0, orderCount: 0 })
    ).toBe("cafe");
  });

  it("reads menu when a draft exists but nothing is live", () => {
    expect(
      deriveAccountStage({ cafeCount: 1, menuCount: 2, liveCount: 0, orderCount: 0 })
    ).toBe("menu");
  });

  it("reads published when a live pointer exists", () => {
    expect(
      deriveAccountStage({ cafeCount: 1, menuCount: 2, liveCount: 1, orderCount: 0 })
    ).toBe("published");
  });

  it("reads ordering once a first order exists", () => {
    expect(
      deriveAccountStage({ cafeCount: 1, menuCount: 2, liveCount: 1, orderCount: 3 })
    ).toBe("ordering");
  });

  it("prefers the furthest proven step when counts disagree", () => {
    // An order against a café whose menu was since deleted still proves
    // the account reached ordering — history is not unwound.
    expect(
      deriveAccountStage({ cafeCount: 1, menuCount: 0, liveCount: 0, orderCount: 1 })
    ).toBe("ordering");
    expect(
      deriveAccountStage({ cafeCount: 0, menuCount: 2, liveCount: 0, orderCount: 0 })
    ).toBe("menu");
  });

  it("rejects counts that cannot come from the query", () => {
    expect(() =>
      deriveAccountStage({ cafeCount: -1, menuCount: 0, liveCount: 0, orderCount: 0 })
    ).toThrow(RangeError);
    expect(() =>
      deriveAccountStage({ cafeCount: 0, menuCount: 1.5, liveCount: 0, orderCount: 0 })
    ).toThrow(RangeError);
  });

  it("orders the funnel signed-up first and ordering last", () => {
    expect(ACCOUNT_STAGES).toEqual(["signed_up", "cafe", "menu", "published", "ordering"]);
    expect(stageIndex("signed_up")).toBe(0);
    expect(stageIndex("ordering")).toBe(ACCOUNT_STAGES.length - 1);
  });
});
