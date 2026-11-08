import { describe, expect, it } from "vitest";

import {
  defaultSidebarMode,
  parseSidebarMode,
  resolveSidebarMode,
  SIDEBAR_BOOT_SCRIPT,
  SIDEBAR_EXPANDED_MIN_WIDTH,
} from "../src/components/layout/sidebar-preference";

describe("sidebar preference", () => {
  it("accepts only the two real modes", () => {
    expect(parseSidebarMode("rail")).toBe("rail");
    expect(parseSidebarMode("expanded")).toBe("expanded");
    expect(parseSidebarMode("open")).toBeNull();
    expect(parseSidebarMode(null)).toBeNull();
  });

  it("defaults to a rail until there is room for the column", () => {
    expect(defaultSidebarMode(390)).toBe("rail");
    expect(defaultSidebarMode(1024)).toBe("rail");
    expect(defaultSidebarMode(SIDEBAR_EXPANDED_MIN_WIDTH - 1)).toBe("rail");
    expect(defaultSidebarMode(SIDEBAR_EXPANDED_MIN_WIDTH)).toBe("expanded");
    expect(defaultSidebarMode(1600)).toBe("expanded");
  });

  it("lets an explicit choice win at every width", () => {
    expect(resolveSidebarMode({ stored: "expanded", viewportWidth: 900 })).toBe("expanded");
    expect(resolveSidebarMode({ stored: "rail", viewportWidth: 1600 })).toBe("rail");
    expect(resolveSidebarMode({ stored: null, viewportWidth: 1600 })).toBe("expanded");
    expect(resolveSidebarMode({ stored: "junk", viewportWidth: 900 })).toBe("rail");
  });

  it("boot script reads the same key and only applies a valid mode", () => {
    expect(SIDEBAR_BOOT_SCRIPT).toContain("eateryo:sidebar");
    expect(SIDEBAR_BOOT_SCRIPT).toContain('s==="rail"||s==="expanded"');
    expect(SIDEBAR_BOOT_SCRIPT).toContain("setAttribute");
  });
});
