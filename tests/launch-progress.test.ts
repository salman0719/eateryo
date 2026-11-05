import { describe, expect, it } from "vitest";

import { launchProgress } from "@/features/launch/progress";
import type { LaunchSnapshot } from "@/features/launch/schema";

function snapshot(overrides: Partial<LaunchSnapshot> = {}): LaunchSnapshot {
  return {
    menuCount: 0,
    publishedCount: 0,
    orderCount: 0,
    unpricedItems: 0,
    reviewNotes: 0,
    unreadableMenus: 0,
    ...overrides,
  };
}

describe("launchProgress", () => {
  it("counts the manual print step among the five", () => {
    expect(launchProgress(snapshot(), false)).toEqual({ done: 0, total: 5, complete: false });
  });

  it("leaves the checklist open when every server step is done but cards are unticked", () => {
    const progress = launchProgress(
      snapshot({ menuCount: 1, publishedCount: 1, orderCount: 1 }),
      false
    );
    expect(progress).toEqual({ done: 4, total: 5, complete: false });
  });

  it("completes only once the table cards are ticked too", () => {
    const progress = launchProgress(
      snapshot({ menuCount: 1, publishedCount: 1, orderCount: 1 }),
      true
    );
    expect(progress).toEqual({ done: 5, total: 5, complete: true });
  });

  it("keeps the review step open while items are unpriced or flagged", () => {
    const progress = launchProgress(
      snapshot({ menuCount: 1, publishedCount: 1, orderCount: 1, unpricedItems: 2 }),
      true
    );
    expect(progress).toEqual({ done: 4, total: 5, complete: false });
  });
});
