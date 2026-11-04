"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

/**
 * Our own confirm dialog. Use it instead of `window.confirm`, `window.alert`
 * or `window.prompt`: native dialogs are unstyled, block the main thread,
 * cover the whole browser window (not the phone preview they belong to), and
 * cannot be driven by jsdom tests. The one native exception is `beforeunload`.
 */

export type ConfirmOptions = {
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive (delete / cancel actions). */
  destructive?: boolean;
};

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

/**
 * Returns `confirm(options)` (resolves true on confirm, false on cancel or
 * Escape) and the dialog element to render once in the component's tree.
 */
export function useConfirm() {
  const [pending, setPending] = useState<Pending | null>(null);

  // A newer confirm supersedes an open one, which resolves as cancelled.
  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setPending((previous) => {
          previous?.resolve(false);
          return { ...options, resolve };
        });
      }),
    [],
  );

  const answer = useCallback((ok: boolean) => {
    setPending((current) => {
      current?.resolve(ok);
      return null;
    });
  }, []);

  const dialog = pending ? <ConfirmDialog {...pending} onAnswer={answer} /> : null;

  return { confirm, dialog };
}

function ConfirmDialog({
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onAnswer,
}: ConfirmOptions & { onAnswer: (ok: boolean) => void }) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // false on the server and during hydration, true once mounted on the client.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  // Focus the panel on open and return focus to whatever had it before.
  useEffect(() => {
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    return () => returnTo?.focus();
  }, []);

  // Lock body scroll while open.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Escape cancels.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onAnswer(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onAnswer]);

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label={cancelLabel}
        tabIndex={-1}
        onClick={() => onAnswer(false)}
        className="absolute inset-0 bg-stone-900/40"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
      >
        <p id={titleId} className="text-sm text-ink-800">
          {message}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={() => onAnswer(false)}
            className="rounded-full border border-stone-300 px-4 py-2 text-sm font-medium text-ink-700 hover:border-stone-500"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => onAnswer(true)}
            className={
              destructive
                ? "rounded-full bg-danger-800 px-4 py-2 text-sm font-medium text-white hover:bg-danger-900"
                : "rounded-full bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700"
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
