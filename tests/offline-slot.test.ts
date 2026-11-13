import { describe, expect, it } from "vitest";

import {
  SIGNED_OUT_REPLACE_MESSAGE,
  SIGNED_OUT_SINGLE_MENU_MESSAGE,
  signedOutSlotFull,
} from "@/features/menus/offline-slot";

describe("signedOutSlotFull", () => {
  it("is full when signed out with a menu saved", () => {
    expect(signedOutSlotFull({ signedIn: false, libraryCount: 1 })).toBe(true);
  });

  it("is open when signed out with an empty browser", () => {
    expect(signedOutSlotFull({ signedIn: false, libraryCount: 0 })).toBe(false);
  });

  it("never limits signed-in work, however full the cache", () => {
    expect(signedOutSlotFull({ signedIn: true, libraryCount: 3 })).toBe(false);
    expect(signedOutSlotFull({ signedIn: true, libraryCount: 0 })).toBe(false);
  });

  it("keeps refusal and replacement copy distinct", () => {
    expect(SIGNED_OUT_SINGLE_MENU_MESSAGE).not.toBe(SIGNED_OUT_REPLACE_MESSAGE);
    expect(SIGNED_OUT_SINGLE_MENU_MESSAGE).toMatch(/sign in to publish/i);
    expect(SIGNED_OUT_REPLACE_MESSAGE).toMatch(/replace/i);
  });
});
