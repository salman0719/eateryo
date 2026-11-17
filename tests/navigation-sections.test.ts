import { describe, expect, it } from "vitest";

import {
  APP_SECTIONS,
  availableSections,
  sectionTabLabel,
  type SectionAccess,
} from "@/features/navigation/routes";
import { CAPABILITIES, STAFF_CAPABILITIES } from "@/features/tenancy/permissions";

function sectionsFor(overrides: Partial<SectionAccess> = {}) {
  return availableSections({
    signedIn: true,
    can: (capability) => CAPABILITIES.includes(capability),
    assistantEnabled: false,
    ...overrides,
  });
}

function staffSections(assistantEnabled = true) {
  return availableSections({
    signedIn: true,
    can: (capability) => STAFF_CAPABILITIES.includes(capability),
    assistantEnabled,
  });
}

describe("the navigation table", () => {
  it("names a capability for every section", () => {
    for (const section of APP_SECTIONS) {
      expect(section.capabilities.length).toBeGreaterThan(0);
    }
  });

  it("contains each destination exactly once", () => {
    const ids = APP_SECTIONS.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("availableSections", () => {
  it("gives a staff shift exactly the sections its capabilities allow", () => {
    expect(staffSections().map((section) => section.id)).toEqual([
      "library",
      "orders",
      "assistant",
      "tables",
      "settings",
    ]);
  });

  it("never offers Capture without menus.write", () => {
    expect(staffSections().map((section) => section.id)).not.toContain("capture");
    // A member whose only grant is draft reading still cannot capture.
    const reader = availableSections({
      signedIn: true,
      can: (capability) => capability === "menus.read",
      assistantEnabled: false,
    });
    expect(reader.map((section) => section.id)).toEqual(["library"]);
  });

  it("lets an owner into every section its capabilities name", () => {
    expect(sectionsFor({ assistantEnabled: true }).map((section) => section.id)).toEqual([
      "capture",
      "library",
      "orders",
      "assistant",
      "tables",
      "settings",
    ]);
  });

  it("opens Tables with either of its two grants", () => {
    for (const capability of ["tables.print", "tables.link"] as const) {
      const sections = availableSections({
        signedIn: true,
        can: (grant) => grant === capability,
        assistantEnabled: false,
      });
      expect(sections.map((section) => section.id)).toEqual(["tables"]);
    }
  });

  it("is capture-only signed out, whatever this browser holds", () => {
    // No My menus, no Orders, no More sheet: a signed-out draft is resumed
    // from the capture banner rather than browsed in a library.
    expect(sectionsFor({ signedIn: false }).map((section) => section.id)).toEqual(["capture"]);
    expect(
      sectionsFor({
        signedIn: false,
        can: () => true,
        assistantEnabled: true,
      }).map((section) => section.id)
    ).toEqual(["capture"]);
  });

  it("hides the Assistant while its release flag is off", () => {
    expect(sectionsFor().map((section) => section.id)).not.toContain("assistant");
    expect(staffSections(false).map((section) => section.id)).not.toContain("assistant");
  });
});

describe("sectionTabLabel", () => {
  const library = APP_SECTIONS.find((section) => section.id === "library")!;
  const orders = APP_SECTIONS.find((section) => section.id === "orders")!;

  it("names the active café's count once it is known", () => {
    expect(sectionTabLabel(library, 1)).toBe("My menus (1)");
  });

  it("keeps the plain label while the count is unresolved", () => {
    expect(sectionTabLabel(library, null)).toBe("My menus");
  });

  it("does not print a zero", () => {
    expect(sectionTabLabel(library, 0)).toBe("My menus");
  });

  it("leaves the other sections alone", () => {
    expect(sectionTabLabel(orders, 3)).toBe("Orders");
  });
});
