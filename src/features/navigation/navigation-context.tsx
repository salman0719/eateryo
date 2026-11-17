"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";

import { historyWriteFor } from "./history";
import { appRouteHref, parseAppRoute, routeMenuId, type AppRoute } from "./routes";

/**
 * The app's one answer to "which screen is showing, and how do I change it?".
 *
 * The shell used to keep the route in its own state, write the History API by
 * hand and re-read the URL on `popstate` and on every `usePathname` change.
 * That is a router, and the app already has one, so the knowledge lives here:
 * screens call `navigate(route)`, and this provider is the only place that
 * touches history. Moving to the App Router's own URLs later means replacing
 * the body of `navigate`/the sync effect, not every call site.
 *
 * The URL stays the source of truth in both directions: the route is seeded
 * from `usePathname()` (which is rendered into the HTML on the first load, so
 * the server paints the screen the URL names), `navigate` writes the URL before
 * it changes the visible route, and the sync effect picks up every change the
 * app did not make — back/forward, a typed URL, a `<Link>` push whose page was
 * already mounted. No route file hands a parsed route down, so an address and
 * the screen showing it cannot disagree.
 */

export interface NavigateOptions {
  /** Replace rather than push: guards and redirects do not grow the back stack. */
  replace?: boolean;
  /**
   * Whether leaving the current menu should flush its pending save first.
   * Defaults to true; a picker that stays inside one menu can opt out.
   */
  flushCurrent?: boolean;
}

export interface NavigationValue {
  route: AppRoute;
  navigate: (next: AppRoute, options?: NavigateOptions) => void;
  /**
   * The visible screen has followed the URL at least once. Async work that
   * would otherwise race the first sync (opening the routed menu) waits on it.
   */
  ready: boolean;
  /**
   * The menu id of a publish URL whose draft resolves nowhere. Held with an
   * explainer card instead of bouncing to the library; cleared by the next
   * navigation, and set again if the same dead URL is opened again.
   */
  missingPublishMenuId: string | null;
  markMissingPublish: (menuId: string) => void;
  /**
   * The open editor's pending save. Navigation flushes it before it leaves a
   * menu so an edit made a moment before the click is not lost. A ref write,
   * safe to call during render.
   */
  registerSaveFlush: (flush: (() => Promise<void>) | null) => void;
}

const NavigationContext = createContext<NavigationValue | null>(null);

export function NavigationProvider({ children }: { children: ReactNode }) {
  /** The URL is the only input: the first screen is the one it names. */
  const pathname = usePathname();
  const [route, setRoute] = useState<AppRoute>(() => parseAppRoute(pathname));
  const [ready, setReady] = useState(false);
  const [missingPublishMenuId, setMissingPublishMenuId] = useState<string | null>(null);

  const routeRef = useRef<AppRoute>(route);
  const saveFlushRef = useRef<(() => Promise<void>) | null>(null);

  /** Leaving a menu flushes its pending save (same menu: nothing to do). */
  const flushFor = useCallback((next: AppRoute) => {
    const previousMenuId = routeMenuId(routeRef.current);
    if (previousMenuId && previousMenuId !== routeMenuId(next)) {
      void saveFlushRef.current?.();
    }
  }, []);

  const apply = useCallback((next: AppRoute, options: { clearMissing?: boolean } = {}) => {
    routeRef.current = next;
    setRoute(next);
    if (options.clearMissing) setMissingPublishMenuId(null);
    setReady(true);
  }, []);

  const navigate = useCallback(
    (next: AppRoute, options: NavigateOptions = {}) => {
      const { replace = false, flushCurrent = true } = options;
      if (flushCurrent) flushFor(next);
      if (typeof window !== "undefined") {
        const nextHref = appRouteHref(next);
        const currentHref = window.location.pathname + window.location.search;
        const write = historyWriteFor({ currentHref, nextHref, replace });
        if (write === "replace") window.history.replaceState(null, "", nextHref);
        else if (write === "push") window.history.pushState(null, "", nextHref);
      }
      // A new destination can never be the dead publish URL it just left.
      apply(next, { clearMissing: true });
    },
    [apply, flushFor]
  );

  // Follow every URL change the app did not make. Subscribing to the pathname
  // as well as `popstate` matters because a `<Link>` push whose target page
  // component is already mounted swaps nothing — without this the URL moves
  // while the screen stays on the old one.
  useEffect(() => {
    const syncFromLocation = () => {
      const next = parseAppRoute(window.location.href);
      flushFor(next);
      apply(next);
    };
    syncFromLocation();
    window.addEventListener("popstate", syncFromLocation);
    return () => window.removeEventListener("popstate", syncFromLocation);
  }, [pathname, apply, flushFor]);

  const markMissingPublish = useCallback((menuId: string) => {
    setMissingPublishMenuId(menuId);
  }, []);

  const registerSaveFlush = useCallback((flush: (() => Promise<void>) | null) => {
    saveFlushRef.current = flush;
  }, []);

  const value = useMemo(
    () => ({
      route,
      navigate,
      ready,
      missingPublishMenuId,
      markMissingPublish,
      registerSaveFlush,
    }),
    [route, navigate, ready, missingPublishMenuId, markMissingPublish, registerSaveFlush]
  );

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation(): NavigationValue {
  const value = useContext(NavigationContext);
  if (!value) {
    throw new Error("useNavigation must be used inside a NavigationProvider.");
  }
  return value;
}
