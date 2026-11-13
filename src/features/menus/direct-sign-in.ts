/**
 * The plain "Sign in" choice (R1).
 *
 * The publish wizard's own magic-link flow attaches the journey draft
 * silently. Every other in-shell `/sign-in` link asks first while signed
 * out with a local menu: attach it to the account on login, or wipe this
 * browser's copy on login. The answer is filed here (device-local,
 * id-scoped) before leaving for `/sign-in`, and the sign-in effect consumes
 * it exactly once. Id scoping is what makes a stale answer safe: menus that
 * no longer exist match nothing and change nothing.
 */

export type DirectSignInDecision = "attach" | "discard";

export interface DirectSignInIntent {
  decision: DirectSignInDecision;
  menuIds: string[];
}

const STORAGE_KEY = "eateryo:direct-signin-intent";

function browserStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function saveDirectSignInIntent(intent: DirectSignInIntent): void {
  const storage = browserStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(intent));
  } catch {
    // Without the marker the generic claim surfaces decide instead — slower,
    // never wrong.
  }
}

export function loadDirectSignInIntent(): DirectSignInIntent | null {
  const storage = browserStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    if (parsed.decision !== "attach" && parsed.decision !== "discard") return null;
    if (!Array.isArray(parsed.menuIds)) return null;
    const menuIds = parsed.menuIds.filter(
      (id): id is string => typeof id === "string" && id.length > 0
    );
    return { decision: parsed.decision, menuIds };
  } catch {
    return null;
  }
}

export function clearDirectSignInIntent(): void {
  const storage = browserStorage();
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // The id scoping makes a leftover marker harmless on its own.
  }
}
