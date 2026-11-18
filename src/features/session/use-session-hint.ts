"use client";

import { useSyncExternalStore } from "react";

import { readBrowserSessionHint, type SessionHint } from "./session-hint";

/**
 * Cookies are shared across tabs, so another tab signing in or out (or the
 * browser clearing the jar) is the change this store can be told about. The
 * shell's session atom already refetches on Better Auth's broadcast; these
 * listeners simply make sure the hint snapshot is re-read at the same moment.
 */
function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("focus", onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener("focus", onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * The prerendered and hydrated frame must agree, and neither can know what
 * cookie a request carried — so the server snapshot is always `unknown`. The
 * store then re-reads `document.cookie` after hydration, which is what turns
 * the placeholder into the visitor's screen without a round trip.
 */
const serverSnapshot = (): SessionHint => "unknown";

/** The hint as this browser can see it, read before the session answers. */
export function useSessionHint(): SessionHint {
  return useSyncExternalStore(subscribe, readBrowserSessionHint, serverSnapshot);
}
