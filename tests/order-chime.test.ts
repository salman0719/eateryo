import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ORDER_CHIME_DURATION_MS,
  ORDER_CHIME_NOTES,
  playOrderChime,
} from "@/features/orders/chime";

/**
 * The board's new-order chime is a short rising melody, deliberately longer
 * and more distinctive than the two-tone ping it replaced (0.38s). These pin
 * what makes it audible across a room — it climbs, it rings out — and that a
 * missing or blocked AudioContext is silence, not an error.
 */

class FakeParam {
  value = 0;
  setValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
}

class FakeNode {
  connect = vi.fn();
}

class FakeOscillator extends FakeNode {
  type = "sine";
  frequency = new FakeParam();
  start = vi.fn();
  stop = vi.fn();
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakeAudioContext {
  currentTime = 0;
  destination = new FakeNode();
  oscillators: FakeOscillator[] = [];
  resume = vi.fn(async () => undefined);
  close = vi.fn(async () => undefined);
  createOscillator() {
    const osc = new FakeOscillator();
    this.oscillators.push(osc);
    return osc;
  }
  createGain() {
    return new FakeGain();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ORDER_CHIME_NOTES", () => {
  it("is a rising motif, not a single interval", () => {
    const frequencies = ORDER_CHIME_NOTES.map((note) => note.frequency);
    expect(frequencies.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < frequencies.length; i += 1) {
      expect(frequencies[i]).toBeGreaterThan(frequencies[i - 1]);
    }
  });

  it("sounds its notes strictly later than the one before", () => {
    for (let i = 1; i < ORDER_CHIME_NOTES.length; i += 1) {
      expect(ORDER_CHIME_NOTES[i].at).toBeGreaterThan(ORDER_CHIME_NOTES[i - 1].at);
    }
    expect(ORDER_CHIME_NOTES[0].at).toBe(0);
  });

  it("holds the final note so the tail outlasts kitchen noise", () => {
    const last = ORDER_CHIME_NOTES[ORDER_CHIME_NOTES.length - 1];
    expect(last.duration).toBeGreaterThanOrEqual(0.9);
  });

  it("is longer than the retired two-tone ping (0.38s) but still one phrase", () => {
    expect(ORDER_CHIME_DURATION_MS).toBeGreaterThan(1000);
    expect(ORDER_CHIME_DURATION_MS).toBeLessThanOrEqual(2000);
  });

  it("keeps every note below clipping and inside a staff-facing range", () => {
    for (const note of ORDER_CHIME_NOTES) {
      expect(note.gain).toBeGreaterThan(0);
      expect(note.gain).toBeLessThanOrEqual(0.25);
      expect(note.frequency).toBeGreaterThanOrEqual(600);
    }
  });
});

describe("playOrderChime", () => {
  it("schedules a fundamental and an overtone for every note", () => {
    const ctx = new FakeAudioContext();
    const setTimeoutSpy = vi.fn(() => 0 as unknown as ReturnType<typeof setTimeout>);
    vi.stubGlobal("window", {
      AudioContext: function AudioContextStub() {
        return ctx;
      },
      setTimeout: setTimeoutSpy,
    });

    playOrderChime();

    expect(ctx.oscillators).toHaveLength(ORDER_CHIME_NOTES.length * 2);
    const starts = ctx.oscillators.map((osc) => osc.start.mock.calls[0][0] as number);
    // The last start belongs to the final note's overtone.
    expect(Math.max(...starts)).toBeCloseTo(ORDER_CHIME_NOTES[ORDER_CHIME_NOTES.length - 1].at, 5);
    const stops = ctx.oscillators.map((osc) => osc.stop.mock.calls[0][0] as number);
    expect(Math.max(...stops)).toBeGreaterThanOrEqual(1);
    // The context is closed only after the whole motif has rung out.
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), ORDER_CHIME_DURATION_MS + 300);
  });

  it("stays silent when the browser has no Web Audio", () => {
    vi.stubGlobal("window", { setTimeout: vi.fn() });
    expect(() => playOrderChime()).not.toThrow();
  });

  it("swallows a throwing AudioContext constructor", () => {
    vi.stubGlobal("window", {
      setTimeout: vi.fn(),
      AudioContext: function ThrowingAudioContext() {
        throw new Error("blocked");
      },
    });
    expect(() => playOrderChime()).not.toThrow();
  });
});
