import { and, eq, isNull } from "drizzle-orm";

import { accountSuspension } from "@/lib/db/schema";
import { contactEmail } from "@/lib/site";

import type { PlatformDb } from "./platform-admin";

/**
 * Account suspension state (B1) — server-only, never imported from client
 * components. Suspension belongs to an account, never a café: these helpers
 * answer "may this account act?" while diner paths (no account) never ask.
 * The suspension reason stays internal — user-facing copy below names the
 * state and a contact, never the accusation.
 */

export interface OpenSuspension {
  id: string;
  reason: string;
  createdAt: Date;
}

/** The account's open suspension, or null when the account may act. */
export async function openSuspension(
  db: PlatformDb,
  userId: string
): Promise<OpenSuspension | null> {
  const rows = await db
    .select({
      id: accountSuspension.id,
      reason: accountSuspension.reason,
      createdAt: accountSuspension.createdAt,
    })
    .from(accountSuspension)
    .where(and(eq(accountSuspension.userId, userId), isNull(accountSuspension.liftedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export class AccountStateError extends Error {
  readonly code = "suspended" as const;

  constructor(message: string) {
    super(message);
    this.name = "AccountStateError";
  }
}

/**
 * Generic user-facing copy shared by the sign-in gate, the write guard and
 * the suspension API: the state is stated, the reason is not. The contact
 * comes from the configured address — never a hardcoded mailbox nobody may
 * read (see `contactEmail`).
 */
export function accountSuspendedMessage(): string {
  const email = contactEmail();
  return email
    ? `This account is suspended. Contact ${email} for help.`
    : "This account is suspended. Contact support for help.";
}

/**
 * Defence in depth for the suspend race: a session minted (or a request
 * started) just before suspension must not write. Throws AccountStateError
 * when the account holds an open suspension; DB failures propagate so the
 * caller maps them to its own 503.
 */
export async function assertAccountActive(db: PlatformDb, userId: string): Promise<void> {
  if (await openSuspension(db, userId)) {
    throw new AccountStateError(accountSuspendedMessage());
  }
}
