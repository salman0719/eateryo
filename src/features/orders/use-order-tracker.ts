"use client";

/**
 * Diner order tracker (v1): same-device resume + opt-in shareable link.
 *
 * Locked decisions: sessionStorage resume, 24h after terminal + 7d hard cap
 * (enforced server-side, mirrored here for storage pruning), 10s visible-only
 * polling with jitter, stop on terminal, dine-in copy (Received → Preparing
 * → Served).
 *
 * Storage: `sessionStorage["eateryo-order-trackers"]` holds at most 3
 * entries `{ orderId, token, expiresAt, placedAt }`. A reload resumes from
 * the stored token; closing the tab forgets it. The shareable link is never
 * written automatically — the diner copies it explicitly.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { fetchTrackedOrder } from "./client";
import type { Order } from "./schema";
import { SyncError } from "@/features/menus/sync";

export interface StoredTracker {
  orderId: string;
  token: string;
  expiresAt: string;
  placedAt: string;
}

const STORAGE_KEY = "eateryo-order-trackers";
const MAX_TRACKERS = 3;
const POLL_BASE_MS = 10_000;
const POLL_JITTER_MS = 2_000;
const BACKOFFS_MS = [20_000, 40_000, 60_000];

export function isTerminalStatus(status: Order["status"]): boolean {
  return status === "served" || status === "cancelled";
}

export function trackerCopy(status: Order["status"]): string {
  switch (status) {
    case "new":
      return "Order received — waiting for the kitchen.";
    case "preparing":
      return "The kitchen is preparing your order.";
    case "served":
      return "Your order has been served.";
    case "cancelled":
      return "This order was cancelled — ask staff.";
  }
}

export function loadTrackers(): StoredTracker[] {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return [];
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredTracker[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry) =>
        typeof entry?.orderId === "string" &&
        typeof entry?.token === "string" &&
        typeof entry?.expiresAt === "string"
    );
  } catch {
    return [];
  }
}

function writeTrackers(entries: StoredTracker[]): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_TRACKERS)));
  } catch {
    // Private mode: tracking still works for this page load.
  }
}

export function saveTracker(entry: StoredTracker): StoredTracker[] {
  const next = [entry, ...loadTrackers().filter((item) => item.orderId !== entry.orderId)].slice(
    0,
    MAX_TRACKERS
  );
  writeTrackers(next);
  return next;
}

export function removeTracker(orderId: string): StoredTracker[] {
  const next = loadTrackers().filter((item) => item.orderId !== orderId);
  writeTrackers(next);
  return next;
}

export type TrackerPhase = "loading" | "live" | "expired" | "error";

interface UseOrderTrackerInput {
  orderId: string;
  token: string | null;
  initialOrder: Order;
}

interface UseOrderTrackerResult {
  order: Order;
  phase: TrackerPhase;
  error: string | null;
  lastSyncedAt: string | null;
  notificationPermission: NotificationPermission | "unsupported";
  notificationsAvailable: boolean;
  requestNotifications: () => Promise<void>;
  refresh: () => void;
  dismiss: () => void;
}

function pollErrorCopy(error: unknown): string {
  if (error instanceof SyncError) {
    if (error.code === "not_found") return "expired";
    if (error.code === "rate_limited") return error.message;
    return error.message;
  }
  return "Could not reach the server. Check your connection.";
}

export function useOrderTracker({
  orderId,
  token,
  initialOrder,
}: UseOrderTrackerInput): UseOrderTrackerResult {
  const [order, setOrder] = useState<Order>(initialOrder);
  const [phase, setPhase] = useState<TrackerPhase>(token ? "loading" : "live");
  const [error, setError] = useState<string | null>(
    token ? null : "No tracking link for this order."
  );
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | "unsupported"
  >("unsupported");

  const orderRef = useRef(order);
  const failuresRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortedRef = useRef(false);
  const notifiedRef = useRef(false);

  const notificationsAvailable = typeof window !== "undefined" && "Notification" in window;

  // Restored off the effect body (a macrotask, so the first paint still
  // matches the server render): the permission read never sets state sync.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!("Notification" in window)) return;
      try {
        setNotificationPermission(window.Notification.permission);
      } catch {
        // Leave as unsupported.
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    orderRef.current = order;
  }, [order]);

  const requestNotifications = useCallback(async () => {
    if (!("Notification" in window)) return;
    try {
      const result = await window.Notification.requestPermission();
      setNotificationPermission(result);
    } catch {
      // Dismissed prompt: the button can try again later.
    }
  }, []);

  const notifyServed = useCallback((next: Order) => {
    if (notifiedRef.current) return;
    if (next.status !== "served") return;
    notifiedRef.current = true;
    if (!("Notification" in window)) return;
    if (window.Notification.permission !== "granted") return;
    const raise = () => {
      try {
        new window.Notification("Your order has been served", {
          body: `Order #${
            next.id
              .replace(/[^a-z0-9]/gi, "")
              .slice(-6)
              .toUpperCase() || "ORDER"
          } is at your table.`,
          tag: next.id,
        });
      } catch {
        // A denied late-permission change stays silent; the page still shows it.
      }
    };
    // One tab notifies: hold the order lock when the browser offers it so
    // two tabs with the same tracker do not chime twice.
    const locks = (
      window.navigator as Navigator & {
        locks?: { request: (name: string, fn: () => Promise<void>) => Promise<void> };
      }
    ).locks;
    if (locks) {
      void locks
        .request(`eateryo-serve-${next.id}`, async () => {
          raise();
        })
        .catch(() => undefined);
    } else {
      raise();
    }
  }, []);

  const refresh = useCallback(() => {
    if (!token) return;
    void (async () => {
      try {
        const result = await fetchTrackedOrder(token);
        if (abortedRef.current) return;
        setOrder(result.order);
        setLastSyncedAt(result.serverTime);
        failuresRef.current = 0;
        setPhase("live");
        setError(null);
        notifyServed(result.order);
      } catch (refreshError) {
        if (abortedRef.current) return;
        if (refreshError instanceof SyncError && refreshError.code === "not_found") {
          setPhase("expired");
          setError("That order link is no longer valid. Ask staff to check your order.");
          return;
        }
        setError(pollErrorCopy(refreshError));
      }
    })();
  }, [token, notifyServed]);

  const dismiss = useCallback(() => {
    removeTracker(orderId);
    setPhase("expired");
  }, [orderId]);

  useEffect(() => {
    abortedRef.current = false;
    if (!token) {
      // No token: the confirmation itself is the truth; nothing to poll.
      return () => {
        abortedRef.current = true;
      };
    }
    let delay = 0;

    const tick = async () => {
      if (abortedRef.current) return;
      if (document.visibilityState !== "visible") {
        timerRef.current = setTimeout(tick, 2000);
        return;
      }
      try {
        const result = await fetchTrackedOrder(token);
        if (abortedRef.current) return;
        setOrder(result.order);
        setLastSyncedAt(result.serverTime);
        failuresRef.current = 0;
        setPhase("live");
        setError(null);
        notifyServed(result.order);
        if (isTerminalStatus(result.order.status)) return;
        delay = POLL_BASE_MS + Math.random() * POLL_JITTER_MS;
      } catch (tickError) {
        if (abortedRef.current) return;
        if (tickError instanceof SyncError && tickError.code === "not_found") {
          setPhase("expired");
          setError("That order link is no longer valid. Ask staff to check your order.");
          return;
        }
        failuresRef.current += 1;
        setPhase("error");
        setError(pollErrorCopy(tickError));
        const backoff =
          BACKOFFS_MS[Math.min(failuresRef.current - 1, BACKOFFS_MS.length - 1)] ??
          BACKOFFS_MS[BACKOFFS_MS.length - 1];
        delay = backoff + Math.random() * POLL_JITTER_MS;
      }
      if (abortedRef.current) return;
      if (isTerminalStatus(orderRef.current.status)) return;
      timerRef.current = setTimeout(() => void tick(), delay);
    };

    timerRef.current = setTimeout(() => void tick(), 0);

    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("pageshow", onVisible);
    return () => {
      abortedRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("pageshow", onVisible);
    };
  }, [token, notifyServed]);

  useEffect(
    () => () => {
      abortedRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  return {
    order,
    phase,
    error,
    lastSyncedAt,
    notificationPermission,
    notificationsAvailable,
    requestNotifications,
    refresh,
    dismiss,
  };
}
