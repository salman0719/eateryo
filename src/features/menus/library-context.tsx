"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cacheMenu, listMenus, StorageError, type MenuSummary } from "@/features/menu/storage";
import {
  getDraftOrigin,
  listDraftOrigins,
  menuContentHash,
  refreshDraftSync,
  type DraftOrigin,
} from "@/features/menus/draft-origins";
import { fetchCafeMenus, fetchServerMenu } from "@/features/menus/sync";
import { accessCan, menuAccessById, type MenuAccess } from "@/features/tenancy/access";
import { useWorkspace } from "@/features/tenancy/workspace-context";

/**
 * The library: the browser's menus, and every answer the account has given
 * about them. One provider, because a menu list, the ids the server proved,
 * the café each row belongs to and the read markers describe the same thing
 * and must never disagree.
 *
 * The markers are tri-state on purpose. `serverMenusReadFor` is set only once
 * a read has *finished*, so before it lands an empty id set means "not asked
 * yet", never "this browser only" (001); a read that ended by failing sets
 * `serverMenusReadFailedFor` instead, so surfaces can say the account could
 * not be checked rather than guess (016).
 */
export type LibraryValue = {
  /** The browser's menus, newest first, as the list renders them. */
  menus: MenuSummary[];
  /** Device-local ownership stamps: which account each draft belongs to. */
  originList: DraftOrigin[];
  /** False once the first library read has settled. */
  libraryLoading: boolean;
  libraryError: string | null;
  storageDown: boolean;
  /** The same answer for async work that finishes after an await. */
  storageDownRef: React.RefObject<boolean>;
  /** Ids the server proved belong to the caller. */
  serverIds: ReadonlySet<string>;
  serverIdsRef: React.RefObject<ReadonlySet<string>>;
  /** Server-resolved access per menu; a missing id is the unanswered state. */
  menuAccess: ReadonlyMap<string, MenuAccess>;
  menuAccessRef: React.RefObject<ReadonlyMap<string, MenuAccess>>;
  /** The café each account menu belongs to, learned from the server. */
  menuRestaurantById: ReadonlyMap<string, string>;
  /** Which account the ids/access answers describe; null until a read settles. */
  serverMenusFor: string | null;
  serverMenusReadFor: string | null;
  serverMenusReadFailedFor: string | null;
  accountMenusSettledRef: React.RefObject<string | null>;
  accountMenusReadFailedRef: React.RefObject<string | null>;
  /** Re-read the browser list (and the draft stamps). */
  refreshLibrary(): Promise<void>;
  /** Report a storage failure the library's surfaces should show. */
  reportLibraryError(message: string | null): void;
  /** Merge the acting café's account menus into the local library. */
  mergeAccountMenus(restaurantId: string | null): Promise<void>;
  /** The account read failed: drop back to "not read yet" and retry. */
  retryAccountCheck(): void;
  /** Sign-out: the ids and the read that produced them reset together. */
  resetAccountAnswer(): void;
  replaceServerIds(next: ReadonlySet<string>): void;
  replaceMenuAccess(next: ReadonlyMap<string, MenuAccess>): void;
  setMenuAccessFor(id: string, access: MenuAccess): void;
  addServerId(id: string): void;
  removeServerId(id: string): void;
  rememberMenuCafe(menuId: string, restaurantId: string): void;
  rememberMenuCafes(menus: { id: string; restaurantId: string }[]): void;
};

const LibraryContext = createContext<LibraryValue | null>(null);

export function useLibrary(): LibraryValue {
  const value = useContext(LibraryContext);
  if (!value) throw new Error("useLibrary must be used inside LibraryProvider");
  return value;
}

export function LibraryProvider({ children }: { children: ReactNode }) {
  const { signedIn, accountKey, active, pending } = useWorkspace();

  const [menus, setMenus] = useState<MenuSummary[]>([]);
  const [originList, setOriginList] = useState<DraftOrigin[]>([]);
  /** True until the first library read settles (skeleton rows, not empty). */
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [storageDown, setStorageDown] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);

  const [serverIds, setServerIds] = useState<ReadonlySet<string>>(new Set());
  const serverIdsRef = useRef<ReadonlySet<string>>(new Set());
  const [menuAccess, setMenuAccess] = useState<ReadonlyMap<string, MenuAccess>>(new Map());
  const menuAccessRef = useRef<ReadonlyMap<string, MenuAccess>>(new Map());
  const [menuRestaurantById, setMenuRestaurantById] = useState<ReadonlyMap<string, string>>(
    new Map()
  );
  const [serverMenusFor, setServerMenusFor] = useState<string | null>(null);
  const [serverMenusReadFailedFor, setServerMenusReadFailedFor] = useState<string | null>(null);
  const [serverMenusReadFor, setServerMenusReadFor] = useState<string | null>(null);
  const accountMenusSettledRef = useRef<string | null>(null);
  const accountMenusReadFailedRef = useRef<string | null>(null);
  const storageDownRef = useRef(false);

  /** Which account+café this provider has already read. */
  const mergedCafeRef = useRef<string | null>(null);
  /** Deduplicates concurrent account merges. */
  const mergeRef = useRef<Promise<void> | null>(null);

  /** Session answers for async work that outlives the render that decided it. */
  const signedInRef = useRef(signedIn);
  const accountKeyRef = useRef<string | null>(accountKey);

  function replaceServerIds(next: ReadonlySet<string>) {
    serverIdsRef.current = next;
    setServerIds(next);
  }

  function replaceMenuAccess(next: ReadonlyMap<string, MenuAccess>) {
    menuAccessRef.current = next;
    setMenuAccess(next);
  }

  /**
   * Which café a menu belongs to, learned from the server's own answer. It
   * follows the switcher across cafés (a deep link can open another café's
   * menu) and is never used to filter the library — the café-keyed read
   * already returns one café's rows.
   */
  const rememberMenuCafe = useCallback((menuId: string, restaurantId: string) => {
    setMenuRestaurantById((current) =>
      current.get(menuId) === restaurantId ? current : new Map(current).set(menuId, restaurantId)
    );
  }, []);

  function rememberMenuCafes(menusInCafe: { id: string; restaurantId: string }[]) {
    setMenuRestaurantById((current) => {
      let changed = false;
      const next = new Map(current);
      for (const menu of menusInCafe) {
        if (next.get(menu.id) === menu.restaurantId) continue;
        next.set(menu.id, menu.restaurantId);
        changed = true;
      }
      return changed ? next : current;
    });
  }

  /** Record one menu's access answer without touching the rest. */
  function setMenuAccessFor(id: string, access: MenuAccess) {
    if (menuAccessRef.current.get(id) === access) return;
    const next = new Map(menuAccessRef.current);
    next.set(id, access);
    replaceMenuAccess(next);
  }

  function addServerId(id: string) {
    if (serverIdsRef.current.has(id)) return;
    const next = new Set(serverIdsRef.current);
    next.add(id);
    replaceServerIds(next);
  }

  function removeServerId(id: string) {
    if (!serverIdsRef.current.has(id)) return;
    const next = new Set(serverIdsRef.current);
    next.delete(id);
    replaceServerIds(next);
  }

  const refreshLibrary = useCallback(async () => {
    try {
      setMenus(await listMenus());
      setOriginList(await listDraftOrigins());
      setStorageDown(false);
      storageDownRef.current = false;
    } catch (error) {
      setStorageDown(true);
      storageDownRef.current = true;
      if (error instanceof StorageError) setLibraryError(error.message);
    } finally {
      setLibraryLoading(false);
    }
  }, []);

  /**
   * Retry the account's menu read after a failure (016). The markers drop
   * back to "not read yet" first, so the surfaces return to their
   * placeholders instead of announcing an answer that has not arrived.
   */
  function retryAccountCheck() {
    if (!accountKey) return;
    setServerMenusReadFailedFor(null);
    setServerMenusReadFor(null);
    accountMenusSettledRef.current = null;
    void mergeAccountMenus(active?.restaurantId ?? null);
  }

  /** The account's answer about the library is no longer true. */
  function resetAccountAnswer() {
    replaceServerIds(new Set());
    replaceMenuAccess(new Map());
    setMenuRestaurantById(new Map());
    setServerMenusFor(null);
    setServerMenusReadFailedFor(null);
    setServerMenusReadFor(null);
    accountMenusSettledRef.current = null;
  }

  /**
   * Merge the account's menus into the local library (signed in only). A
   * menu that exists only on the server — moved from another device — is
   * downloaded and cached locally once, so the library lists and opens it
   * anywhere; afterwards it behaves like any local menu, reconciled with
   * the server revision on open. Best-effort: offline or a server DB that
   * is unavailable leaves the local library standing alone.
   */
  async function mergeAccountMenus(restaurantId: string | null) {
    if (!signedInRef.current || mergeRef.current) return;
    // Café-keyed: the library is one café's list, so the read names the café.
    // Until it resolves the keyed effect re-runs; an account with no café is
    // settled there, never here as an empty "read". The café arrives as an
    // argument, so the read cannot act in a membership the shell has left.
    if (!restaurantId) return;
    const run = (async () => {
      try {
        const { menus: serverMenus } = await fetchCafeMenus(restaurantId);
        // Same other-café rule as access below: a row provably on the
        // account stays listed even when it lives in another café.
        const nextIds = new Set(serverMenus.map((menu) => menu.id));
        for (const id of serverIdsRef.current) {
          const knownCafe = menuRestaurantById.get(id);
          if (knownCafe && knownCafe !== restaurantId) nextIds.add(id);
        }
        replaceServerIds(nextIds);
        rememberMenuCafes(serverMenus);
        // The claim offer waits for this: an empty set is only trustworthy
        // once the account has actually been read.
        if (signedInRef.current) {
          setServerMenusFor(accountKeyRef.current);
          setServerMenusReadFailedFor(null);
        }
        // One answer, no second role lookup: each summary already carries the
        // caller's capabilities. A browser-only menu keeps its local answer
        // while the server list has nothing to say about it. A menu attached
        // into another café keeps its explicit answer too: this café's list
        // cannot speak for a row that lives elsewhere.
        const accessById = new Map<string, MenuAccess>(menuAccessById(serverMenus));
        for (const [id, access] of menuAccessRef.current) {
          if (accessById.has(id)) continue;
          if (access === "local") {
            accessById.set(id, "local");
            continue;
          }
          const knownCafe = menuRestaurantById.get(id);
          if (knownCafe && knownCafe !== restaurantId && access !== "none") {
            accessById.set(id, access);
          }
        }
        replaceMenuAccess(accessById);
        const localIds = new Set((await listMenus()).map((menu) => menu.id));
        let cachedAny = false;
        let originsChanged = false;
        for (const summary of serverMenus) {
          // A member without the draft grant must never open a cached draft:
          // replace it with the live snapshot before it can be read. This is
          // the cache half of the server-side projection (the API already
          // refuses to send the draft).
          if (!summary.access.capabilities.includes("menus.read_draft")) {
            try {
              const full = await fetchServerMenu(summary.id);
              await cacheMenu({ ...full.doc, updatedAt: full.updatedAt });
              cachedAny = true;
            } catch {
              // One unreadable row never blocks the rest; the next refresh
              // retries it.
            }
            continue;
          }
          if (localIds.has(summary.id)) {
            // Backfill: this row is provably the account's (same id on the
            // server) but was never marked — signed out, it would resurface
            // as an anonymous draft. The agreed revision comes from the
            // server, so a later return heals instead of conflicting.
            // Staff rows and someone else's cache are never touched.
            if (!accessCan(menuAccessRef.current.get(summary.id), "menus.write")) continue;
            const backfillActor = accountKeyRef.current;
            if (!backfillActor) continue;
            try {
              const origin = await getDraftOrigin(summary.id).catch(() => undefined);
              if (origin) continue;
              if (!signedInRef.current) continue;
              const full = await fetchServerMenu(summary.id);
              if (!signedInRef.current) continue;
              await refreshDraftSync(
                summary.id,
                backfillActor,
                full.updatedAt,
                menuContentHash(full.doc)
              );
              originsChanged = true;
            } catch {
              // One unreadable row never blocks the rest; the next sign-in
              // retries it.
            }
            continue;
          }
          try {
            const full = await fetchServerMenu(summary.id);
            await cacheMenu(full.doc);
            const mergeActor = accountKeyRef.current;
            if (mergeActor)
              await refreshDraftSync(
                summary.id,
                mergeActor,
                full.updatedAt,
                menuContentHash(full.doc)
              );
            cachedAny = true;
          } catch {
            // One failed download never blocks the rest; the menu stays in
            // the account and the next refresh retries it.
          }
        }
        if (cachedAny) setMenus(await listMenus());
        if (originsChanged) setOriginList(await listDraftOrigins());
      } catch {
        // Signed out mid-flight, offline, or the server DB is unavailable:
        // the local library stands alone. Remember that the read failed so
        // the claim gate can settle as unknown instead of waiting forever.
        mergedCafeRef.current = null;
        if (signedInRef.current && accountKeyRef.current) {
          setServerMenusReadFailedFor(accountKeyRef.current);
        }
      } finally {
        // Settled either way, so the library may stop skeletoning. On a failed
        // read it then says nothing about membership rather than claiming
        // "this browser only" (001).
        if (signedInRef.current && accountKeyRef.current) {
          setServerMenusReadFor(accountKeyRef.current);
          accountMenusSettledRef.current = accountKeyRef.current;
        }
      }
    })();
    mergeRef.current = run;
    try {
      await run;
    } finally {
      mergeRef.current = null;
    }
  }

  useEffect(() => {
    signedInRef.current = signedIn;
    accountKeyRef.current = accountKey;
  }, [signedIn, accountKey]);

  // The same failure marker as a ref: the save status and the publish gate
  // decide in async code that finishes after an await (003, 016).
  useEffect(() => {
    accountMenusReadFailedRef.current = serverMenusReadFailedFor;
  }, [serverMenusReadFailedFor]);

  // The first library read. Its state writes land after the await, so it is
  // scheduled rather than run inside the effect body: nothing is set during
  // the commit that mounts the provider.
  useEffect(() => {
    void Promise.resolve().then(refreshLibrary);
  }, [refreshLibrary]);

  /**
   * Café-keyed read: the library is one café's list, so a different membership
   * starts from a different read, and an account with no café settles empty
   * instead of waiting forever. Ids and access answers from the previous café
   * do not describe this one, so they are dropped before the new read.
   */
  useEffect(() => {
    if (!signedIn || !accountKey) {
      mergedCafeRef.current = null;
      return;
    }
    if (!active) {
      if (pending) return;
      mergedCafeRef.current = `${accountKey}:none`;
      // Deferred like the other account reads: the effect must not set state
      // synchronously while rendering the frame that decided it.
      void Promise.resolve().then(() => {
        replaceServerIds(new Set());
        replaceMenuAccess(new Map());
        setServerMenusFor(accountKey);
        setServerMenusReadFailedFor(null);
        setServerMenusReadFor(accountKey);
        accountMenusSettledRef.current = accountKey;
      });
      return;
    }
    const key = `${accountKey}:${active.restaurantId}`;
    if (mergedCafeRef.current === key) return;
    mergedCafeRef.current = key;
    // Keep the browser-only answers: a local draft is the caller's own row and
    // belongs to no café, so it must not become read-only on a switch.
    replaceServerIds(new Set());
    replaceMenuAccess(
      new Map([...menuAccessRef.current].filter(([, access]) => access === "local"))
    );
    setServerMenusFor(null);
    setServerMenusReadFor(null);
    setServerMenusReadFailedFor(null);
    accountMenusSettledRef.current = null;
    // Chain onto a merge left over from the previous café instead of letting
    // the dedupe swallow this one (001).
    void (mergeRef.current ?? Promise.resolve()).then(() => mergeAccountMenus(active.restaurantId));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mergeAccountMenus is intentionally render-scoped: listing it would re-run this café-keyed effect every render, and the mergedCafeRef key guard already dedupes repeat runs
  }, [accountKey, active, signedIn, pending]);

  const value: LibraryValue = {
    menus,
    originList,
    libraryLoading,
    libraryError,
    storageDown,
    storageDownRef,
    serverIds,
    serverIdsRef,
    menuAccess,
    menuAccessRef,
    menuRestaurantById,
    serverMenusFor,
    serverMenusReadFor,
    serverMenusReadFailedFor,
    accountMenusSettledRef,
    accountMenusReadFailedRef,
    refreshLibrary,
    reportLibraryError: setLibraryError,
    mergeAccountMenus,
    retryAccountCheck,
    resetAccountAnswer,
    replaceServerIds,
    replaceMenuAccess,
    setMenuAccessFor,
    addServerId,
    removeServerId,
    rememberMenuCafe,
    rememberMenuCafes,
  };

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}
