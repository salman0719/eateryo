import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CommitTags } from "@/components/menu-editor/fields";

/**
 * 010 — the dietary label field is a tag input. The suite has no jsdom, so
 * these pin what static markup can promise: one chip per diet (a document
 * saved before the change may hold the same label twice), each removable, and
 * a suggestion row that only offers labels the item does not already carry.
 * The add/remove interactions themselves are exercised by the pure helpers
 * (`tests/dietary-labels.test.ts`) plus a browser pass.
 */

function render(value: string[], suggestions: string[]): string {
  return renderToStaticMarkup(
    createElement(CommitTags, {
      label: "Dietary labels",
      value,
      suggestions,
      hint: "Only labels the menu itself shows — never inferred.",
      onCommit: () => {},
    })
  );
}

describe("CommitTags", () => {
  it("renders one removable chip per label and does not offer it again", () => {
    const markup = render(["vegan"], ["vegan", "gluten-free"]);
    expect(markup).toContain(">vegan<");
    expect(markup).toContain("Remove vegan");
    expect(markup).toContain("+ gluten-free");
    expect(markup).not.toContain("+ vegan");
  });

  it("renders a duplicated stored label once", () => {
    const markup = render(["vegan", "vegan"], []);
    expect(markup.match(/>vegan</g)).toHaveLength(1);
    expect(markup.match(/Remove vegan/g)).toHaveLength(1);
  });

  it("keeps a label containing a comma as one chip", () => {
    const markup = render(["vegan, dairy-free"], []);
    expect(markup.match(/>vegan, dairy-free</g)).toHaveLength(1);
    expect(markup).toContain("Remove vegan, dairy-free");
  });

  it("offers no suggestion row when the vocabulary has nothing left", () => {
    const markup = render(["vegan"], ["vegan"]);
    expect(markup).not.toContain("Already used:");
    expect(markup).not.toContain("Matching:");
  });

  it("states the honesty rule under the field", () => {
    expect(render([], [])).toContain("Only labels the menu itself shows");
  });

  it("separates the field name from the key hint with a divider", () => {
    const markup = render([], []);
    expect(markup).toContain(">Dietary labels</span>");
    expect(markup).toContain("w-px self-center bg-stone-300");
    expect(markup).toContain("Press");
    expect(markup).toContain("Enter");
    expect(markup).toContain("Tab");
    expect(markup).toContain("comma");
    expect(markup).toContain("to add");
  });

  it("puts each named key's glyph in a keycap beside it", () => {
    const markup = render([], []);
    expect(markup.match(/<kbd/g)).toHaveLength(3);
    expect(markup).toContain("⏎");
    expect(markup).toContain("⇥");
  });
});
