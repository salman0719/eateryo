import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { magicLink, twoFactor } from "better-auth/plugins";

import { eq, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { schema, session, user, verification } from "@/lib/db/schema";

import type { PlatformDb } from "./platform-admin";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "./passwords";

import { accountSuspendedMessage, isTwoFactorEnrolled, openSuspension } from "./account-state";

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
/** The endpoints the lockout counter guards: password sign-in plus the TOTP and recovery-code challenges. */
const PASSWORD_SIGN_IN_PATH = "/sign-in/email";
/** Second-factor challenge endpoints, counted against the same counter (§9). */
const FACTOR_VERIFY_TOTP_PATH = "/two-factor/verify-totp";
const FACTOR_VERIFY_BACKUP_PATH = "/two-factor/verify-backup-code";
/** Magic-link verification endpoint, where legacy email case is healed. */
const MAGIC_LINK_VERIFY_PATH = "/magic-link/verify";
/**
 * Factor failures that spend the shared window. Anything else — a dead
 * challenge cookie, the plugin's own per-route throttle, a suspended
 * refusal — leaves the counter alone.
 */
const FACTOR_FAILURE_CODES = new Set(["INVALID_CODE", "INVALID_BACKUP_CODE"]);

/**
 * The account behind a second-factor challenge, or null outside one.
 * Reads the same signed challenge cookie the plugin's own verify
 * endpoints read, then the verification row it points at. Enrolment
 * verifies (signed in, no challenge cookie) resolve to null on purpose:
 * a mistyped setup code must never spend the sign-in window.
 */
interface FactorChallengeContext {
  getSignedCookie(name: string, secret: string): Promise<unknown>;
  context: {
    secret: string;
    createAuthCookie(name: string): { name: string };
    internalAdapter: {
      findVerificationValue(identifier: string): Promise<{ value: unknown } | null>;
    };
  };
}

async function resolveTwoFactorUserId(ctx: FactorChallengeContext): Promise<string | null> {
  try {
    const jar = ctx.context.createAuthCookie("two_factor");
    const signed = await ctx.getSignedCookie(jar.name, ctx.context.secret);
    if (typeof signed !== "string" || !signed) return null;
    const verification = await ctx.context.internalAdapter.findVerificationValue(signed);
    return typeof verification?.value === "string" && verification.value
      ? verification.value
      : null;
  } catch {
    return null;
  }
}

/**
 * The account a verified code just signed in. A success consumes the
 * challenge, so the cookie above no longer resolves — instead read the
 * fresh session the success sets and follow it to its owner. Anything
 * unrecognised (or a non-ok answer) means no window to clear.
 */
async function resolveFactorSessionUserId(
  db: PlatformDb,
  ctx: FactorChallengeContext,
  res: Response
): Promise<string | null> {
  try {
    const jar = ctx.context.createAuthCookie("session_token");
    const prefix = `${jar.name}=`;
    const hit = res.headers.getSetCookie().find((cookie) => cookie.startsWith(prefix));
    if (!hit) return null;
    const token = decodeURIComponent(hit.slice(prefix.length).split(";")[0] ?? "");
    if (!token) return null;
    const rows = await db
      .select({ userId: session.userId })
      .from(session)
      .where(eq(session.token, token))
      .limit(1);
    return rows[0]?.userId ?? null;
  } catch {
    return null;
  }
}

/**
 * Legacy email-case heal for magic-link verify.
 *
 * Accounts written outside Better Auth (direct SQL, old seeds) can hold a
 * mixed-case address while the plugin looks users up lowercased — so a
 * differently-cased link misses the row and mints a duplicate lowercased
 * account. Before the plugin's own lookup runs, resolve the pending link's
 * address case-insensitively and rewrite the stored row to the canonical
 * lowercase form; the plugin then matches the original account and no
 * second user is created. Best-effort: a heal that fails only logs, and
 * the verify proceeds exactly as it would have without it.
 */
async function healLegacyEmailCase(db: PlatformDb, query: unknown): Promise<void> {
  try {
    const token =
      typeof query === "object" && query !== null && "token" in query
        ? (query as { token?: unknown }).token
        : null;
    if (typeof token !== "string" || !token) return;
    const pending = await db
      .select({ value: verification.value })
      .from(verification)
      .where(eq(verification.identifier, `magic-link:${token}`))
      .limit(1);
    const raw = pending[0]?.value;
    if (!raw) return;
    let address: string | null = null;
    try {
      const parsed = JSON.parse(raw) as { email?: unknown };
      if (typeof parsed.email === "string") {
        const normalized = parsed.email.trim().toLowerCase();
        address = normalized ? normalized : null;
      }
    } catch {
      return;
    }
    if (!address) return;
    const matches = await db
      .select({ id: user.id, email: user.email })
      .from(user)
      .where(sql`lower(${user.email}) = ${address}`)
      .limit(1);
    const hit = matches[0];
    if (!hit || hit.email === address) return;
    await db.update(user).set({ email: address }).where(eq(user.id, hit.id));
  } catch (error) {
    logEvent("warn", "auth.email_case_heal_failed", { error });
  }
}

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
      user: {
        create: {
          /**
           * Canonical email form: every account reads lowercase, so a later
           * sign-in with different casing matches the same row instead of
           * minting a duplicate. Better Auth already lowercases its own
           * lookup and create paths; this states the invariant in our
           * config so it survives library upgrades and covers any
           * additional-fields write that bypasses them.
           */
          before: async (userData) => {
            const email = (userData as { email?: unknown }).email;
            if (typeof email !== "string") return;
            const normalized = email.trim().toLowerCase();
            if (normalized && normalized !== email)
              return { data: { ...userData, email: normalized } };
          },
        },
      },
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
       * Lockout gate (P4 passwords, P6 second factor). Five failed attempts
       * pause sign-in for 15 minutes per account — the row the operator's
       * Unlock clears. The check runs before the password or code is even
       * verified, so a correct credential cannot walk through a pause, and
       * a wrong one during the pause costs nothing (the attempt never
       * reaches the counting half). The emailed link and recovery codes
       * are deliberately not gated: they are the escape hatches that need
       * no operator.
       */
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === MAGIC_LINK_VERIFY_PATH) {
          // Legacy mixed-case account rows predate the lowercase invariant;
          // rewrite the match before the plugin looks it up, so the link
          // signs into the original account instead of creating a second.
          await healLegacyEmailCase(options.db, ctx.query);
          return;
        }
        if (ctx.path === FACTOR_VERIFY_TOTP_PATH) {
          // The TOTP door is gated like the password door. Recovery codes
          // pass through untouched — they are the way through while
          // locked, and a success clears the pause (§9).
          const userId = await resolveTwoFactorUserId(ctx as unknown as FactorChallengeContext);
          if (!userId) return;
          let lockedMinutes: number | null = null;
          try {
            const state = await readLockout(options.db, userId);
            if (state.locked) lockedMinutes = state.minutesLeft;
          } catch (error) {
            logEvent("error", "auth.lockout_read_failed", { error });
            throw new APIError("SERVICE_UNAVAILABLE", {
              message: "Sign-in is not available yet — try again shortly.",
            });
          }
          if (lockedMinutes !== null)
            throw new APIError("TOO_MANY_REQUESTS", accountLockedBody(lockedMinutes));
          return;
        }
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
       * Count the attempt (P4 passwords, P6 second factor). A wrong
       * password or TOTP code adds one failure and, on the fifth, answers
       * the pause immediately instead of waiting for the next attempt; a
       * correct one clears the window, as does a spent recovery code —
       * even while locked, which is what makes it the way through. A
       * wrong recovery code while locked costs nothing and extends
       * nothing. A suspended account's refusal (403) is not a failed
       * attempt — the credentials were right — and any other error leaves
       * the counter alone.
       */
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path === FACTOR_VERIFY_TOTP_PATH || ctx.path === FACTOR_VERIFY_BACKUP_PATH) {
          const returned = (ctx.context as unknown as { returned?: unknown }).returned;
          try {
            if (isAPIError(returned)) {
              // A failure leaves the challenge live, so the cookie still
              // resolves — but enrolment verifies carry none, and setup
              // typos must never spend the sign-in window.
              const userId = await resolveTwoFactorUserId(ctx as unknown as FactorChallengeContext);
              if (!userId) return;
              const code = (returned.body as { code?: unknown } | undefined)?.code;
              if (typeof code !== "string" || !FACTOR_FAILURE_CODES.has(code)) return;
              if (ctx.path === FACTOR_VERIFY_BACKUP_PATH) {
                const state = await readLockout(options.db, userId);
                if (state.locked) return;
              }
              const state = await recordFailedAttempt(options.db, userId);
              if (state.locked) {
                return accountLockedResponse(state.minutesLeft);
              }
              return;
            }

            // A success consumes the challenge, so the cookie no longer
            // resolves — follow the fresh session the success sets instead.
            // An ok answer here is a correct code, and it clears the
            // window, locked or not.
            let userId: string | null = null;
            if (returned instanceof Response && returned.ok) {
              userId = await resolveFactorSessionUserId(
                options.db,
                ctx as unknown as FactorChallengeContext,
                returned
              );
            } else if (returned && typeof returned === "object" && "user" in returned) {
              const user = (returned as { user?: { id?: unknown } }).user;
              userId = typeof user?.id === "string" ? user.id : null;
            }
            if (!userId) return;
            await clearFailedAttempts(options.db, userId);
          } catch (error) {
            logEvent("warn", "auth.lockout_write_failed", { error });
          }
          return;
        }
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
            // A challenged sign-in still carries the user internally while
            // the password door stays shut behind the code: only a completed
            // sign-in clears the window, so an enrolled account keeps its
            // failures until the code (or a spent recovery code) lands.
            if (!(await isTwoFactorEnrolled(options.db, userId))) {
              await clearFailedAttempts(options.db, userId);
            }
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
      twoFactor({
        issuer: "Eateryo",
        // The shared `account_access_state` counter is the only lockout
        // (§9): the plugin's own per-account budget would be a second store
        // disagreeing with the operator's Unlock, so it stays off and our
        // hooks count the same endpoints instead.
        accountLockout: { enabled: false },
        // Ten single-use recovery codes, encrypted at rest (§6). The panel
        // shows enrolled/not-enrolled, never a code.
        backupCodeOptions: { amount: 10, storeBackupCodes: "encrypted" },
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
