import { beforeEach, describe, expect, it, vi } from "vitest";

import { SyncError } from "@/features/menus/sync";
import {
  ensureFirstRestaurant,
  resetFirstRestaurantFlights,
  type FirstRestaurantDeps,
} from "@/features/tenancy/first-restaurant";
import type { RestaurantOption } from "@/features/tenancy/client";

/**
 * The account's first café is asked for by three paths at once after a
 * signed-out capture comes back through the magic link: the publish-journey
 * claim, the generic sign-in import, and the editor's autosave. Each read
 * "this account owns nothing" from its own snapshot, so the server's
 * check-then-insert let both requests through and the account got two
 * workspaces. These cases pin the shared door that replaced them.
 */

const café = (id: string, name = "Sunny Side Café"): RestaurantOption => ({
  id,
  name,
  role: "owner",
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const stubs = (overrides: Partial<FirstRestaurantDeps> = {}): FirstRestaurantDeps => ({
  listOwned: vi.fn(async () => [] as RestaurantOption[]),
  create: vi.fn(async (name: string) => café("new", name)),
  ...overrides,
});

beforeEach(() => {
  resetFirstRestaurantFlights();
});

describe("ensureFirstRestaurant", () => {
  it("makes concurrent callers share one create", async () => {
    const gate = deferred<RestaurantOption>();
    const create = vi.fn(() => gate.promise);
    const deps = stubs({ create });

    const journey = ensureFirstRestaurant("acct-1", "Sunny Side Café", deps);
    const autoImport = ensureFirstRestaurant("acct-1", "Sunny Side Café", deps);
    gate.resolve(café("café-1"));

    await expect(journey).resolves.toEqual(café("café-1"));
    await expect(autoImport).resolves.toEqual(café("café-1"));
    expect(create).toHaveBeenCalledTimes(1);
    expect(deps.listOwned).toHaveBeenCalledTimes(1);
  });

  it("adopts a café the account already owns instead of creating another", async () => {
    const existing = café("café-existing", "Corner Café");
    const deps = stubs({ listOwned: vi.fn(async () => [existing]) });

    await expect(ensureFirstRestaurant("acct-2", "Sunny Side Café", deps)).resolves.toEqual(
      existing
    );
    expect(deps.create).not.toHaveBeenCalled();
  });

  it("adopts the winner when its own create loses the race", async () => {
    const winner = café("café-winner");
    let reads = 0;
    const deps = stubs({
      listOwned: vi.fn(async () => (++reads === 1 ? [] : [winner])),
      create: vi.fn(async () => {
        throw new SyncError("conflict", "You already have a restaurant on this account.");
      }),
    });

    await expect(ensureFirstRestaurant("acct-3", "Sunny Side Café", deps)).resolves.toEqual(winner);
    expect(deps.create).toHaveBeenCalledTimes(1);
    // Once before the create, once to recover the café that beat it.
    expect(reads).toBe(2);
  });

  it("never shares one account's creation with another account", async () => {
    const gate = deferred<RestaurantOption>();
    const create = vi.fn(() => gate.promise);
    const deps = stubs({ create });

    const first = ensureFirstRestaurant("acct-a", "Sunny Side Café", deps);
    const second = ensureFirstRestaurant("acct-b", "Corner Café", deps);
    gate.resolve(café("café-1"));

    await Promise.all([first, second]);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("lets a retry create after a failed attempt", async () => {
    let attempts = 0;
    const deps = stubs({
      create: vi.fn(async (name: string) => {
        attempts += 1;
        if (attempts === 1) {
          throw new SyncError("unavailable", "Could not reach the server.");
        }
        return café("café-2", name);
      }),
    });

    await expect(ensureFirstRestaurant("acct-4", "Sunny Side Café", deps)).rejects.toBeInstanceOf(
      SyncError
    );
    await expect(ensureFirstRestaurant("acct-4", "Sunny Side Café", deps)).resolves.toEqual(
      café("café-2", "Sunny Side Café")
    );
    expect(attempts).toBe(2);
  });

  it("still attempts the create when the ownership read fails", async () => {
    const deps = stubs({
      listOwned: vi.fn(async () => {
        throw new SyncError("unavailable", "Could not reach the server.");
      }),
    });

    await expect(ensureFirstRestaurant("acct-5", "Sunny Side Café", deps)).resolves.toEqual(
      café("new", "Sunny Side Café")
    );
    expect(deps.create).toHaveBeenCalledTimes(1);
  });
});
