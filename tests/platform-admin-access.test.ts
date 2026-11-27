import { beforeAll, describe, expect, it } from "vitest";

import {
  getPlatformRole,
  grantPlatformAdmin,
  isPlatformAdmin,
  revokePlatformAdmin,
} from "@/lib/auth/platform-admin";
import { createRestaurant, listRestaurantsForUser } from "@/features/tenancy/repo";
import { createTestDb, seedUser, type TestDb } from "./helpers/pg-test-db";

/**
 * B0 operator identity: who may see the admin panel.
 *
 * No grant → no access; operator → access; viewer → no access in V1;
 * revoked → no access, while the user's own café access is untouched.
 */
describe("platform operator access", () => {
  let db: TestDb;
  let operator: string;
  let stranger: string;

  beforeAll(async () => {
    ({ db } = await createTestDb());
    operator = await seedUser(db, "operator@platform.test", "Operator");
    stranger = await seedUser(db, "stranger@platform.test", "Stranger");
  }, 30_000);

  it("denies users with no grant", async () => {
    expect(await isPlatformAdmin(db, stranger)).toBe(false);
    expect(await getPlatformRole(db, stranger)).toBeNull();
  });

  it("grants operator access, idempotently", async () => {
    expect(await grantPlatformAdmin(db, { userId: operator })).toEqual({ status: "granted" });
    expect(await isPlatformAdmin(db, operator)).toBe(true);
    expect(await getPlatformRole(db, operator)).toBe("operator");
    expect(await grantPlatformAdmin(db, { userId: operator })).toEqual({ status: "already" });
    expect(await isPlatformAdmin(db, operator)).toBe(true);
  });

  it("withholds V1 access from viewer rows", async () => {
    const viewer = await seedUser(db, "viewer@platform.test", "Viewer");
    expect(await grantPlatformAdmin(db, { userId: viewer, role: "viewer" })).toEqual({
      status: "granted",
    });
    expect(await getPlatformRole(db, viewer)).toBe("viewer");
    expect(await isPlatformAdmin(db, viewer)).toBe(false);
  });

  it("revokes access while leaving the user's cafés intact", async () => {
    const place = await createRestaurant(db, operator, "Operator Cafe");
    expect(await revokePlatformAdmin(db, operator)).toEqual({ status: "revoked" });
    expect(await isPlatformAdmin(db, operator)).toBe(false);
    expect(await getPlatformRole(db, operator)).toBeNull();
    expect(await revokePlatformAdmin(db, operator)).toEqual({ status: "not_found" });

    // Revocation is panel-only: the operator's own café access survives.
    const restaurants = await listRestaurantsForUser(db, operator);
    expect(restaurants.map((r) => r.id)).toContain(place.id);
  });

  it("restores a revoked grant in the same row", async () => {
    expect(await grantPlatformAdmin(db, { userId: operator })).toEqual({
      status: "regranted",
    });
    expect(await isPlatformAdmin(db, operator)).toBe(true);
  });
});
