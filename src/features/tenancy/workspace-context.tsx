"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { decideSessionState, type SessionState } from "@/features/session/state";
import { authClient } from "@/lib/auth-client";

import { fetchRestaurants, type RestaurantOption } from "./client";
import type { Capability } from "./permissions";
import {
  browserStorage,
  readStoredWorkspaceKey,
  resolveActiveWorkspace,
  workspaceCan,
  workspaceList,
  writeStoredWorkspaceKey,
  type Workspace,
} from "./workspace";

/** How many automatic retries a failed session read gets before the UI asks. */
const SESSION_READ_RETRIES = 2;
/** Delay before each retry, growing linearly (1.5 s, then 3 s). */
const SESSION_READ_RETRY_MS = 1500;

/**
 * The account, its memberships, and the one membership the app acts in.
 *
 * One read above the shell means every screen asks about the same café: the
 * sidebar's tabs, the library's rows and a café-keyed data read cannot
 * disagree, because there is only one answer to disagree with. The read is
 * the account's *whole* membership list (the switch needs it); what the app
 * may do is always the active membership's capabilities, never a union.
 */
export interface WorkspaceContextValue {
  /** The signed-in account; null while nobody is known. */
  userId: string | null;
  email: string | null;
  accountKey: string | null;
  signedIn: boolean;
  sessionState: SessionState;
  sessionPending: boolean;
  sessionCheckFailed: boolean;
  sessionCheckGaveUp: boolean;
  /** Retry the session read now, resetting the automatic attempts. */
  retrySession: () => void;

  /** Every membership the account holds, in the server's order. */
  workspaces: Workspace[];
  /** The one membership the app acts in; null until it is resolved. */
  active: Workspace | null;
  /** True until the membership question is answered (never a guess). */
  pending: boolean;
  /** The café list: null until its read answers, `[]` when signed out. */
  restaurants: RestaurantOption[] | null;
  /** Owned cafés: the targets for moving browser drafts into the account. */
  owned: RestaurantOption[];
  /** Which account the café read settled for (null = not yet). */
  settledFor: string | null;
  /** Which account's café read failed — a third state, not "none". */
  failedFor: string | null;

  can: (capability: Capability) => boolean;
  switchTo: (key: string) => void;
  refresh: () => void;
  /** Record a café the server just answered for — created or renamed. */
  addRestaurant: (restaurant: RestaurantOption) => void;
  /** Drop a café the server just deleted. */
  removeRestaurant: (restaurantId: string) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

interface RestaurantRead {
  /** Which account the answer belongs to; a mismatch means "not asked yet". */
  for: string | null;
  list: RestaurantOption[] | null;
  failed: boolean;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const {
    data: session,
    error: sessionError,
    isPending: sessionLoading,
    refetch: refetchSession,
  } = authClient.useSession();

  /**
   * Three answers, not two (015): while the session request is in flight, or
   * after it failed, nothing is known — and nothing may be refused or hidden
   * on a guess. A background refetch keeps `data`, so it still cannot flash
   * skeletons or unmount in-progress forms.
   */
  const sessionState = decideSessionState({
    hasUser: session?.user != null,
    pending: sessionLoading,
    error: sessionError ?? null,
  });
  const sessionPending = sessionState === "unknown";
  const sessionCheckFailed = sessionPending && sessionError != null;
  const signedIn = session?.user != null;
  const accountKey = session?.user?.id ?? null;

  // A failed session read is not a sign-out (015): retry twice with a
  // backing-off delay, then stop asking and let the UI say what it knows.
  const [sessionRetries, setSessionRetries] = useState(0);
  useEffect(() => {
    if (!sessionCheckFailed || sessionRetries >= SESSION_READ_RETRIES) return;
    const timer = setTimeout(() => {
      setSessionRetries((attempts) => attempts + 1);
      void refetchSession?.();
    }, SESSION_READ_RETRY_MS * (sessionRetries + 1));
    return () => clearTimeout(timer);
  }, [sessionCheckFailed, sessionRetries, refetchSession]);
  const sessionCheckGaveUp = sessionCheckFailed && sessionRetries >= SESSION_READ_RETRIES;
  const retrySession = useCallback(() => {
    setSessionRetries(0);
    void refetchSession?.();
  }, [refetchSession]);

  // One café read per account (and per explicit refresh). A failure settles
  // as failed, never as an empty account: the claim gate and the switcher
  // say "couldn't check", not "no café".
  const [read, setRead] = useState<RestaurantRead>({ for: null, list: null, failed: false });
  const [readAttempt, setReadAttempt] = useState(0);
  useEffect(() => {
    if (!signedIn || !accountKey) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await fetchRestaurants();
        if (cancelled) return;
        setRead({ for: accountKey, list, failed: false });
      } catch {
        if (cancelled) return;
        setRead({ for: accountKey, list: [], failed: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountKey, readAttempt, signedIn]);

  // The acting membership is a device preference, not server state: read it
  // once per account and never reuse another account's choice.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [keyFor, setKeyFor] = useState<string | null>(null);
  useEffect(() => {
    if (!signedIn || !accountKey) {
      // Deferred like the other account reads: the effect must not set state
      // synchronously while rendering the frame that decided to read.
      void Promise.resolve().then(() => {
        setActiveKey(null);
        setKeyFor(null);
      });
      return;
    }
    const remembered = readStoredWorkspaceKey(browserStorage(), accountKey);
    void Promise.resolve().then(() => {
      setActiveKey(remembered);
      setKeyFor(accountKey);
    });
  }, [accountKey, signedIn]);

  const restaurants = useMemo<RestaurantOption[] | null>(
    () => (!signedIn ? [] : read.for === accountKey ? read.list : null),
    [accountKey, read, signedIn]
  );
  const settledFor = read.list !== null ? read.for : null;
  const failedFor = read.failed ? read.for : null;
  const workspaces = useMemo(() => workspaceList(restaurants ?? []), [restaurants]);
  const pending = signedIn && (restaurants === null || keyFor !== accountKey);
  const active = !signedIn || pending ? null : resolveActiveWorkspace(workspaces, activeKey);
  const owned = useMemo(
    () => (restaurants ?? []).filter((restaurant) => restaurant.role === "owner"),
    [restaurants]
  );

  /**
   * Capability answer for the shell. No answer while the read is in flight,
   * and none on a guess. An account with no café yet keeps every tab so a
   * brand-new owner can start.
   */
  const can = useCallback(
    (capability: Capability) => {
      if (!signedIn || pending || restaurants === null) return false;
      if (restaurants.length === 0) return true;
      return workspaceCan(active, capability);
    },
    [active, pending, restaurants, signedIn]
  );

  const switchTo = useCallback(
    (key: string) => {
      if (!accountKey) return;
      writeStoredWorkspaceKey(browserStorage(), accountKey, key);
      setActiveKey(key);
      setKeyFor(accountKey);
    },
    [accountKey]
  );

  const refresh = useCallback(() => setReadAttempt((attempt) => attempt + 1), []);

  /**
   * One café, exactly as the server just confirmed it: a create appends, a
   * rename replaces in place. Nothing appears that the server did not answer
   * with, and the rest of the account's cafés stay untouched.
   */
  const addRestaurant = useCallback((restaurant: RestaurantOption) => {
    setRead((current) => {
      const list = current.list ?? [];
      const known = list.some((item) => item.id === restaurant.id);
      return {
        ...current,
        list: known
          ? list.map((item) => (item.id === restaurant.id ? restaurant : item))
          : [...list, restaurant],
        failed: false,
      };
    });
  }, []);

  const removeRestaurant = useCallback((restaurantId: string) => {
    setRead((current) => ({
      ...current,
      list: (current.list ?? []).filter((item) => item.id !== restaurantId),
      failed: false,
    }));
  }, []);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      userId: session?.user?.id ?? null,
      email: session?.user?.email ?? null,
      accountKey,
      signedIn,
      sessionState,
      sessionPending,
      sessionCheckFailed,
      sessionCheckGaveUp,
      retrySession,
      workspaces,
      active,
      pending,
      restaurants,
      owned,
      settledFor,
      failedFor,
      can,
      switchTo,
      refresh,
      addRestaurant,
      removeRestaurant,
    }),
    [
      accountKey,
      active,
      addRestaurant,
      can,
      failedFor,
      owned,
      pending,
      refresh,
      removeRestaurant,
      restaurants,
      retrySession,
      session?.user?.email,
      session?.user?.id,
      sessionCheckFailed,
      sessionCheckGaveUp,
      sessionPending,
      sessionState,
      settledFor,
      signedIn,
      switchTo,
      workspaces,
    ]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

/** The one membership context. Throws outside the provider — a bug, not a state. */
export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside a WorkspaceProvider.");
  return value;
}
