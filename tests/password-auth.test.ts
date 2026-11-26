import { beforeAll, describe, expect, it } from "vitest";

import { createAuth } from "@/lib/auth";
import { createTestDb, type TestDb } from "./helpers/pg-test-db";

/**
 * P2 — set a password after link verification (PGlite + real Better Auth
 * HTTP handlers, no external services). Public sign-up stays disabled, so
 * the email/password core can store credentials without ever minting an
 * account; the route tests below drive the full chain (verified link →
 * session → set-password → stamped state).
 */

const BASE_URL = "http://localhost:3000/api/auth";

let db: TestDb;
let auth: ReturnType<typeof createAuth>;

const sentLinks: string[] = [];

beforeAll(async () => {
  ({ db } = await createTestDb());
  auth = createAuth({
    db,
    baseURL: "http://localhost:3000",
    secret: "test-secret-test-secret-test-secret-1234",
    sendMagicLink: async ({ url }) => {
      sentLinks.push(url);
    },
  });
}, 30_000);

function authRequest(path: string, body: unknown): Request {
  return new Request(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
    },
    body: JSON.stringify(body),
  });
}

describe("password credential storage", () => {
  it("refuses public email/password sign-up", async () => {
    const response = await auth.handler(
      authRequest("/sign-up/email", {
        name: "Nope",
        email: "nope@cafe.test",
        password: "correct horse 9!",
      })
    );
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { code?: string };
    expect(payload.code).toBe("EMAIL_PASSWORD_SIGN_UP_DISABLED");
  });
});
