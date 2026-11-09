import { describe, expect, it } from "vitest";

import {
  accessCan,
  accessIsStaff,
  menuAccessById,
  restaurantCapabilities,
  type MenuAccess,
} from "@/features/tenancy/access";
import type { MembershipAccess } from "@/features/menus/sync";

const owner: MembershipAccess = {
  role: "owner",
  capabilities: ["menus.read", "menus.read_draft", "menus.write", "menus.publish"],
};
const staff: MembershipAccess = {
  role: "staff",
  capabilities: ["orders.read", "orders.update", "menus.read"],
};

describe("menuAccessById", () => {
  it("indexes each menu by id", () => {
    const byId = menuAccessById([
      { id: "m1", access: owner },
      { id: "m2", access: staff },
    ]);
    expect(byId.get("m1")).toEqual(owner);
    expect(byId.get("m2")).toEqual(staff);
  });

  it("returns an empty map for an empty list", () => {
    expect(menuAccessById([]).size).toBe(0);
  });
});

describe("accessCan", () => {
  it("answers from the capabilities the server sent", () => {
    expect(accessCan(owner, "menus.write")).toBe(true);
    expect(accessCan(staff, "menus.write")).toBe(false);
    expect(accessCan(staff, "orders.update")).toBe(true);
  });

  it("treats an unanswered or refused menu as no permission", () => {
    expect(accessCan(undefined, "menus.write")).toBe(false);
    expect(accessCan("none", "menus.read")).toBe(false);
  });

  it("treats a browser-only menu as the caller's own", () => {
    expect(accessCan("local", "menus.write")).toBe(true);
    expect(accessCan("local", "menus.publish")).toBe(true);
  });

  it("honours explicit staff grants, not the role", () => {
    const editor: MembershipAccess = {
      role: "staff",
      capabilities: ["menus.read", "menus.read_draft", "menus.write"],
    };
    expect(accessCan(editor, "menus.write")).toBe(true);
    expect(accessCan(editor, "menus.publish")).toBe(false);
  });
});

describe("restaurantCapabilities", () => {
  it("uses the server's answer when one was sent", () => {
    expect(restaurantCapabilities({ role: "staff", access: owner })).toEqual(owner.capabilities);
  });

  it("falls back to role defaults, never to a write grant", () => {
    const staffCaps = restaurantCapabilities({ role: "staff" });
    expect(staffCaps).toContain("orders.read");
    expect(staffCaps).not.toContain("menus.write");
    expect(restaurantCapabilities({ role: "owner" })).toContain("menus.write");
  });
});

describe("accessIsStaff", () => {
  it("recognises a staff answer only", () => {
    expect(accessIsStaff(staff)).toBe(true);
    expect(accessIsStaff(owner)).toBe(false);
  });

  it("is false for local, refused, and unanswered menus", () => {
    const access: (MenuAccess | undefined)[] = ["local", "none", undefined];
    expect(access.map(accessIsStaff)).toEqual([false, false, false]);
  });
});
