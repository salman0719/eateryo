"use client";

/**
 * R0 app-wide order monitor (report 5, tiers 0+1): one signed-in polling
 * context mounted in AppShell, so staff on any tab hear about new orders.
 *
 * One poller per session: the board consumes this context instead of polling
 * itself, so the badge and the board share a cursor and can never disagree.
 * A new order (status `new`, created after the last seen moment) badges the
 * Orders tab, raises a toast, and — when the staffer opted in with a click —
 * chimes. Opening the Orders tab counts as seeing them: toasts clear and the
 * badge resets. The chime is not tied to what is on screen: a ticket that
 * lands while the board is open still makes the sound, because the person at
 * the pass may be looking at the fryer, not the list.
 *
 * Chime needs a prior user gesture (autoplay policy), so sound defaults off
 * with an explicit toggle; system notifications additionally need a granted
 * Notification permission, asked only after the first real order arrives.
 * The sound itself lives in `./chime` — a rising four-note motif, not a ping.
 */

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

import { fetchStaffOrderCounts, fetchStaffOrders } from "./client";
import { BOARD_WINDOW_MS, type BoardWindow } from "./board-filters";
import {
  detectNewOrders,
  mergeBoardOrders,
  monitorPollScope,
  monitorScopeKey,
} from "./monitor-utils";
import { orderCode, type Order, type OrderStatus } from "./schema";
import { playOrderChime } from "./chime";
import { SyncError } from "@/features/menus/sync";
import { formatTableLabel } from "./table-links";

const POLL_MS = 5000;
const MAX_BACKOFF_MS = 40000;
const TOAST_MS = 8000;
const CHIME_STORAGE_KEY = "eateryo-order-chime";

export interface OrderToast {
  id: string;
  order: Order;
}

export type MonitorConnection = "idle" | "connecting" | "live" | "reconnecting";

interface MonitorValue {
  orders: Order[];
  /**
   * Card tickets the board hides until paid, riding the same poll — the
   * strip above the Kanban reads this, never a second request.
   */
  awaitingOrders: Order[];
  phase: "loading" | "ready" | "error";
  connection: MonitorConnection;
  lastSyncedAt: string | null;
  /** Poll failure message for the board header; null when the poller is fine. */
  pollError: string | null;
  /** Unseen `new` orders — the tab badge count. */
  newCount: number;
  toasts: OrderToast[];
  soundOn: boolean;
  setSoundOn: (on: boolean) => void;
  /** True once a real order has arrived: the moment to offer notifications. */
  hasArrived: boolean;
  notificationsAvailable: boolean;
  notificationPermission: NotificationPermission | "unsupported";
  requestNotifications: () => Promise<void>;
  /**
   * History scope: `24h` pages the last day from the server, `all` pages
   * everything. The window filters in SQL; the board never downloads what
   * it hides.
   */
  historyWindow: BoardWindow;
  setHistoryWindow: (window: BoardWindow) => void;
  /** Server-side `COUNT(*) GROUP BY status` over the window — null until read. */
  counts: { counts: Record<OrderStatus, number>; total: number } | null;
  /** An older page exists beyond what the board holds. */
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  /**
   * The board is open: unseen markers advance and toasts clear. The chime
   * still plays on arrival — only the toast and system notification depend
   * on the list not being in front of the reader.
   */
  setViewingBoard: (viewing: boolean) => void;
  refresh: () => void;
  /** Board status writes: guard the id through the PATCH, then adopt/revert. */
  applyOptimistic: (orderId: string, status: OrderStatus) => void;
  resolveOptimistic: (updated: Order) => void;
  revertOptimistic: (rollback: Order) => void;
  dismissToast: (toastId: string) => void;
}

const MonitorContext = createContext<MonitorValue | null>(null);

export function useOrderMonitor(): MonitorValue {
  const value = useContext(MonitorContext);
  if (!value) throw new Error("useOrderMonitor must be used inside OrderMonitorProvider");
  return value;
}

function pollErrorMessage(error: unknown): string {
  if (error instanceof SyncError) {
    switch (error.code) {
      case "unauthorized":
        return "Your session expired — sign in again to keep order alerts live.";
      case "forbidden":
        return "You don't have access to this restaurant's orders.";
      case "rate_limited":
        return error.message;
      default:
        return error.message;
    }
  }
  return "Could not reach the server. Check your connection.";
}

function notificationBody(order: Order): string {
  const lines = order.lines.slice(0, 3).map((line) => `${line.quantity}× ${line.name}`);
  const extra = order.lines.length > 3 ? ` +${order.lines.length - 3} more` : "";
  return `${formatTableLabel(order.tableLabel)} · ${lines.join(", ")}${extra}`;
}

export function OrderMonitorProvider({
  userId,
  restaurantId,
  pending = false,
  children,
}: {
  userId: string | null;
  /**
   * The café the shell is acting in. One membership at a time: a person who
   * both owns a café and works a shift elsewhere must never see the other
   * café's tickets, toasts or badge.
   */
  restaurantId: string | null;
  /** The membership read has not answered: hold the board's shape. */
  pending?: boolean;
  children: ReactNode;
}) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [awaitingOrders, setAwaitingOrders] = useState<Order[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [connection, setConnection] = useState<MonitorConnection>("idle");
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [seenAt, setSeenAt] = useState<string | null>(null);
  const [toasts, setToasts] = useState<OrderToast[]>([]);
  const [historyWindow, setHistoryWindowState] = useState<BoardWindow>("24h");
  const [counts, setCounts] = useState<{
    counts: Record<OrderStatus, number>;
    total: number;
  } | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [soundOn, setSoundOnState] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | "unsupported"
  >("unsupported");
  const [hasArrived, setHasArrived] = useState(false);

  const sinceRef = useRef<string | null>(null);
  const windowRef = useRef<BoardWindow>(historyWindow);
  const nextCursorRef = useRef<string | null>(null);
  const pageScopeRef = useRef<{ cafeId: string; from: string | null } | null>(null);
  const loadingMoreRef = useRef(false);
  const seenAtRef = useRef<string | null>(null);
  const viewingRef = useRef(false);
  const guardedRef = useRef<Set<string>>(new Set());
  const soundOnRef = useRef(false);
  const permissionRef = useRef<NotificationPermission | "unsupported">("unsupported");
  const toastTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const notificationsAvailable = typeof window !== "undefined" && "Notification" in window;

  // A new session (sign-out, a different account, or a different café) resets
  // the monitor synchronously during render — React's endorsed pattern for
  // syncing state to new props, with no effect round-trip and no stale flash:
  // the previous café's tickets must not survive a switch even for a frame.
  // Refs are reset in the polling effect below (refs are never touched here).
  const monitorKey = monitorScopeKey(userId, restaurantId);
  const [monitorFor, setMonitorFor] = useState(monitorKey);
  if (monitorFor !== monitorKey) {
    setMonitorFor(monitorKey);
    setOrders([]);
    setAwaitingOrders([]);
    setPhase("loading");
    setConnection("idle");
    setLastSyncedAt(null);
    setPollError(null);
    setSeenAt(null);
    setToasts([]);
    setHasArrived(false);
    setHistoryWindowState("24h");
    setCounts(null);
    setHasMore(false);
    setLoadingMore(false);
  }

  // Polling reads the window through this ref so the poll callback keeps a
  // stable identity while the effect restarts on window changes.
  useEffect(() => {
    windowRef.current = historyWindow;
  }, [historyWindow]);

  // Persisted preferences restore once, off the effect body (a macrotask, so
  // the first paint still matches the server render exactly): sound defaults
  // off in private mode, and the Notification permission is read live.
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        if (window.localStorage.getItem(CHIME_STORAGE_KEY) === "on") {
          soundOnRef.current = true;
          setSoundOnState(true);
        }
      } catch {
        // Private mode: sound simply defaults off.
      }
      if ("Notification" in window) {
        const current = window.Notification.permission;
        permissionRef.current = current;
        setNotificationPermission(current);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const dismissToast = useCallback((toastId: string) => {
    const timer = toastTimers.current.get(toastId);
    if (timer) {
      clearTimeout(timer);
      toastTimers.current.delete(toastId);
    }
    setToasts((current) => current.filter((toast) => toast.id !== toastId));
  }, []);

  const pushToast = useCallback(
    (order: Order) => {
      const id = `${order.id}-${order.updatedAt}`;
      setToasts((current) => {
        if (current.some((toast) => toast.id === id)) return current;
        return [...current.slice(-2), { id, order }];
      });
      const timer = setTimeout(() => dismissToast(id), TOAST_MS);
      toastTimers.current.set(id, timer);
    },
    [dismissToast]
  );

  const poll = useCallback(
    async (initial: boolean, cafeId: string) => {
      // Always one café: the server would otherwise answer with every
      // membership's tickets, which is a union the shell never acts in.
      // The window filters in SQL, so a 24h board never downloads older
      // tickets just to hide them client-side.
      const from =
        initial && windowRef.current === "24h"
          ? new Date(Date.now() - BOARD_WINDOW_MS).toISOString()
          : null;
      const result = await fetchStaffOrders({
        restaurantId: cafeId,
        since: initial ? null : sinceRef.current,
        from,
        limit: 100,
      });
      sinceRef.current = result.serverTime;
      if (initial) {
        // The first load is context, not news: nothing badges or toasts.
        setOrders(result.orders);
        setAwaitingOrders(result.awaiting.orders);
        nextCursorRef.current = result.nextCursor;
        pageScopeRef.current = { cafeId, from };
        setHasMore(result.nextCursor !== null);
        seenAtRef.current = result.serverTime;
        setSeenAt(result.serverTime);
        // Totals ride along with the first page; a counts failure must not
        // fail the poll, so the board still renders without its header total.
        try {
          const totals = await fetchStaffOrderCounts({ restaurantId: cafeId, from });
          setCounts({ counts: totals.counts, total: totals.total });
        } catch {
          setCounts(null);
        }
      } else {
        const arrivals = detectNewOrders(result.orders, seenAtRef.current);
        setOrders((current) => mergeBoardOrders(current, result.orders, guardedRef.current));
        // A full snapshot every poll: paid tickets vanish from the strip
        // the moment the board adopts them, with no second request.
        setAwaitingOrders(result.awaiting.orders);
        if (arrivals.length > 0) {
          setHasArrived(true);
          // Sound follows the toggle, not the screen: a board left open on a
          // counter must still announce a ticket. Toasts and system
          // notifications stay for the other-screen case, where the ticket is
          // not already in front of the reader.
          if (soundOnRef.current) playOrderChime();
          if (!viewingRef.current) {
            for (const order of arrivals) pushToast(order);
            if (permissionRef.current === "granted") {
              try {
                for (const order of arrivals) {
                  new window.Notification(`New order · ${formatTableLabel(order.tableLabel)}`, {
                    body: notificationBody(order),
                    tag: order.id,
                  });
                }
              } catch {
                // A denied late-permission change stays silent.
              }
            }
          }
        }
        if (viewingRef.current) {
          // Watching the board is seeing: keep the badge cleared live.
          seenAtRef.current = result.serverTime;
          setSeenAt(result.serverTime);
        }
      }
      setLastSyncedAt(result.serverTime);
      setPhase("ready");
      setConnection("live");
      setPollError(null);
    },
    [pushToast]
  );

  useEffect(() => {
    const scope = monitorPollScope({ userId, restaurantId, pending });
    if (scope.kind === "signed-out") {
      sinceRef.current = null;
      seenAtRef.current = null;
      guardedRef.current = new Set();
      for (const timer of toastTimers.current.values()) clearTimeout(timer);
      toastTimers.current.clear();
      return;
    }
    if (scope.kind === "membership-pending") {
      // The café is still being resolved. Polling now would fetch the union of
      // every membership — the exact leak this guard exists to prevent.
      return;
    }
    if (scope.kind === "no-cafe") {
      // Signed in with no café to act in: an empty board is the truth here,
      // not a loading one. Deferred so the effect body never sets state.
      const settle = setTimeout(() => {
        setOrders([]);
        setAwaitingOrders([]);
        setPhase("ready");
        setConnection("idle");
        setLastSyncedAt(null);
        setPollError(null);
      }, 0);
      return () => clearTimeout(settle);
    }
    const cafeId = scope.restaurantId;
    let cancelled = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = (delay: number) => {
      if (cancelled) return;
      timer = setTimeout(() => void tick(), delay);
    };

    async function tick() {
      try {
        await poll(sinceRef.current === null, cafeId);
        if (cancelled) return;
        failures = 0;
        schedule(POLL_MS);
      } catch (tickError) {
        if (cancelled) return;
        failures += 1;
        setPhase((current) => (current === "loading" ? "error" : current));
        setConnection("reconnecting");
        setPollError(pollErrorMessage(tickError));
        schedule(Math.min(POLL_MS * 2 ** Math.min(failures, 3), MAX_BACKOFF_MS));
      }
    }

    const initial = setTimeout(() => void tick(), 0);
    const onVisible = () => {
      if (document.visibilityState === "visible") void poll(false, cafeId).catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      cancelled = true;
      clearTimeout(initial);
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
    // `historyWindow` restarts polling from a fresh cursor: the next tick
    // takes the initial path with the new window's `from`.
  }, [userId, restaurantId, pending, poll, historyWindow]);

  useEffect(
    () => () => {
      for (const timer of toastTimers.current.values()) clearTimeout(timer);
      toastTimers.current.clear();
    },
    []
  );

  const setSoundOn = useCallback((on: boolean) => {
    soundOnRef.current = on;
    setSoundOnState(on);
    try {
      window.localStorage.setItem(CHIME_STORAGE_KEY, on ? "on" : "off");
    } catch {
      // Preference stays in memory for the session.
    }
    if (on) playOrderChime();
  }, []);

  const requestNotifications = useCallback(async () => {
    if (!("Notification" in window)) return;
    try {
      const result = await window.Notification.requestPermission();
      permissionRef.current = result;
      setNotificationPermission(result);
    } catch {
      // Dismissed prompt: the button can try again later.
    }
  }, []);

  const setViewingBoard = useCallback((viewing: boolean) => {
    viewingRef.current = viewing;
    if (viewing && sinceRef.current) {
      seenAtRef.current = sinceRef.current;
      setSeenAt(sinceRef.current);
      setToasts([]);
    }
  }, []);

  const refresh = useCallback(() => {
    // Never refresh the union: with no café to act in there is nothing to read.
    if (!restaurantId) return;
    void poll(false, restaurantId).catch(() => undefined);
    const from =
      windowRef.current === "24h" ? new Date(Date.now() - BOARD_WINDOW_MS).toISOString() : null;
    void fetchStaffOrderCounts({ restaurantId, from })
      .then((totals) => setCounts({ counts: totals.counts, total: totals.total }))
      .catch(() => undefined);
  }, [poll, restaurantId]);

  const setHistoryWindow = useCallback((window: BoardWindow) => {
    if (windowRef.current === window) return;
    windowRef.current = window;
    setHistoryWindowState(window);
    // The restarted effect's first tick takes the initial path from here.
    sinceRef.current = null;
    nextCursorRef.current = null;
    pageScopeRef.current = null;
    setOrders([]);
    setCounts(null);
    setHasMore(false);
    setLoadingMore(false);
    loadingMoreRef.current = false;
    setPhase("loading");
  }, []);

  const loadMore = useCallback(() => {
    const scope = pageScopeRef.current;
    const cursor = nextCursorRef.current;
    if (!scope || !cursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    void fetchStaffOrders({
      restaurantId: scope.cafeId,
      from: scope.from,
      cursor,
      limit: 100,
    })
      .then((result) => {
        nextCursorRef.current = result.nextCursor;
        setHasMore(result.nextCursor !== null);
        setOrders((current) => mergeBoardOrders(current, result.orders, guardedRef.current));
      })
      .catch((loadError: unknown) => setPollError(pollErrorMessage(loadError)))
      .finally(() => {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      });
  }, []);

  const applyOptimistic = useCallback((orderId: string, status: OrderStatus) => {
    guardedRef.current.add(orderId);
    setOrders((current) =>
      current.map((entry) => (entry.id === orderId ? { ...entry, status } : entry))
    );
  }, []);

  const resolveOptimistic = useCallback((updated: Order) => {
    guardedRef.current.delete(updated.id);
    setOrders((current) => mergeBoardOrders(current, [updated], guardedRef.current));
  }, []);

  const revertOptimistic = useCallback((rollback: Order) => {
    guardedRef.current.delete(rollback.id);
    setOrders((current) => mergeBoardOrders(current, [rollback], guardedRef.current));
  }, []);

  const newCount = useMemo(
    () =>
      orders.filter((order) => {
        if (order.status !== "new" || seenAt === null) return order.status === "new";
        if (order.createdAt > seenAt) return true;
        return (
          order.paymentProvider === "stripe" &&
          order.paymentStatus === "paid" &&
          order.updatedAt > seenAt
        );
      }).length,
    [orders, seenAt]
  );

  const value = useMemo<MonitorValue>(
    () => ({
      orders,
      awaitingOrders,
      phase,
      connection,
      lastSyncedAt,
      pollError,
      newCount,
      toasts,
      soundOn,
      setSoundOn,
      hasArrived,
      notificationsAvailable,
      notificationPermission,
      requestNotifications,
      historyWindow,
      setHistoryWindow,
      counts,
      hasMore,
      loadingMore,
      loadMore,
      setViewingBoard,
      refresh,
      applyOptimistic,
      resolveOptimistic,
      revertOptimistic,
      dismissToast,
    }),
    [
      orders,
      awaitingOrders,
      phase,
      connection,
      lastSyncedAt,
      pollError,
      newCount,
      toasts,
      soundOn,
      setSoundOn,
      hasArrived,
      notificationsAvailable,
      notificationPermission,
      requestNotifications,
      historyWindow,
      setHistoryWindow,
      counts,
      hasMore,
      loadingMore,
      loadMore,
      setViewingBoard,
      refresh,
      applyOptimistic,
      resolveOptimistic,
      revertOptimistic,
      dismissToast,
    ]
  );

  return <MonitorContext.Provider value={value}>{children}</MonitorContext.Provider>;
}

/** Short public id for toasts and badges (`#41F563`-style). */
export function monitorOrderCode(orderId: string): string {
  return orderCode(orderId);
}
