import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";

import { getDb } from "@/lib/db";
import { schema } from "@/lib/db/schema";

import { accountSuspendedMessage, openSuspension } from "./account-state";
import type { PlatformDb } from "./platform-admin";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "./passwords";

import { sendMagicLinkEmail } from "./email";
import { captureDevSignInLink, isDevSignInEnabled } from "./dev-sign-in";
import { logEvent } from "@/lib/observability/log";
import {
  accountLockedBody,
  clearFailedAttempts,
  findPasswordUserId,
  readLockout,
  recordFailedAttempt,
  signInEmail,
} from "./lockout";

/** Magic links are single-use and expire fast (PHASE-2.md §3.6). */
const MAGIC_LINK_EXPIRES_IN_SECONDS = 5 * 60;
/** Café owner laptops / staff-board devices should stay signed in (§3.6). */
export const SESSION_EXPIRES_IN_SECONDS = 30 * 24 * 60 * 60;
/** Rolling refresh: the 30-day window slides forward on daily use. */
const SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60;
/** The one endpoint the lockout counter guards (P6 adds the factor verify). */
const PASSWORD_SIGN_IN_PATH = "/sign-in/email";

/**
 * The pause as a finished response, for the after hook to substitute.
 * Replacing the *response* is what carries the 429: the pipeline keeps the
 * failing endpoint's own 401 status when an error object is swapped in, but
 * a `Response` passes through untouched. The before hook answers the same
 * pause by throwing `APIError` with the shared `accountLockedBody`, so the
 * shape lives in one place (`lockout.ts`) and the two hooks cannot drift.
 */
function accountLockedResponse(minutesLeft: number): Response {
  return new Response(JSON.stringify(accountLockedBody(minutesLeft)), {
    status: 429,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

type SendMagicLink = NonNullable<Parameters<typeof magicLink>[0]>["sendMagicLink"];

export interface CreateAuthOptions {
  /**
   * Drizzle instance (Neon HTTP in the app, PGlite in tests). Typed as the
   * pg base so auth-owned reads (e.g. the suspension gate) can use it;
   * the adapter itself accepts anything.
   */
  db: PlatformDb;
  /** Override link delivery (tests capture links instead of sending). */
  sendMagicLink?: SendMagicLink;
  baseURL?: string;
  secret?: string;
}

/**
 * Better Auth instance factory. Password sign-in verifies from P3 against
 * the credentials stored from P2 (set after a verified link); public
 * sign-up stays disabled, so sign-in never mints an account and diners
 * never authenticate (PHASE-2.md §3.6). Bearer API keys for the (parked)
 * B2B API are a separate plugin, deliberately not configured here yet.
 */
export function createAuth(options: CreateAuthOptions) {
  return betterAuth({
    baseURL: options.baseURL ?? process.env.BETTER_AUTH_URL,
    secret: options.secret ?? process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(options.db, {
      provider: "pg",
      schema,
    }),
    session: {
      expiresIn: SESSION_EXPIRES_IN_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
    },
    databaseHooks: {
      session: {
        create: {
          /**
           * Suspension sign-in gate (B1): an account with an open suspension
           * mints no session. The copy is generic — the reason stays
           * internal — and a DB we cannot reach fails closed (503) rather
           * than minting a session a later read cannot vet.
           */
          before: async (session) => {
            let suspended = false;
            try {
              suspended = (await openSuspension(options.db, session.userId)) !== null;
            } catch {
              throw new APIError("SERVICE_UNAVAILABLE", {
                message: "Server sync is not available yet — keep working locally.",
              });
            }
            if (suspended) {
              throw new APIError("FORBIDDEN", { message: accountSuspendedMessage() });
            }
          },
        },
      },
    },
    hooks: {
      /**
       * Lockout gate (P4). Five failed password attempts pause sign-in for
       * 15 minutes per account — the row the operator's Unlock clears. The
       * check runs before the password is even hashed, so a correct password
       * cannot walk through a pause, and a wrong one during the pause costs
       * nothing (the attempt never reaches the counting half). The emailed
       * link is deliberately not gated: it is the escape hatch that needs no
       * operator.
       */
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== PASSWORD_SIGN_IN_PATH) return;
        const email = signInEmail(ctx.body);
        if (!email) return;

        let lockedMinutes: number | null = null;
        try {
          const userId = await findPasswordUserId(options.db, email);
          if (userId) {
            const state = await readLockout(options.db, userId);
            if (state.locked) lockedMinutes = state.minutesLeft;
          }
        } catch (error) {
          // Without the counter row we cannot honour the pause; the
          // password check behind it would fail on the same DB anyway, so
          // fail closed with the shared unavailable copy.
          logEvent("error", "auth.lockout_read_failed", { error });
          throw new APIError("SERVICE_UNAVAILABLE", {
            message: "Sign-in is not available yet — try again shortly.",
          });
        }
        // 429 with the settled copy, so the screen can tell "wrong
        // password" apart from "wait" without the server naming the
        // account. The counter, not this error, is the gate.
        if (lockedMinutes !== null)
          throw new APIError("TOO_MANY_REQUESTS", accountLockedBody(lockedMinutes));
      }),

      /**
       * Count the attempt (P4). A wrong password adds one failure and, on the
       * fifth, answers the pause immediately instead of waiting for the next
       * attempt; a correct one clears the window. A suspended account's
       * refusal (403) is not a failed attempt — the credentials were right —
       * and any other error leaves the counter alone.
       */
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== PASSWORD_SIGN_IN_PATH) return;
        const email = signInEmail(ctx.body);
        if (!email) return;
        const returned = (ctx.context as unknown as { returned?: unknown }).returned;

        try {
          const userId = await findPasswordUserId(options.db, email);
          if (!userId) return;

          if (isAPIError(returned)) {
            const code = (returned.body as { code?: unknown } | undefined)?.code;
            if (code !== "INVALID_EMAIL_OR_PASSWORD") return;
            const state = await recordFailedAttempt(options.db, userId);
            if (state.locked) {
              // The fifth failure is answered as the pause, so it is never a
              // surprise: the response says what happened and for how long.
              return accountLockedResponse(state.minutesLeft);
            }
            return;
          }

          if (returned && typeof returned === "object" && "user" in returned) {
            await clearFailedAttempts(options.db, userId);
          }
        } catch (error) {
          // Counting is best-effort after the fact: a write that fails must
          // never turn a correct sign-in into an error response. It is
          // still logged, or a dead counter would look like no attack.
          logEvent("warn", "auth.lockout_write_failed", { error });
        }
      }),
    },
    emailAndPassword: {
      // Password verification runs from P3 against the P2-stored credential.
      // Public sign-up stays off: rising happens through the link flow only.
      enabled: true,
      disableSignUp: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
    },
    plugins: [
      magicLink({
        // DEV_SIGN_IN_BYPASS=1 in a local `.env.local` parks the link for the
        // dev route to show instead of emailing it; `isDevSignInEnabled()` is
        // false in production, so deployed builds always use the real sender.
        sendMagicLink:
          options.sendMagicLink ??
          (isDevSignInEnabled() ? captureDevSignInLink : sendMagicLinkEmail),
        expiresIn: MAGIC_LINK_EXPIRES_IN_SECONDS,
      }),
      // Must stay last: re-applies Set-Cookie headers in the Next.js handler.
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

/**
 * One instance per base URL. In development the auth route passes the
 * request's loopback origin, so a dev server on 3100 is not refused as an
 * "invalid origin" against BETTER_AUTH_URL (commonly 3200) and the emailed
 * link points back at the port actually in use. Production passes nothing
 * and always uses the configured URL.
 */
const instances = new Map<string, Auth>();

/**
 * Lazy singleton for app code. Creating it needs DATABASE_URL, so it must
 * only be called inside request handlers — never at module import time
 * (keeps `next build` and signed-out local mode DB-free).
 */
export function getAuth(baseURL?: string): Auth {
  const resolved = baseURL ?? process.env.BETTER_AUTH_URL;
  const key = resolved ?? "default";
  const existing = instances.get(key);
  if (existing) return existing;
  const auth = createAuth({ db: getDb(), baseURL: resolved });
  instances.set(key, auth);
  return auth;
}
