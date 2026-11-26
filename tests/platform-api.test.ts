import { beforeAll, describe, expect, it, vi } from "vitest";

import { GET as getAccounts } from "@/app/api/admin/accounts/route";
import { GET as getAccount } from "@/app/api/admin/accounts/[id]/route";
import { DELETE as restoreAccountRoute, POST as suspendRoute } from "@/app/api/admin/accounts/[id]/suspension/route";
import { GET as getEvents } from "@/app/api/admin/events/route";
import { grantPlatformAdmin } from "@/lib/auth/platform-admin";
import { createTestDb, seedUser, type TestDb } from "./helpers/pg-test-db";

/**
 * B3 API contracts: the admin HTTP surface refuses what it must and leaks
 * nothing. Cross-origin mutations → 403; missing reason → 400; oversized
 * note → 400; unknown id → 404; every response is `no-store`; error bodies
 * never carry SQL or stack traces.
 *
 * Real handlers on PGlite; only the session cookie and the DB handle are
 * stubbed (the repo + guard run for real).
 */

const holder: { db: TestDb | null; userId: string | null } = {
  db: null,
  userId: null,
};

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: vi.fn(async () =>
    holder.userId ? { id: holder.userId } : null
  ),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => {
    if (!holder.db) throw new Error("test db not initialised");
    return holder.db;
  },
}));

function adminRequest(
  path: string,
  init: RequestInit = {},
  origin?: string
): Request {
  const headers = new Headers(init.headers);
  if (origin) headers.set("origin", origin);
  return new Request(`http://test.local${path}`, { ...init, headers });
}

function mutationBody(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

/** An error payload must read as a message, not as internals. */
function expectCleanError(payload: unknown): void {
  const text = JSON.stringify(payload);
  expect(text).not.toMatch(/select\s|insert\s|drizzle|pgtable|neon|stack|Error:/i);
  const error = (payload as { error?: { code?: unknown; message?: unknown } }).error;
  expect(typeof error?.code).toBe("string");
  expect(typeof error?.message).toBe("string");
}

function expectNoStore(response: Response): void {
  expect(response.headers.get("cache-control")).toContain("no-store");
}

describe("platform admin API contracts", () => {
  let operatorId: string;
  let targetId: string;

  beforeAll(async () => {
    const { db } = await createTestDb();
    holder.db = db;
    operatorId = await seedUser(db, "contract-operator@platform.test", "Contract Operator");
    targetId = await seedUser(db, "contract-target@platform.test", "Contract Target");
    expect(await grantPlatformAdmin(db, { userId: operatorId })).toMatchObject({
      status: "granted",
    });
    holder.userId = operatorId;
  }, 30_000);

  it("refuses a cross-origin suspend with 403 before the guard runs", async () => {
    const response = await suspendRoute(
      adminRequest(
        `/api/admin/accounts/${targetId}/suspension`,
        mutationBody({ reason: "abuse_or_spam" }),
        "https://evil.test"
      ),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(response.status).toBe(403);
    const payload = await response.json();
    expect(payload).toEqual({
      error: { code: "cross_origin_rejected", message: expect.any(String) },
    });
  });

  it("refuses a cross-origin restore with 403", async () => {
    const response = await restoreAccountRoute(
      adminRequest(
        `/api/admin/accounts/${targetId}/suspension`,
        { method: "DELETE" },
        "https://evil.test"
      ),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(response.status).toBe(403);
  });

  it("refuses a suspend with no reason with 400 and a clean body", async () => {
    const response = await suspendRoute(
      adminRequest(`/api/admin/accounts/${targetId}/suspension`, mutationBody({})),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(response.status).toBe(400);
    const payload = await response.json();
    expectCleanError(payload);
    expectNoStore(response);
  });

  it("refuses a suspend with an oversized note with 400", async () => {
    const response = await suspendRoute(
      adminRequest(
        `/api/admin/accounts/${targetId}/suspension`,
        mutationBody({ reason: "owner_request", note: "x".repeat(501) })
      ),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(response.status).toBe(400);
    expectCleanError(await response.json());
    expectNoStore(response);
  });

  it("answers an unknown account with 404 and no internals", async () => {
    const detail = await getAccount(adminRequest("/api/admin/accounts/no-such-user"), {
      params: Promise.resolve({ id: "no-such-user" }),
    });
    expect(detail.status).toBe(404);
    expectCleanError(await detail.json());
    expectNoStore(detail);

    const suspend = await suspendRoute(
      adminRequest(
        "/api/admin/accounts/no-such-user/suspension",
        mutationBody({ reason: "other" })
      ),
      { params: Promise.resolve({ id: "no-such-user" }) }
    );
    expect(suspend.status).toBe(404);
    expectCleanError(await suspend.json());
    expectNoStore(suspend);
  });

  it("rejects a forged page cursor with 400", async () => {
    const response = await getAccounts(
      adminRequest("/api/admin/accounts?cursor=!!!not-a-cursor!!!")
    );
    expect(response.status).toBe(400);
    expectCleanError(await response.json());
    expectNoStore(response);
  });

  it("marks every successful read no-store", async () => {
    const accounts = await getAccounts(adminRequest("/api/admin/accounts"));
    expect(accounts.status).toBe(200);
    expectNoStore(accounts);

    const events = await getEvents(adminRequest("/api/admin/events"));
    expect(events.status).toBe(200);
    expectNoStore(events);

    const detail = await getAccount(adminRequest(`/api/admin/accounts/${targetId}`), {
      params: Promise.resolve({ id: targetId }),
    });
    expect(detail.status).toBe(200);
    expectNoStore(detail);
  });
});
