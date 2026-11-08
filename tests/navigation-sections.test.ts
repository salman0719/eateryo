import { describe, expect, it } from "vitest";

import {
  APP_SECTIONS,
  availableSections,
  type SectionAccess,
} from "@/features/navigation/routes";
import { CAPABILITIES, STAFF_CAPABILITIES } from "@/features/tenancy/permissions";

function sectionsFor(overrides: Partial<SectionAccess> = {}) {
  return availableSections({
    signedIn: true,
    can: (capability) => CAPABILITIES.includes(capability),
    assistantEnabled: false,
    hasWorkingSet: false,
    ...overrides,
  });
}

function staffSections(assistantEnabled = true) {
  return availableSections({
    signedIn: true,
    can: (capability) => STAFF_CAPABILITIES.includes(capability),
    assistantEnabled,
    hasWorkingSet: false,
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
      hasWorkingSet: true,
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
        hasWorkingSet: false,
      });
      expect(sections.map((section) => section.id)).toEqual(["tables"]);
    }
  });

  it("is capture-only signed out, plus the working set when drafts exist", () => {
    expect(sectionsFor({ signedIn: false }).map((section) => section.id)).toEqual(["capture"]);
    expect(
      sectionsFor({ signedIn: false, hasWorkingSet: true }).map((section) => section.id)
    ).toEqual(["capture", "library"]);
  });

  it("hides the Assistant while its release flag is off", () => {
    expect(sectionsFor().map((section) => section.id)).not.toContain("assistant");
    expect(staffSections(false).map((section) => section.id)).not.toContain("assistant");
  });
});