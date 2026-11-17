import { describe, expect, it } from "vitest";

import { dropInsertIndex } from "../src/features/menu/reorder";

const ids = ["a", "b", "c"];

describe("dropInsertIndex", () => {
  it("moves a row down across its target", () => {
    // a dropped after b lands between b and c.
    expect(dropInsertIndex(ids, "a", "b", "after")).toBe(1);
  });

  it("moves a row up across its target", () => {
    // c dropped before a lands first.
    expect(dropInsertIndex(ids, "c", "a", "before")).toBe(0);
  });

  it("drops at the list end by appending", () => {
    expect(dropInsertIndex(ids, "a", null, "after")).toBe(2);
    expect(dropInsertIndex(ids, "b", null, "before")).toBe(2);
  });

  it("returns null when the drop changes nothing", () => {
    // Onto itself, either edge.
    expect(dropInsertIndex(ids, "b", "b", "before")).toBeNull();
    expect(dropInsertIndex(ids, "b", "b", "after")).toBeNull();
    // Onto the neighbour it already precedes or follows.
    expect(dropInsertIndex(ids, "b", "c", "before")).toBeNull();
    expect(dropInsertIndex(ids, "b", "a", "after")).toBeNull();
    // Already last, dropped at the end.
    expect(dropInsertIndex(ids, "c", null, "after")).toBeNull();
  });

  it("throws for unknown ids, matching the move helpers", () => {
    expect(() => dropInsertIndex(ids, "z", "a", "before")).toThrow("Unknown row id: z");
    expect(() => dropInsertIndex(ids, "a", "z", "before")).toThrow("Unknown row id: z");
  });
});
