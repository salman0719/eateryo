"use client";

import { useState } from "react";

import { HeightReveal } from "@/components/ui/height-reveal";
import { getRevealDuration, HEIGHT_REVEAL_DURATION } from "@/lib/motion/height-reveal";

const DISHES = [
  { name: "Sourdough, cultured butter, sea salt", price: "$6" },
  { name: "Roast squash, brown butter, sage", price: "$14" },
  { name: "Hand-cut tagliatelle, lemon, parmesan", price: "$17" },
  { name: "Charred broccoli, almond, chilli", price: "$11" },
  { name: "Burnt honey panna cotta", price: "$9" },
  { name: "Espresso, single origin", price: "$3.5" },
  { name: "Iced matcha, oat milk", price: "$5" },
];

function MenuCard({ rows }: { rows: number }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-[0_18px_40px_-32px_rgba(28,25,23,0.55)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-700">
        Lunch · today
      </p>
      <h3 className="mt-1 text-lg font-semibold text-stone-900">The counter menu</h3>
      <ul className="mt-3 divide-y divide-stone-100">
        {Array.from({ length: rows }, (_, index) => {
          const dish = DISHES[index % DISHES.length];
          return (
            <li
              key={`${dish.name}-${index}`}
              className="flex items-baseline justify-between gap-4 py-2"
            >
              <span className="text-sm text-stone-700">
                {index >= DISHES.length ? `${dish.name} (again)` : dish.name}
              </span>
              <span className="shrink-0 text-sm tabular-nums text-stone-500">{dish.price}</span>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 border-t border-stone-100 pt-3 text-xs text-stone-500">
        {rows} {rows === 1 ? "dish" : "dishes"} · prices include tax
      </p>
    </div>
  );
}

const BUTTON =
  "rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition-colors hover:border-stone-400 hover:bg-stone-50";

const STEP_BUTTON =
  "grid size-8 place-items-center rounded-full border border-stone-300 bg-white text-base leading-none text-stone-700 hover:border-stone-400";

/**
 * Demo-only speed presets. The first is the library's real default; the others
 * pass a larger `duration` base so a reveal is slow enough to watch frame by
 * frame. Production code never needs these.
 */
const SPEEDS = [
  { id: "normal", label: "1×", base: HEIGHT_REVEAL_DURATION },
  { id: "slow", label: "4×", base: HEIGHT_REVEAL_DURATION * 4 },
  { id: "slower", label: "8×", base: HEIGHT_REVEAL_DURATION * 8 },
] as const;

const DEFAULT_SPEED = SPEEDS[1];

export function HeightRevealDemo() {
  const [rows, setRows] = useState(4);
  const [narrow, setNarrow] = useState(false);
  const [run, setRun] = useState(0);
  const [baseDuration, setBaseDuration] = useState<number>(DEFAULT_SPEED.base);
  const [last, setLast] = useState<{ height: number; duration: number } | null>(null);

  const adjustRows = (delta: number) =>
    setRows((current) => Math.min(10, Math.max(1, current + delta)));

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">
          Developer preview
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-stone-900">Height reveal</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-stone-600">
          Both cards are React components wrapped in{" "}
          <code className="rounded bg-stone-100 px-1 py-0.5 text-[0.9em]">HeightReveal</code>. No
          pixel height is passed anywhere: the wrapper measures the rendered card before paint and
          animates its own box from 0 to that value, then settles back to{" "}
          <code className="rounded bg-stone-100 px-1 py-0.5 text-[0.9em]">height: auto</code>. The
          left one opts into{" "}
          <code className="rounded bg-stone-100 px-1 py-0.5 text-[0.9em]">observeResize</code>, so
          later height changes are animated from wherever the box currently is. The right one does
          not — same content, plain jump.
        </p>
      </header>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <button type="button" className={BUTTON} onClick={() => setRun((value) => value + 1)}>
          Replay entrance
        </button>
        <button type="button" className={BUTTON} onClick={() => setNarrow((value) => !value)}>
          {narrow ? "Use full width" : "Narrow the cards"}
        </button>
        <div className="ml-1 flex items-center gap-2 text-sm text-stone-600">
          <span className="pl-2">Rows</span>
          <button
            type="button"
            className={STEP_BUTTON}
            aria-label="One fewer row"
            onClick={() => adjustRows(-1)}
          >
            −
          </button>
          <span className="w-5 text-center tabular-nums text-stone-800">{rows}</span>
          <button
            type="button"
            className={STEP_BUTTON}
            aria-label="One more row"
            onClick={() => adjustRows(1)}
          >
            +
          </button>
        </div>
        <div className="ml-1 flex items-center gap-1 rounded-full border border-stone-300 bg-white p-1 text-sm">
          <span className="pl-2 pr-1 text-xs text-stone-500">Speed</span>
          {SPEEDS.map((speed) => (
            <button
              key={speed.id}
              type="button"
              aria-pressed={baseDuration === speed.base}
              title={`${speed.base} ms base duration`}
              className={`rounded-full px-2.5 py-1 text-xs font-medium tabular-nums transition-colors ${
                baseDuration === speed.base
                  ? "bg-stone-900 text-white"
                  : "text-stone-600 hover:bg-stone-100"
              }`}
              onClick={() => setBaseDuration(speed.base)}
            >
              {speed.label}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-3 text-xs text-stone-500">
        Try: add rows, then narrow the cards (text rewraps, so the height changes without the row
        count changing), then replay. The measured entrance changes with the content every time.{" "}
        {baseDuration === HEIGHT_REVEAL_DURATION ? (
          <>
            Speed is demo-only: at 1× the base <code>duration</code> is the library&apos;s{" "}
            {HEIGHT_REVEAL_DURATION} ms. Pick a slower speed to watch the frames.
          </>
        ) : (
          <>
            Speed is demo-only: it raises the <code>duration</code> base from the library&apos;s{" "}
            {HEIGHT_REVEAL_DURATION} ms to {baseDuration} ms. Changing it also remounts the cards,
            so the entrance replays.
          </>
        )}
      </p>

      <div className="mt-6 grid items-start gap-5 md:grid-cols-2">
        <section className="rounded-3xl border border-amber-200 bg-amber-50/40 p-4">
          <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <div className="flex items-center gap-2">
              <h2 className="font-mono text-xs font-semibold text-stone-800">observeResize</h2>
              <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                on
              </span>
            </div>
            {last ? (
              <p className="font-mono text-[11px] text-stone-500">
                {last.height.toFixed(1)}px · ~{last.duration}ms
              </p>
            ) : null}
          </header>
          <div className={narrow ? "mx-auto w-52" : ""}>
            <HeightReveal
              key={`observed-${run}-${baseDuration}`}
              duration={baseDuration}
              observeResize
              onRevealed={({ height }) =>
                setLast({ height, duration: getRevealDuration(height, baseDuration) })
              }
            >
              <MenuCard rows={rows} />
            </HeightReveal>
          </div>
        </section>

        <section className="rounded-3xl border border-stone-200 bg-stone-100/60 p-4">
          <header className="mb-3 flex items-center gap-2">
            <h2 className="font-mono text-xs font-semibold text-stone-700">HeightReveal</h2>
            <span className="rounded-full bg-stone-200 px-2 py-0.5 text-[11px] font-semibold text-stone-600">
              default
            </span>
          </header>
          <div className={narrow ? "mx-auto w-52" : ""}>
            <HeightReveal key={`plain-${run}-${baseDuration}`} duration={baseDuration}>
              <MenuCard rows={rows} />
            </HeightReveal>
          </div>
        </section>
      </div>

      <section className="mt-10 grid gap-4 text-sm leading-relaxed text-stone-600 sm:grid-cols-3">
        <div className="rounded-2xl border border-stone-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-stone-900">Measured, not configured</h2>
          <p className="mt-1.5">
            The inner box is never clamped, so `getBoundingClientRect` before paint is the real
            height. Nothing in this page knows the size of a card.
          </p>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-stone-900">Retargetable</h2>
          <p className="mt-1.5">
            When content changes mid-reveal, the current frame is frozen, the old animation is
            cancelled, and a new one starts from that exact height.
          </p>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-stone-900">Polite to the layout</h2>
          <p className="mt-1.5">
            Overflow is clipped only while a frame can overflow. Reduced-motion visitors get the
            content immediately, with no height lock behind it.
          </p>
        </div>
      </section>
    </div>
  );
}
