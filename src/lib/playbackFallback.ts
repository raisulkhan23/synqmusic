/**
 * Cross-provider playback fallback — PURE decision logic.
 *
 * WHY THIS EXISTS. Both playback paths can be blocked for a given listener at
 * the same time, and when that happens the app used to go quiet: a YouTube
 * track whose IFrame is blocked by an ad blocker, plus a direct-stream rescue
 * that YouTube bot-checks from any datacenter IP. Measured on the live
 * deployment, `youtube.resolveStream` returns `url: null` with "Sign in to
 * confirm you're not a bot" — so for that listener there was NO working path
 * and the only feedback was a toast twelve seconds later.
 *
 * The fix is not to make one provider more reliable. It is to stop depending
 * on a single domain: if YouTube cannot play here, try Jamendo, and vice
 * versa. Content blockers work by domain, so whichever of the two the
 * listener's blocker happens to allow is the one that plays.
 *
 * PURE, and that is the point. This module picks a fallback; it never fetches,
 * never plays and never touches the store. The matching rules below are the
 * part that is easy to get subtly wrong, so they are unit-testable without a
 * browser, a network or a deployment.
 */

import type { Playable } from "./playable";
import type { JamendoTrack } from "./jamendo";

/** Reduce a string for comparison: case, accents, punctuation, filler words. */
function key(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(
      /\((?:official|topic|audio|video|lyrics?|visualizer|hd|hq)[^)]*\)/g,
      " ",
    )
    .replace(/\b(feat|ft|featuring|with)\b[^,]*/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The query to send a provider when looking for this song by name. */
export function fallbackQueryFor(track: Playable): string {
  // One artist only: "Artist, Other Artist & Third" is a credit list, and
  // pasting the whole thing into a search reliably finds nothing.
  const artist = (track.artistName ?? "").split(",")[0]?.trim() ?? "";
  return `${track.title} ${artist}`.trim();
}

/**
 * How well a candidate matches what we were trying to play, 0..1.
 *
 * Deliberately conservative about the TITLE and lenient about the artist.
 * Titles are what a listener recognises; an artist credit is frequently
 * spelled differently between a YouTube upload and a Jamendo release, and
 * being too strict there throws away the only playable option they have left.
 */
export function matchScore(
  wanted: { title: string; artist: string },
  candidate: { title: string; artist: string },
): number {
  const wTitle = key(wanted.title);
  const cTitle = key(candidate.title);
  if (!wTitle || !cTitle) return 0;
  const wArtist = key(wanted.artist);
  const cArtist = key(candidate.artist);

  let score =
    wTitle === cTitle
      ? 0.75
      : cTitle.includes(wTitle) || wTitle.includes(cTitle)
        ? 0.5
        : 0;
  if (score === 0) return 0;
  if (
    wArtist &&
    cArtist &&
    (wArtist === cArtist ||
      cArtist.includes(wArtist) ||
      wArtist.includes(cArtist))
  ) {
    score += 0.25;
  }
  return Math.min(1, score);
}

/** Below this, a "match" is a different song wearing the same name. */
const MIN_MATCH = 0.5;

/**
 * Best Jamendo track for a song that could not play where it was.
 *
 * Returns null rather than the top result, because a fallback that silently
 * plays the WRONG song is worse than one that admits defeat: the listener
 * would hear something and assume the app worked.
 *
 * `excludeIds` drops sources that are already known to be dead here. It is
 * essential on the self-rescue path (a Jamendo track that failed being
 * re-matched against Jamendo), where the candidate list contains the very
 * track that just failed — picking it again would reload the same broken
 * stream in an endless loop.
 */
export function pickJamendoFallback(
  track: Playable,
  candidates: JamendoTrack[],
  excludeIds: readonly string[] = [],
): JamendoTrack | null {
  // Callers hold a Playable id (`jamendo:<jamendoId>`) while a candidate
  // carries the raw `jamendoId`, so accept either spelling.
  const dead = new Set<string>();
  for (const id of excludeIds) {
    dead.add(id);
    if (id.startsWith("jamendo:")) dead.add(id.slice("jamendo:".length));
  }
  let best: JamendoTrack | null = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    if (dead.has(candidate.jamendoId)) continue;
    const score = matchScore(
      { title: track.title, artist: track.artistName ?? "" },
      { title: candidate.title, artist: candidate.artistName },
    );
    // A track with no usable duration cannot be played or seeked.
    if (score > bestScore && candidate.duration > 0) {
      best = candidate;
      bestScore = score;
    }
  }
  return bestScore >= MIN_MATCH ? best : null;
}

/** The label shown when a track is swapped for another source's copy. */
export function fallbackNotice(from: Playable, to: Playable): string {
  const where = to.source === "jamendo" ? "Jamendo" : "YouTube";
  return `Couldn't play this here — using the ${where} version`;
}

/**
 * What to tell the listener when EVERY rescue path for this track is dead.
 *
 * Two distinct messages, because the two failures mean different things: a
 * blocked provider is worth naming (so the listener can allow it or turn a
 * blocker off), while a song nobody hosts anywhere is simply unavailable.
 */
export function giveUpNotice(options: {
  blockedProvider?: string | null;
  hasAlternatives?: boolean;
}): string {
  if (options.blockedProvider)
    return `Your blocker is blocking ${options.blockedProvider} — allow it to hear this song`;
  if (options.hasAlternatives)
    return "Every version of this song failed to play";
  return "Couldn't find a playable copy of this song";
}
