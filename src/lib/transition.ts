// ---------------------------------------------------------------------------
// Song transition decisions — pure, no DOM, no store, no engine.
//
// Everything about *whether* a song should crossfade, gapless-play or cut
// abruptly is decided here so it can be unit tested without a browser, a
// Web Audio context or a running queue. `src/store/player.ts` owns the audio
// and asks this module what to do; it never re-derives the rules itself.
//
// Why a separate module at all: the transition rules are the part most likely
// to regress quietly. "Repeat one must never crossfade" or "an A-B loop must
// not be interrupted" are one-line guards that are invisible in a 3,700-line
// store, so they live here with tests next to them.
// ---------------------------------------------------------------------------

/** User-selectable crossfade lengths, in seconds. 0 means off. */
export const CROSSFADE_CHOICES = [0, 2, 4, 6, 8, 10] as const;

/**
 * Default is 0 (off). A crossfade is an opinionated listening choice — it
 * overlaps two songs and hides the outro of one — so it must be opted into,
 * not inflicted. Gapless is the default because removing a *gap* is not the
 * same as blending anything: it just stops inventing silence that was never
 * in the recording.
 */
export const DEFAULT_CROSSFADE = 0;

/** Gapless removes artificial silence; it never overlaps two songs. */
export const DEFAULT_GAPLESS = true;

/**
 * Manual skips get a much shorter blend than an automatic one. Asking for the
 * next song means "play it now", so a long crossfade would make the control
 * feel broken — you press Next and then wait several seconds for the song you
 * asked for.
 */
export const MANUAL_SKIP_FADE_SECONDS = 0.9;

/**
 * Longest fade we will ever run. Beyond this two songs overlap for so long
 * that listeners report it as the previous song "still playing", and on a slow
 * connection the incoming stream may not have buffered that far in.
 */
export const MAX_FADE_SECONDS = 12;

/**
 * Don't crossfade across most of a very short clip (an intro sting, a 20s
 * skit). Overlapping half of a short track destroys it rather than smoothing
 * it, so short tracks cut normally.
 */
export const MIN_TRACK_FOR_FADE_SECONDS = 30;

/**
 * Ceiling on the pre-roll. The incoming track has to have loaded by the time
 * the fade starts; resolving a stream and buffering takes real time, so a very
 * long crossfade would begin on silence. Above this we shorten the fade rather
 * than start it early enough that the listener notices the last chorus missing.
 */
export const MAX_PREP_SECONDS = 20;

/** How long before the fade begins we start preparing the next track. */
export const PRELOAD_LEAD_SECONDS = 12;

/** Why we are transitioning. Drives the fade length and the guards. */
export type TransitionReason =
  | "track-ended"
  | "manual-next"
  | "manual-prev"
  | "autoplay";

export type TransitionMode =
  /** Overlap two songs, fading one out as the other fades in. */
  | "crossfade"
  /**
   * Start the next song at the exact moment the current one stops, with no
   * overlap. This is what an album, a live set or a DJ mix wants.
   */
  | "gapless"
  /** No transition: stop and start. The safe default when in doubt. */
  | "cut";

export interface TransitionPlan {
  mode: TransitionMode;
  /** Total transition length in seconds. 0 for `cut`. */
  seconds: number;
  /**
   * Seconds before the current track's end at which the transition begins.
   * `seconds` for a crossfade (that is the overlap), 0 for gapless/cut.
   */
  leadSeconds: number;
  reason: TransitionReason;
  /** Human-readable justification, surfaced in tests and debugging. */
  because: string;
}

export interface TransitionRequest {
  /** Configured crossfade length in seconds (0 = off). */
  crossfadeSeconds: number;
  /** Whether the listener enabled gapless playback. */
  gaplessEnabled: boolean;
  reason: TransitionReason;
  /** Duration of the track that is playing right now, in seconds. */
  currentDuration: number;
  /** How far into the current track we are, in seconds. */
  currentTime: number;
  /** Is there a next track queued at all? */
  hasNext: boolean;
  /** Both tracks must be on the <audio> element for a real crossfade. */
  canCrossfade: boolean;
  /** The next track belongs to the same album/collection as the current one. */
  sameAlbum: boolean;
  /** A-B repeat is armed and looping — never interrupt it. */
  abRepeatActive: boolean;
  /** Repeat-one restarts the same track; a transition would be wrong. */
  repeatOne: boolean;
  /** The listener paused; there is nothing to transition out of. */
  paused: boolean;
}

/** Coerce anything (storage, a stale value, NaN) into a sane crossfade length. */
export function normalizeCrossfade(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n > MAX_FADE_SECONDS) return MAX_FADE_SECONDS;
  // Sub-second fades are a click, not a crossfade. Treat anything under a
  // perceptible threshold as "off" rather than pretending to blend.
  if (n < 0.4) return 0;
  return Math.round(n * 10) / 10;
}

/** True when `seconds` is one of the offered preset lengths. */
export function isPresetCrossfade(seconds: number): boolean {
  return (CROSSFADE_CHOICES as readonly number[]).includes(seconds);
}

/**
 * Clamp a requested fade so it can never swallow the track.
 *
 * Two independent limits apply: never fade for more than half the track's own
 * length (a 20s clip with a 12s fade is 60% gone before the new song is
 * audible), and never fade for longer than we have left to play.
 */
export function clampFade(
  requested: number,
  currentDuration: number,
  remaining: number,
): number {
  let seconds = Math.min(requested, MAX_FADE_SECONDS);
  if (Number.isFinite(currentDuration) && currentDuration > 0) {
    if (currentDuration < MIN_TRACK_FOR_FADE_SECONDS) return 0;
  }
  if (Number.isFinite(remaining) && remaining > 0) {
    // Leave a sliver of the outgoing track audible so the change is a blend
    // rather than an early cut.
    seconds = Math.min(seconds, Math.max(0, remaining - 0.05));
  }
  return Math.max(0, Math.round(seconds * 100) / 100);
}

/**
 * Decide how to get from the current song to the next one.
 *
 * Order matters. The guards that must never be overridden come first (a repeat
 * or an A-B loop is the listener explicitly asking for the *same* audio), then
 * the source capability (no tappable source means no real crossfade), then the
 * context, and only then the listener's configured length.
 */
export function planTransition(req: TransitionRequest): TransitionPlan {
  const cut = (because: string): TransitionPlan => ({
    mode: "cut",
    seconds: 0,
    leadSeconds: 0,
    reason: req.reason,
    because,
  });

  // Repeat-one and A-B repeat both mean "play this again", not "move on".
  // A crossfade here would fade the track out while the repeat restarts it and
  // the listener would hear the same song twice at once.
  if (req.repeatOne) return cut("repeat-one restarts the same track");
  if (req.abRepeatActive) return cut("A-B repeat is looping a section");
  if (req.paused) return cut("playback is paused");
  if (!req.hasNext) return cut("nothing queued after this track");

  const remaining = Math.max(
    0,
    (Number.isFinite(req.currentDuration) ? req.currentDuration : 0) -
      (Number.isFinite(req.currentTime) ? req.currentTime : 0),
  );

  // Album boundaries are the artist's own transition. Overlapping two of them
  // destroys the seam they wrote, so a crossfade is never applied here — not
  // even when one is configured and technically possible. With gapless on the
  // boundary is preserved exactly; with it off, the tracks simply butt-join.
  if (req.sameAlbum) {
    return req.gaplessEnabled
      ? {
          mode: "gapless",
          seconds: 0,
          leadSeconds: 0,
          reason: req.reason,
          because: "gapless keeps a continuous album boundary intact",
        }
      : cut("album boundaries are never crossfaded");
  }

  // Previous is a NAVIGATION intent, not a skip. It must never take the
  // end-of-track crossfade path: the listener asked to go back, and the
  // store's own "restart if you are past 3s" behaviour owns what happens next.
  if (req.reason === "manual-prev") {
    return cut("previous is handled by the player, not the fade path");
  }

  // Manual skips are a "now" request: blend quickly, never make the listener
  // wait out their configured crossfade.
  const requested =
    req.reason === "manual-next"
      ? Math.min(req.crossfadeSeconds, MANUAL_SKIP_FADE_SECONDS)
      : req.crossfadeSeconds;

  const wantsCrossfade = requested > 0;
  if (wantsCrossfade && req.canCrossfade) {
    const seconds = clampFade(requested, req.currentDuration, remaining);
    if (seconds > 0) {
      return {
        mode: "crossfade",
        seconds,
        leadSeconds: seconds,
        reason: req.reason,
        because:
          req.reason === "track-ended" || req.reason === "autoplay"
            ? "crossfade into the next track"
            : "short blend on a manual skip",
      };
    }
  }

  // Gapless: the next song starts exactly where this one stops. It overlaps
  // nothing, so it is the safe improvement whenever a real crossfade is not
  // on the table.
  if (req.gaplessEnabled) {
    return {
      mode: "gapless",
      seconds: 0,
      leadSeconds: 0,
      reason: req.reason,
      because: "gapless removes the silence between tracks",
    };
  }

  if (wantsCrossfade && !req.canCrossfade) {
    return cut("the current source cannot be crossfaded");
  }
  return cut("no transition configured");
}

// --- fade curves -------------------------------------------------------------

/**
 * Volume multipliers for a crossfade at normalised progress `t` (0 → 1).
 *
 * Uses an equal-power (sin/cos) curve rather than linear. Two linearly
 * crossfading tracks sum to a dip in the middle — at t=0.5 each is at half
 * volume, which is −6dB of perceived loudness, and the transition audibly
 * sags. sin/cos keeps the summed power constant, so the blend holds its level
 * all the way through.
 *
 * Returns the OUTGOING track's multiplier; the incoming is returned explicitly
 * too so the pair can never be mismatched at a call site.
 */
export function fadeGains(t: number): { outgoing: number; incoming: number } {
  const p = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  const angle = (p * Math.PI) / 2;
  return {
    outgoing: Math.cos(angle),
    incoming: Math.sin(angle),
  };
}

/**
 * True when a crossfade should begin, given where we are in the track.
 *
 * Kept separate from the scheduler so the "start at the right moment" rule can
 * be tested directly: a plan must fire exactly once, at `remaining <= lead`,
 * and never before.
 */
export function shouldStartFade(
  plan: TransitionPlan,
  remaining: number,
  lastRemaining: number | null,
): boolean {
  if (plan.mode === "cut") return false;
  if (plan.leadSeconds <= 0) return false;
  if (!Number.isFinite(remaining) || remaining < 0) return false;
  if (remaining > plan.leadSeconds) return false;
  // `timeupdate` can skip several seconds on a slow device or a buffering
  // stall. Crossing the boundary from above is what identifies the moment;
  // without it, any late poll would re-trigger the same transition.
  if (lastRemaining === null) return true;
  return lastRemaining > plan.leadSeconds;
}

/** How early to start preparing (resolving + buffering) the next track. */
export function preloadLead(plan: TransitionPlan): number {
  if (plan.mode !== "crossfade") return 0;
  return Math.min(MAX_PREP_SECONDS, plan.leadSeconds + PRELOAD_LEAD_SECONDS);
}
