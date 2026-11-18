import { describe, expect, it } from "vitest";

import {
  filterBoardOrders,
  formatElapsed,
  groupBoardOrders,
  isInBoardWindow,
  isNewHot,
  matchesBoardSearch,
} from "@/features/orders/board-filters";
import type { Order } from "@/features/orders/schema";

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: "ord-9f2a1c",
    menuId: "menu-1",
    menuTitle: "Main Menu",
    tableLabel: "3",
    currency: "USD",
    note: null,
    lines: [
      {
        menuItemId: "m-pizza",
        name: "Margherita Pizza",
        variantName: null,
        options: [],
        unitPrice: 12.5,
        quantity: 2,
        menuId: "menu-1",
        menuTitle: "Main Menu",
      },
    ],
    status: "new",
    createdAt: new Date("2026-11-18T12:00:00Z").toISOString(),
    updatedAt: new Date("2026-11-18T12:00:00Z").toISOString(),
    ...overrides,
  };
}

const NOON = new Date("2026-11-18T12:00:00Z").getTime();

describe("board window", () => {
  it("keeps the default 24h window and reveals older tickets on All", () => {
    const recent = order({ id: "recent", createdAt: new Date(NOON - 60_000).toISOString() });
    const old = order({
      id: "old",
      createdAt: new Date(NOON - 26 * 60 * 60 * 1000).toISOString(),
    });
    expect(isInBoardWindow(recent, "24h", NOON)).toBe(true);
    expect(isInBoardWindow(old, "24h", NOON)).toBe(false);
    expect(isInBoardWindow(old, "all", NOON)).toBe(true);
  });
});

describe("board search", () => {
  it("matches table, dish, and short code", () => {
    const sample = order({ tableLabel: "Patio 2" });
    expect(matchesBoardSearch(sample, "")).toBe(true);
    expect(matchesBoardSearch(sample, "patio")).toBe(true);
    expect(matchesBoardSearch(sample, "margherita")).toBe(true);
    expect(matchesBoardSearch(sample, "9f2a1c")).toBe(true);
    expect(matchesBoardSearch(sample, "ramen")).toBe(false);
  });
});

describe("board filter + grouping", () => {
  it("hides done on request and groups new / preparing / done", () => {
    const orders = [
      order({ id: "a", status: "new" }),
      order({ id: "b", status: "preparing" }),
      order({ id: "c", status: "served" }),
      order({ id: "d", status: "cancelled" }),
    ];
    const visible = filterBoardOrders(
      orders,
      { window: "24h", query: "", hideDone: true },
      NOON
    );
    expect(visible.map((entry) => entry.id)).toEqual(["a", "b"]);
    const grouped = groupBoardOrders(
      filterBoardOrders(orders, { window: "24h", query: "", hideDone: false }, NOON)
    );
    expect(grouped.fresh.map((entry) => entry.id)).toEqual(["a"]);
    expect(grouped.preparing.map((entry) => entry.id)).toEqual(["b"]);
    expect(grouped.done.map((entry) => entry.id)).toEqual(["c", "d"]);
  });
});

describe("elapsed + hot", () => {
  it("formats short elapsed labels and flags stale new tickets", () => {
    expect(formatElapsed(new Date(NOON - 4 * 60_000).toISOString(), NOON)).toBe("4m");
    expect(formatElapsed(new Date(NOON - 125 * 60_000).toISOString(), NOON)).toBe("2h 5m");
    expect(
      isNewHot(order({ createdAt: new Date(NOON - 25 * 60_000).toISOString() }), NOON)
    ).toBe(true);
    expect(
      isNewHot(order({ createdAt: new Date(NOON - 5 * 60_000).toISOString() }), NOON)
    ).toBe(false);
    expect(
      isNewHot(
        order({ status: "preparing", createdAt: new Date(NOON - 60 * 60_000).toISOString() }),
        NOON
      )
    ).toBe(false);
  });
});
