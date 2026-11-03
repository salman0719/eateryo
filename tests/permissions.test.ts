import { describe, expect, it } from "vitest";

import {
  CAPABILITIES,
  capabilitiesForMembership,
  hasCapability,
  PERMISSION_PRESETS,
  STAFF_CAPABILITIES,
} from "@/features/tenancy/permissions";

describe("membership capabilities", () => {
  it("gives an owner every capability", () => {
    expect(capabilitiesForMembership("owner", [])).toEqual([...CAPABILITIES]);
    expect(capabilitiesForMembership("owner", ["orders.read"])).toEqual([...CAPABILITIES]);
  });

  it("gives plain staff today's read-only set", () => {
    const capabilities = capabilitiesForMembership("staff", []);
    expect(capabilities).toEqual([...STAFF_CAPABILITIES]);
    expect(hasCapability(capabilities, "menus.read")).toBe(true);
    expect(hasCapability(capabilities, "orders.update")).toBe(true);
    // Drafts are an explicit grant, never a staff default.
    expect(hasCapability(capabilities, "menus.read_draft")).toBe(false);
    for (const write of [
      "menus.write",
      "menus.publish",
      "tables.link",
      "team.manage",
      "settings.manage",
    ] as const) {
      expect(hasCapability(capabilities, write)).toBe(false);
    }
  });

  it("treats a non-empty override as the member's full staff grant", () => {
    const capabilities = capabilitiesForMembership("staff", PERMISSION_PRESETS["orders-only"]);
    expect(capabilities).toEqual([...PERMISSION_PRESETS["orders-only"]]);
    expect(hasCapability(capabilities, "menus.read")).toBe(false);
  });

  it("lets a manager preset publish and manage tables but not members", () => {
    const capabilities = capabilitiesForMembership("staff", PERMISSION_PRESETS.manager);
    expect(hasCapability(capabilities, "menus.publish")).toBe(true);
    expect(hasCapability(capabilities, "tables.link")).toBe(true);
    expect(hasCapability(capabilities, "team.manage")).toBe(false);
    expect(hasCapability(capabilities, "settings.manage")).toBe(false);
  });

  it("ignores unknown strings, duplicates, and input order", () => {
    const capabilities = capabilitiesForMembership("staff", [
      "menus.publish",
      "not.a.capability",
      "orders.read",
      "menus.publish",
    ]);
    expect(capabilities).toEqual(["orders.read", "menus.publish"]);
  });

  it("has no duplicate capability in the vocabulary", () => {
    expect(new Set(CAPABILITIES).size).toBe(CAPABILITIES.length);
  });
});
