/**
 * The new-order chime.
 *
 * For the person at the pass this is not decoration: it has to cross a noisy
 * room and be unmistakable for a timer or a till beep. So it is a short
 * *melody* rather than the two-tone ping the board used to play — an E-major
 * arpeggio that climbs (E5 · G#5 · B5 · E6) with the top note left to ring
 * for a second. The rising shape says "something arrived" without words, and
 * the held tail outlasts the ambient clatter that a 0.2-second blip
 * disappears into.
 *
 * Everything here is best-effort: a blocked AudioContext (autoplay policy,
 * private mode, no Web Audio at all) is silence, never an error. Sound must
 * never break the board.
 */

export interface ChimeNote {
  /** Pitch in Hz. */
  frequency: number;
  /** Seconds after the chime starts. */
  at: number;
  /** How long the note sounds, envelope included. */
  duration: number;
  /** Peak gain, before the shared bell overtone. */
  gain: number;
  /** Fundamental shape; the overtone is always a sine. */
  type: OscillatorType;
}

/**
 * An ascending E-major arpeggio. The notes overlap slightly so the chime
 * reads as one phrase rather than four pings, and the last note rings for
 * about a second: total ~1.45s, against the 0.38s two-tone it replaces.
 */
export const ORDER_CHIME_NOTES: readonly ChimeNote[] = [
  { frequency: 659.25, at: 0, duration: 0.42, gain: 0.16, type: "triangle" }, // E5
  { frequency: 830.61, at: 0.13, duration: 0.42, gain: 0.15, type: "triangle" }, // G#5
  { frequency: 987.77, at: 0.26, duration: 0.5, gain: 0.15, type: "triangle" }, // B5
  { frequency: 1318.51, at: 0.4, duration: 1.05, gain: 0.17, type: "sine" }, // E6
];

/** Whole length of the motif in milliseconds (the last note's tail included). */
export const ORDER_CHIME_DURATION_MS = Math.round(
  Math.max(...ORDER_CHIME_NOTES.map((note) => note.at + note.duration)) * 1000
);

/** How long the AudioContext stays open after the last note ends. */
const CONTEXT_TAIL_MS = 300;
/** Attack ramp: long enough to avoid a click, short enough to stay a chime. */
const ATTACK_S = 0.012;
/** Bell overtone one octave above the fundamental, quiet under it. */
const OVERTONE_RATIO = 2;
const OVERTONE_GAIN = 0.22;

function writeVoice(
  ctx: AudioContext,
  at: number,
  frequency: number,
  type: OscillatorType,
  gain: number,
  duration: number
): void {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.value = frequency;
  // Exponential ramps cannot touch zero, so the envelope starts and ends
  // just above it.
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(gain, at + ATTACK_S);
  env.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  osc.connect(env);
  env.connect(ctx.destination);
  osc.start(at);
  osc.stop(at + duration + ATTACK_S);
}

/** Play the new-order chime once. Silent on any failure. */
export function playOrderChime(): void {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    // iOS/Safari hands back a suspended context; resuming is allowed here
    // because the board only ever chimes after the staffer's own gesture
    // (the sound toggle) or a later arrival in the same tab.
    void ctx.resume?.().catch(() => undefined);
    const start = ctx.currentTime;
    for (const note of ORDER_CHIME_NOTES) {
      const at = start + note.at;
      writeVoice(ctx, at, note.frequency, note.type, note.gain, note.duration);
      writeVoice(
        ctx,
        at,
        note.frequency * OVERTONE_RATIO,
        "sine",
        note.gain * OVERTONE_GAIN,
        note.duration * 0.55
      );
    }
    window.setTimeout(
      () => void ctx.close().catch(() => undefined),
      ORDER_CHIME_DURATION_MS + CONTEXT_TAIL_MS
    );
  } catch {
    // Sound is decoration; a blocked AudioContext stays silent.
  }
}
