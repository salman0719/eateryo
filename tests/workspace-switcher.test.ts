import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WorkspaceSwitcher } from "@/components/layout/workspace-switcher";
import { workspaceList } from "@/features/tenancy/workspace";

/**
 * The switcher is the only place a person with two memberships chooses the
 * context. It must stay out of the way when there is no choice, and it must
 * name the active membership so the shell's narrowed controls make sense.
 */
const workspaces = workspaceList([
  { id: "r-own", name: "Riverside", role: "owner" },
  { id: "r-staff", name: "Corner Bakery", role: "staff" },
]);

function render(activeIndex: number | null): string {
  return renderToStaticMarkup(
    createElement(WorkspaceSwitcher, {
      workspaces,
      active: activeIndex === null ? null : (workspaces[activeIndex] ?? null),
      onSwitch: () => undefined,
    })
  );
}

describe("WorkspaceSwitcher", () => {
  it("is absent when the account holds a single membership", () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceSwitcher, {
        workspaces: workspaces.slice(0, 1),
        active: workspaces[0] ?? null,
        onSwitch: () => undefined,
      })
    );
    expect(html).toBe("");
  });

  it("is absent while no membership has been chosen", () => {
    expect(render(null)).toBe("");
  });

  it("lists every membership and marks the active one", () => {
    const html = render(1);
    expect(html).toContain("Acting as");
    expect(html).toContain("Riverside — Owner");
    expect(html).toContain("Corner Bakery — Staff");
    expect(html).toMatch(/value="r-staff"[^>]*selected/);
    expect(html).not.toMatch(/value="r-own"[^>]*selected/);
  });
});
