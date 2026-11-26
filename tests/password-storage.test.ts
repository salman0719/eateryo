import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { getAccountDetail, listAccounts } from "@/features/platform/repo";
import { account, twoFactor, user } from "@/lib/db/schema";
import { createTestDb, seedUser, type TestDb } from "./helpers/pg-test-db";

/**
 * P1 — password/2FA storage baseline (PGlite, no external services).
 *
 * No behaviour changes: this proves the 0024 migration applies, the
 * `two_factor` table round-trips with the library's defaults, and the
 * admin reads still leak no secret material with secrets stored.
 * Hashing, TOTP, and code generation stay the auth library's defaults —
 * the repo stores results, never algorithms.
 */

let db: TestDb;

beforeAll(async () => {
  ({ db } = await createTestDb());
}, 30_000);

describe("two-factor storage", () => {
  it("applies the migration: two_factor exists beside the auth tables", async () => {
    // A missing table throws; selecting proves the migration applied.
    await db.select({ id: user.id }).from(user).limit(1);
    await db.select({ id: account.id }).from(account).limit(1);
    await db.select({ id: twoFactor.id }).from(twoFactor).limit(1);
  });

  it("round-trips a factor row with the library defaults", async () => {
    const id = await seedUser(db, "p1-factor@cafe.test", "P1 Factor");
    await db.insert(twoFactor).values({
      id: "p1-factor-row",
      secret: "JBSWY3DPEHPK3PXP",
      backupCodes: JSON.stringify(["abcde-12345"]),
      userId: id,
    });

    const rows = await db.select().from(twoFactor);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      secret: "JBSWY3DPEHPK3PXP",
      userId: id,
      verified: true,
      failedVerificationCount: 0,
      lockedUntil: null,
    });

    const owners = await db.select({ twoFactorEnabled: user.twoFactorEnabled }).from(user);
    expect(owners.every((row) => row.twoFactorEnabled === false)).toBe(true);
  });

  it("cascades the factor row when the user is removed", async () => {
    const id = await seedUser(db, "p1-gone@cafe.test", "P1 Gone");
    await db.insert(twoFactor).values({
      id: "p1-gone-row",
      secret: "JBSWY3DPEHPK3PXP",
      backupCodes: JSON.stringify(["abcde-12345"]),
      userId: id,
    });
    await db.execute(sql`delete from "user" where id = ${id}`);
    const leftovers = await db.select().from(twoFactor).where(eq(twoFactor.userId, id));
    expect(leftovers).toHaveLength(0);
  });

  it("keeps secret material out of the admin payloads", async () => {
    const id = await seedUser(db, "p1-quiet@cafe.test", "P1 Quiet");
    await db.insert(twoFactor).values({
      id: "p1-quiet-row",
      secret: "JBSWY3DPEHPK3PXP",
      backupCodes: JSON.stringify(["abcde-12345"]),
      userId: id,
    });

    const detail = await getAccountDetail(db, id);
    const list = await listAccounts(db, {});
    const serialized = JSON.stringify({ detail, accounts: list.accounts });
    for (const leaked of ["JBSWY3DPEHPK3PXP", "abcde-12345", "backupCodes", "twoFactor"]) {
      expect(serialized).not.toContain(leaked);
    }
  });
});
