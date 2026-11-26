import { beforeAll, describe, expect, it } from "vitest";

import { listPlatformEvents } from "@/features/platform/repo";
import { adminEventsQuerySchema } from "@/features/platform/schema";
import { PLATFORM_EVENT_ACTIONS, platformEvent } from "@/lib/db/schema";
import { createTestDb, type TestDb } from "./helpers/pg-test-db";

/**
 * B5 — operator 2FA reset, lost-phone path (PGlite, no external services).
 *
 * First slice: the `two_factor.reset` audit family. The operator log's
 * action filter widens with the enum, so registering the family here is
 * what puts the reset path in the activity filter. The reset action
 * itself follows once its storage is decided with the password work —
 * the plan settles the shape now so nothing is redesigned later, but
 * the table/columns are not invented here.
 */

let db: TestDb;

beforeAll(async () => {
  ({ db } = await createTestDb());
}, 30_000);

describe("two-factor-reset audit family", () => {
  it("registers two_factor.reset alongside the earlier families", () => {
    expect(PLATFORM_EVENT_ACTIONS).toContain("two_factor.reset");
  });

  it("accepts two_factor.reset in the operator-log query and rejects unknown actions", () => {
    expect(adminEventsQuerySchema.parse({ action: "two_factor.reset" })).toEqual({
      action: "two_factor.reset",
    });
    expect(() => adminEventsQuerySchema.parse({ action: "no.such.action" })).toThrow();
  });

  it("filters the operator log to two_factor.reset events", async () => {
    await db.insert(platformEvent).values({
      action: "two_factor.reset",
      actorEmail: "two-factor-op@cafe.test",
      targetEmail: "locked-op@cafe.test",
      detail: "Second factor reset · sessions revoked, re-enrolment forced.",
    });
    await db.insert(platformEvent).values({
      action: "account.unlocked",
      actorEmail: "two-factor-op@cafe.test",
      targetEmail: "locked-op@cafe.test",
      detail: "Sign-in unlocked · cleared 5 failed attempts.",
    });

    const page = await listPlatformEvents(db, { action: "two_factor.reset" });
    expect(page.events).toHaveLength(1);
    expect(page.events[0]).toMatchObject({ action: "two_factor.reset" });

    const all = await listPlatformEvents(db);
    expect(all.events.length).toBeGreaterThanOrEqual(2);
  });
});
