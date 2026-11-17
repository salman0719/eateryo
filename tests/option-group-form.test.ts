import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OptionGroupForm } from "../src/components/menu-editor/option-group-form";
import { menuOptionSchema } from "../src/features/menu/schema";

const noop = () => {};

const group = menuOptionSchema.parse({
  name: "Sauce",
  min: 0,
  max: 2,
  choices: [
    { name: "Mayo", priceDelta: 0 },
    { name: "BBQ", priceDelta: 0 },
    { name: "Ranch", priceDelta: 1 },
  ],
});

describe("OptionGroupForm card", () => {
  it("headers the card with the name and derived shape, body open", () => {
    const html = renderToStaticMarkup(
      createElement(OptionGroupForm, {
        group,
        onChange: noop,
        onRemove: noop,
        removeLabel: "Remove option group Sauce",
      })
    );
    expect(html).toContain("Sauce");
    expect(html).toContain("Optional · 0–2 · 3 choices");
    expect(html).toContain('aria-label="Remove option group Sauce"');
    // The body renders its one-row name + min/max, the rule sentence,
    // and the choices.
    expect(html).toContain("Option group");
    expect(html).toContain("Min");
    expect(html).toContain("Max");
    expect(html).toContain("Optional — diners may skip this.");
    expect(html).toContain("Mayo");
    expect(html).not.toContain("Check");
  });

  it("badges an empty group and warns inside", () => {
    const html = renderToStaticMarkup(
      createElement(OptionGroupForm, {
        group: { ...group, choices: [] },
        onChange: noop,
        onRemove: noop,
        removeLabel: "Remove option group Sauce",
      })
    );
    expect(html).toContain("Optional · 0–2 · 0 choices");
    expect(html).toContain("Check");
    expect(html).toContain("No choices yet");
  });
});
