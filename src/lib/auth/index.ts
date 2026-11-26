import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";

import { getDb } from "@/lib/db";
import { schema } from "@/lib/db/schema";

import { accountSuspendedMessage, openSuspension } from "./account-state";
import type { PlatformDb } from "./platform-admin";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "./passwords";

import { sendMagicLinkEmail } from "./email";
import { captureDevSignInLink, isDevSignInEnabled } from "./dev-sign-in";

/** Magic links are single-use and expire fast (PHASE-2.md §3.6). */
const MAGIC_LINK_EXPIRES_IN_SECONDS = 5 * 60;
/** Café owner laptops / staff-board devices should stay signed in (§3.6). */
export const SESSION_EXPIRES_IN_SECONDS = 30 * 24 * 60 * 60;
/** Rolling refresh: the 30-day window slides forward on daily use. */
const SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60;

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
 * Better Auth instance factory. Magic link stays the sign-in flow; password
 * credentials are stored from P2 (set after a verified link) but public
 * sign-up is disabled, so sign-in still never mints an account and diners
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
    emailAndPassword: {
      // Set-password stores the first credential (P2); sign-in follows (P3).
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
