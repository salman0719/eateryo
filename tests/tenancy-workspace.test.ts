import { describe, expect, it } from "vitest";

import type { MembershipAccess } from "@/features/menus/sync";
import {
  readStoredWorkspaceKey,
  resolveActiveWorkspace,
  workspaceCan,
  workspaceLabel,
  workspaceList,
  workspaceStorageKey,
  writeStoredWorkspaceKey,
  type WorkspaceStore,
} from "@/features/tenancy/workspace";

const ownerAccess: MembershipAccess = {
  role: "owner",
  capabilities: ["menus.read", "menus.read_draft", "menus.write", "menus.publish"],
};
const staffAccess: MembershipAccess = {
  role: "staff",
  capabilities: ["orders.read", "orders.update", "menus.read"],
};

const ownedCafe = {
  id: "r-own",
  name: "Joe's",
  role: "owner" as const,
  access: ownerAccess,
};
const staffCafe = {
  id: "r-staff",
  name: "Corner Bakery",
  role: "staff" as const,
  access: staffAccess,
};

/** A tiny in-memory store, so persistence is testable without a browser. */
function fakeStore(initial: Record<string, string> = {}): WorkspaceStore {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe("workspaceList", () => {
  it("keeps the server's capabilities and the membership's identity", () => {
    const [owned, staff] = workspaceList([ownedCafe, staffCafe]);
    expect(owned).toEqual({
      key: "r-own",
      restaurantId: "r-own",
      name: "Joe's",
      role: "owner",
      capabilities: ownerAccess.capabilities,
    });
    expect(staff?.capabilities).toEqual(staffAccess.capabilities);
  });

  it("falls back to the role's defaults, never to a write grant", () => {
    const [staff] = workspaceList([
      { id: "r-staff", name: "Corner Bakery", role: "staff" },
    ]);
    expect(staff?.capabilities).toContain("orders.read");
    expect(staff?.capabilities).not.toContain("menus.write");
  });

  it("maps an empty account to nothing to act in", () => {
    expect(workspaceList([])).toEqual([]);
  });
});

describe("resolveActiveWorkspace", () => {
  const workspaces = workspaceList([staffCafe, ownedCafe]);

  it("honours the remembered membership", () => {
    expect(resolveActiveWorkspace(workspaces, "r-staff")?.key).toBe("r-staff");
  });

  it("lands on the owned café when nothing is remembered", () => {
    expect(resolveActiveWorkspace(workspaces, null)?.key).toBe("r-own");
  });

  it("ignores a choice that no longer exists, instead of acting as nobody", () => {
    expect(resolveActiveWorkspace(workspaces, "r-gone")?.key).toBe("r-own");
  });

  it("takes the only membership when that is all there is", () => {
    expect(resolveActiveWorkspace(workspaceList([staffCafe]), null)?.key).toBe("r-staff");
  });

  it("has nothing to act in for an empty list", () => {
    expect(resolveActiveWorkspace([], "r-own")).toBeNull();
  });
});

describe("workspaceCan", () => {
  const [owned, staff] = workspaceList([ownedCafe, staffCafe]);

  it("asks only the chosen membership", () => {
    expect(workspaceCan(staff ?? null, "menus.write")).toBe(false);
    expect(workspaceCan(owned ?? null, "menus.write")).toBe(true);
  });

  it("answers no before a membership is chosen", () => {
    expect(workspaceCan(null, "orders.read")).toBe(false);
  });
});

describe("workspaceLabel", () => {
  it("names the café and the role on that membership", () => {
    expect(workspaceLabel(ownedCafe)).toBe("Joe's — Owner");
    expect(workspaceLabel(staffCafe)).toBe("Corner Bakery — Staff");
  });
});

describe("the remembered membership", () => {
  it("round-trips per account", () => {
    const store = fakeStore();
    writeStoredWorkspaceKey(store, "u-1", "r-staff");
    writeStoredWorkspaceKey(store, "u-2", "r-own");

    expect(readStoredWorkspaceKey(store, "u-1")).toBe("r-staff");
    expect(readStoredWorkspaceKey(store, "u-2")).toBe("r-own");
    expect(readStoredWorkspaceKey(store, "u-3")).toBeNull();
    expect(workspaceStorageKey("u-1")).not.toBe(workspaceStorageKey("u-2"));
  });

  it("treats a blank value as no choice", () => {
    const store = fakeStore({ [workspaceStorageKey("u-1")]: "   " });
    expect(readStoredWorkspaceKey(store, "u-1")).toBeNull();
  });

  it("survives a store that is unavailable or refuses to write", () => {
    expect(readStoredWorkspaceKey(null, "u-1")).toBeNull();
    expect(() => writeStoredWorkspaceKey(null, "u-1", "r-own")).not.toThrow();

    const blocked: WorkspaceStore = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readStoredWorkspaceKey(blocked, "u-1")).toBeNull();
    expect(() => writeStoredWorkspaceKey(blocked, "u-1", "r-own")).not.toThrow();
  });
});
