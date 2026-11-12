"use client";

import { useOrderMonitor } from "@/features/orders/monitor";

/**
 * Badge for unseen `new` orders; null when there is nothing to shout about.
 *
 * Three placements, one count: `pill` sits inside a desktop tab, `bar` is the
 * dot on a phone tab icon, and `rail` is the corner badge on the sidebar's
 * Orders destination (the expanded sidebar and the icon rail share it).
 */
export function NewOrdersBadge({ tone }: { tone: "bar" | "pill" | "rail" }) {
  const { newCount } = useOrderMonitor();
  if (newCount === 0) return null;
  const label = newCount > 9 ? "9+" : String(newCount);
  if (tone === "pill") {
    return (
      <span className="ml-1.5 rounded-full bg-danger-600 px-1.5 py-0.5 text-xs font-bold text-on-accent">
        {label}
      </span>
    );
  }
  if (tone === "rail") {
    return (
      <span className="absolute top-1.5 right-1.5 flex min-h-[16px] min-w-[16px] items-center justify-center rounded-full bg-danger-600 px-1 text-[10px] font-bold text-on-accent">
        {label}
      </span>
    );
  }
  return (
    <span className="absolute top-1 right-[calc(50%-22px)] flex min-h-[20px] min-w-[20px] items-center justify-center rounded-full bg-danger-600 px-1 text-[11px] font-bold text-on-accent">
      {label}
    </span>
  );
}
