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
import type { MenuDocument } from "@/features/menu/schema";

/** Device-local ownership record for one browser draft. */
export interface DraftOrigin {
  menuId: string;
  accountId: string;
  /**
   * Server `updatedAt` the document last agreed with; `""` when the row
   * has never been confirmed on the server.
   */
  lastSyncedUpdatedAt: string;
  /**
   * Content hash of the agreed revision (updatedAt excluded); `""` for
   * stamps written before hashing existed. Lets the heal tell "my edits"
   * from "a stale cache" exactly, without trusting timestamps.
   */
  lastSyncedHash: string;
}

/** Key-order-immune serialization (the DB may normalize object key order). */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  );
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Content identity ignoring the save stamp; equal content hashes equal. */
export function menuContentHash(doc: MenuDocument): string {
  return fnv1a(stableStringify({ ...doc, updatedAt: "" }));
}

/**
 * Record which account wrote this menu. Keeps an existing stamp that names
 * a different account — opening someone else's cached row must never
 * reassign it.
 */
export async function stampDraftOrigin(
  menuId: string,
  accountId: string,
  lastSyncedUpdatedAt: string,
  lastSyncedHash = ""
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
    lastSyncedHash:
      existing && existing.accountId === accountId && !lastSyncedHash
        ? (existing.lastSyncedHash ?? "")
        : lastSyncedHash,
  };
  await tx(ORIGINS_STORE, "readwrite", ([store]) => idbPut(store, next)).catch(() => undefined);
  return next;
}

/** Refresh the agreed revision after a push or an adopt (same account only). */
export async function refreshDraftSync(
  menuId: string,
  accountId: string,
  lastSyncedUpdatedAt: string,
  lastSyncedHash = ""
): Promise<void> {
  const existing = await getDraftOrigin(menuId).catch(() => undefined);
  if (existing && existing.accountId !== accountId) return;
  const next: DraftOrigin = { menuId, accountId, lastSyncedUpdatedAt, lastSyncedHash };
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

/**
 * Stamp freshly claimed rows so sign-out hides them. A claimed row is
 * provably the account's copy (the server just confirmed the same id), so
 * it needs no baseline yet: the hash of the uploaded content is enough for
 * the heal to tell later edits from a stale cache. Best-effort per row —
 * an unreadable draft keeps whatever stamp it has.
 */
export async function stampClaimedMenus(
  menuIds: readonly string[],
  accountId: string,
  readDoc: (menuId: string) => Promise<MenuDocument>
): Promise<void> {
  for (const menuId of menuIds) {
    try {
      const doc = await readDoc(menuId);
      await stampDraftOrigin(menuId, accountId, "", menuContentHash(doc));
    } catch {
      // One unreadable draft never blocks the rest.
    }
  }
}

/** Forget the stamp when its menu is explicitly deleted. Best-effort. */
export async function clearDraftOrigin(menuId: string): Promise<void> {
  await tx(ORIGINS_STORE, "readwrite", ([store]) => idbDelete(store, menuId)).catch(
    () => undefined
  );
}

/**
 * Rows no account has stamped: the only ones sign-in may ask about. A
 * stamped row belongs to an account — the claim moves it and the heal
 * triages it — so the pre-sign-in choice never names it. Pure.
 */
export function unstampedIds(
  ids: readonly string[],
  origins: readonly Pick<DraftOrigin, "menuId">[]
): string[] {
  const stamped = new Set(origins.map((origin) => origin.menuId));
  return ids.filter((id) => !stamped.has(id));
}

/**
 * Account copies safe to drop at sign-out: stamped to the account that is
 * leaving, with an agreed content hash the local document still matches.
 * Anything unproven stays — an interrupted edit is never dissolved, the
 * heal triages it at the next open instead. Reads stay inside this
 * module's store; documents come from the caller's reader. Best-effort
 * per row, so one unreadable row never blocks the rest.
 */
export async function collectSignOutDissolveIds(
  accountId: string,
  readDoc: (menuId: string) => Promise<MenuDocument>
): Promise<string[]> {
  const origins = await listDraftOrigins().catch(() => []);
  const dissolvable: string[] = [];
  for (const origin of origins) {
    if (origin.accountId !== accountId || !origin.lastSyncedHash) continue;
    try {
      if (menuContentHash(await readDoc(origin.menuId)) === origin.lastSyncedHash) {
        dissolvable.push(origin.menuId);
      }
    } catch {
      // Unreadable means unprovable: the row stays.
    }
  }
  return dissolvable;
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
  /** Content hash of the browser copy. */
  localHash: string;
  /** Content hash of the server copy. */
  serverHash: string;
  /** Content hash of the last agreed revision ("" = unknown). */
  lastSyncedHash: string;
}

/**
 * Triage for a row whose content differs from the server. Exact knowledge
 * first: when the agreed hash is known, "local untouched" means adopt and
 * "server untouched" means push, whatever the timestamps say. Without a
 * hash (legacy stamps), fall back to timestamps — and treat "never
 * confirmed" as a conflict, never a silent adopt.
 * Equal content needs nothing. Pure, so it is unit-tested without a browser.
 */
export function decideHeal(inputs: HealInputs): HealDecision {
  if (inputs.contentEqual) return "none";
  if (inputs.lastSyncedHash) {
    // The browser copy is exactly what we last agreed on: a stale cache.
    if (inputs.localHash === inputs.lastSyncedHash) return "adopt";
    const serverUnchanged =
      inputs.lastSyncedUpdatedAt !== ""
        ? inputs.serverUpdatedAt === inputs.lastSyncedUpdatedAt
        : inputs.serverHash === inputs.lastSyncedHash;
    return serverUnchanged ? "push" : "conflict";
  }
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
  accountId: string | null,
  /**
   * Published-only menus the server just listed for this account. Their
   * cached row may still be stamped to the account that wrote the draft;
   * the published snapshot is shared content, so it is visible anyway.
   */
  sharedMenuIds: ReadonlySet<string> = new Set()
): string[] {
  const ownerOf = new Map(origins.map((origin) => [origin.menuId, origin.accountId]));
  return menuIds.filter((id) => {
    if (sharedMenuIds.has(id)) return true;
    const owner = ownerOf.get(id);
    // Anonymous rows are visible to everyone signed in or out.
    if (!owner) return true;
    // Stamped rows show only to their owner, signed in.
    return accountId !== null && owner === accountId;
  });
}
