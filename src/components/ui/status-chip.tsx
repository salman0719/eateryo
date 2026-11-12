import type { ReactNode } from "react";

/**
 * The one status chip. Status is a word, not a surface: a neutral `surface-100`
 * pill with `ink-900` text and a 6px dot that carries the hue. `success`,
 * `warning` and `info` never fill a chip, a banner or a button — the accent owns
 * fills, and a second filled green beside it reads as a rival primary action
 * (ΔE 0.115, and rotating the brand hue inside the green family does not fix it:
 * 169° → 186° moves that to 0.117).
 *
 * The dot is `aria-hidden`: the words already say what the state is, so a screen
 * reader hears "Ordering open" once, not a colour name.
 */
export type StatusTone = "success" | "warning" | "info" | "danger" | "neutral";

const DOT_CLASS: Record<StatusTone, string> = {
  success: "bg-success-700",
  warning: "bg-warning-600",
  info: "bg-info-700",
  danger: "bg-danger-700",
  neutral: "bg-ink-400",
};

const SIZE_CLASS = {
  sm: "gap-1.5 px-2 py-0.5 text-[11px]",
  md: "gap-1.5 px-2.5 py-0.5 text-xs",
} as const;

export function StatusChip({
  tone = "neutral",
  size = "md",
  className = "",
  children,
}: {
  tone?: StatusTone;
  size?: keyof typeof SIZE_CLASS;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full bg-surface-100 font-semibold whitespace-nowrap text-ink-900 ${SIZE_CLASS[size]} ${className}`}
    >
      <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${DOT_CLASS[tone]}`} />
      {children}
    </span>
  );
}
