/**
 * Which account a browser draft belongs to (R1 heal). Device-local only.
 *
 * Every save made while signed in records `{ menuId → accountId }` in a
 * separate IndexedDB store, beside the menu document — never inside it, so
 * the canonical schema is untouched, and never sent to the server. When the
 * same account signs back in after an interrupted session (expired token,
 * dropped connection), the stamp tells the heal which rows are safe to push
 * and which need an explicit conflict decision instead of a silent adopt.
 *
 * Anti-laundering rule: a stamp is written only when no stamp exists, or
 * when the existing stamp already names this account. Rows stamped to
 * someone else are never overwritten, never claimed, never deleted.
 */

import { idbDelete, idbGet, idbGetAll, idbPut, ORIGINS_STORE, tx } from "@/features/menu/indexeddb";

/** Device-local ownership record for one browser draft. */
export interface DraftOrigin {
  menuId: string;
  accountId: string;
  /**
   * Server `updatedAt` the document last agreed with; `""` when the row
   * has never been confirmed on the server.
   */
  lastSyncedUpdatedAt: string;
}

/**
 * Record which account wrote this menu. Keeps an existing stamp that names
 * a different account — opening someone else's cached row must never
 * reassign it.
 */
export async function stampDraftOrigin(
  menuId: string,
  accountId: string,
  lastSyncedUpdatedAt: string
): Promise<DraftOrigin> {
  const existing = await getDraftOrigin(menuId).catch(() => undefined);
  if (existing && existing.accountId !== accountId) return existing;
  const next: DraftOrigin = {
    menuId,
    accountId,
    lastSyncedUpdatedAt:
      existing && existing.accountId === accountId && !lastSyncedUpdatedAt
        ? existing.lastSyncedUpdatedAt
        : lastSyncedUpdatedAt,
  };
  await tx(ORIGINS_STORE, "readwrite", ([store]) => idbPut(store, next)).catch(() => undefined);
  return next;
}

/** Refresh the agreed revision after a push or an adopt (same account only). */
export async function refreshDraftSync(
  menuId: string,
  accountId: string,
  lastSyncedUpdatedAt: string
): Promise<void> {
  const existing = await getDraftOrigin(menuId).catch(() => undefined);
  if (existing && existing.accountId !== accountId) return;
  const next: DraftOrigin = { menuId, accountId, lastSyncedUpdatedAt };
  await tx(ORIGINS_STORE, "readwrite", ([store]) => idbPut(store, next)).catch(() => undefined);
}

export async function getDraftOrigin(menuId: string): Promise<DraftOrigin | undefined> {
  return tx(ORIGINS_STORE, "readonly", ([store]) => idbGet<DraftOrigin>(store, menuId));
}

export async function listDraftOrigins(): Promise<DraftOrigin[]> {
  try {
    return await tx(ORIGINS_STORE, "readonly", ([store]) => idbGetAll<DraftOrigin>(store));
  } catch {
    // A fresh profile may not have the store yet; no stamps is a valid state.
    return [];
  }
}

/** Forget the stamp when its menu is explicitly deleted. Best-effort. */
export async function clearDraftOrigin(menuId: string): Promise<void> {
  await tx(ORIGINS_STORE, "readwrite", ([store]) => idbDelete(store, menuId)).catch(
    () => undefined
  );
}

/** What a same-account return should do with one stamped row. */
export type HealDecision = "push" | "conflict" | "adopt" | "none";

export interface HealInputs {
  /** Local and server documents carry the same content (updatedAt ignored). */
  contentEqual: boolean;
  /** The browser copy's own updatedAt. */
  localUpdatedAt: string;
  /** The stamp's last agreed revision ("" = never confirmed). */
  lastSyncedUpdatedAt: string;
  /** The server's current updatedAt. */
  serverUpdatedAt: string;
}

/**
 * Triage for a stamped row whose content differs from the server:
 * - server untouched since we last agreed + local saved after → push ours;
 * - server moved elsewhere too → explicit conflict, never a silent adopt;
 * - otherwise the browser copy is just a stale cache → adopt the server.
 * Equal content needs nothing. Pure, so it is unit-tested without a browser.
 */
export function decideHeal(inputs: HealInputs): HealDecision {
  if (inputs.contentEqual) return "none";
  const localAhead =
    inputs.lastSyncedUpdatedAt === "" || inputs.localUpdatedAt > inputs.lastSyncedUpdatedAt;
  const serverMoved = inputs.serverUpdatedAt !== inputs.lastSyncedUpdatedAt;
  if (!serverMoved && localAhead) return "push";
  if (serverMoved && localAhead) return "conflict";
  return "adopt";
}

/**
 * Which rows of this browser are visible to an account (or to nobody when
 * signed out). Stamped rows show only to their owner while signed in;
 * anonymous rows are the shared working set. Pure, for tests and reuse.
 */
export function visibleMenuIds(
  menuIds: string[],
  origins: Pick<DraftOrigin, "menuId" | "accountId">[],
  accountId: string | null
): string[] {
  const ownerOf = new Map(origins.map((origin) => [origin.menuId, origin.accountId]));
  return menuIds.filter((id) => {
    const owner = ownerOf.get(id);
    // Anonymous rows are visible to everyone signed in or out.
    if (!owner) return true;
    // Stamped rows show only to their owner, signed in.
    return accountId !== null && owner === accountId;
  });
}
