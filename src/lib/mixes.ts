/**
 * SYNQ Mixes — pure logic, no imports beyond the shared track shape.
 *
 * A "Mix" here is SYNQ's answer to Apple Music's personalised mixes: a short,
 * named, continuously-usable set of tracks that a listener can press play on
 * and let run. It is NOT a new playback engine and NOT a new recommender. Every
 * track in a mix comes from data SYNQ already has (the recommendation sections
 * the Home page fetches, the listening history, the most-played shelf, the live
 * discovery shelves). This file only decides which of those sets deserve to be
 * called a mix, what to call them, and in what order.
 *
 * ── Why it is pure ─────────────────────────────────────────────────────────
 *
 * No I/O, no clock reads except an injected date, no React. The assembly rules
 * (dedupe, minimum size, daily rotation) can then be tested without a network
 * or a browser, and the Home page stays a renderer rather than a second
 * recommender.
 *
 * ── What it deliberately will NOT do ───────────────────────────────────────
 *
 * It never invents a themed genre. SYNQ has no genre or mood metadata anywhere
 * (see `lib/recommend.ts`), so a "Chill Mix" built by guessing would be fiction
 * wearing a label. Every mix below is named for the real signal that fills it:
 * a mix is "On repeat" because it is the listener's most-played tracks, not
 * because a classifier decided they are energetic.
 *
 * The one playful exception, Guilty Pleasures, is a curated SEARCH (a real
 * upstream query that returns real results on demand) rather than a mix built
 * here — see `MOOD_LAUNCHES` on the Home page. It is kept out of this builder
 * so no mix card can ever claim a taste profile the data cannot support.
 */

import type { YtItem } from "@/lib/youtube";

/** One personalized mix, ready to render or play. */
export interface Mix {
  id: string;
  name: string;
  subtitle: string;
  items: YtItem[];
  /** Static Tailwind gradient classes for the tile, from SYNQ's palette. */
  accent: string;
}

/** The already-fetched Home data a mix may be assembled from. */
export interface MixSources {
  /** Tracks the listener has liked, newest first (signed-in only). */
  favorites?: YtItem[];
  /** The listener's most-played tracks, most played first. */
  mostPlayed?: YtItem[];
  /** Recently played, most recent first. */
  recent?: YtItem[];
  /** The engine's "Discover something new" row. */
  discovery?: YtItem[];
  /** New releases / this week's picks. */
  newMusic?: YtItem[];
  /** The engine's "Sounds like what you play" row. */
  soundAlike?: YtItem[];
  /** Time-of-day picks ("evening music hits" and friends). */
  timeOfDay?: YtItem[];
}

/**
 * How many real tracks a set needs before it is allowed to be called a mix.
 *
 * Below this the card is a lie: three songs is a playlist someone made, not an
 * endless personal mix. Matches the recommendation engine's own hesitancy to
 * personalise from two data points.
 */
export const MIN_MIX_TRACKS = 4;

/** Cap so a huge history does not build a 400-track mix card. */
export const MAX_MIX_TRACKS = 40;

/** A track is usable only if it can actually be identified and played. */
function usable(item: YtItem | undefined | null): item is YtItem {
  return Boolean(item && item.id && item.title);
}

/** De-duplicate by track id, preserving order, and drop unusable rows. */
function clean(items: YtItem[] | undefined): YtItem[] {
  if (!items || items.length === 0) return [];
  const seen = new Set<string>();
  const out: YtItem[] = [];
  for (const item of items) {
    if (!usable(item) || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
    if (out.length >= MAX_MIX_TRACKS) break;
  }
  return out;
}

/** Deterministic rotation so a mix "refreshes" without a stored cursor. */
function rotate<T>(items: T[], by: number): T[] {
  if (items.length === 0) return items;
  const n = ((by % items.length) + items.length) % items.length;
  if (n === 0) return items;
  return [...items.slice(n), ...items.slice(0, n)];
}

/** Day index since the epoch. The seed for the once-a-day mix reshuffle. */
function dayIndex(date: Date): number {
  return Math.floor(date.getTime() / 86_400_000);
}

interface MixBlueprint {
  id: string;
  name: string;
  subtitle: string;
  accent: string;
  /** Where this mix's tracks come from. */
  pick: (sources: MixSources) => YtItem[];
}

/**
 * The mix catalogue, in display order.
 *
 * Order is by how confident we are the shelf is genuinely personal: "On
 * repeat" is the listener's own play counts, while "Fresh for you" is a live
 * shelf shared by everyone. A brand-new visitor therefore sees the mixes that
 * need no taste at the bottom, and the ones that do at the top never render
 * empty.
 */
const BLUEPRINTS: MixBlueprint[] = [
  {
    id: "favorites",
    name: "Favorites Mix",
    subtitle: "The songs you saved, ready when you want them",
    accent: "from-rose-400/28 to-transparent",
    pick: (s) => s.favorites ?? [],
  },
  {
    id: "on_repeat",
    name: "On Repeat",
    subtitle: "The songs you keep coming back to",
    accent: "from-[rgb(var(--tint)_/_0.28)] to-transparent",
    pick: (s) => s.mostPlayed ?? [],
  },
  {
    id: "recent",
    name: "Recently Played",
    subtitle: "Pick up where you left off",
    accent: "from-cyan-400/25 to-transparent",
    pick: (s) => s.recent ?? [],
  },
  {
    id: "sound_alike",
    name: "Sounds Like You",
    subtitle: "Matched by sound, not by name",
    accent: "from-violet-400/25 to-transparent",
    pick: (s) => s.soundAlike ?? [],
  },
  {
    id: "discovery",
    name: "Discovery Mix",
    subtitle: "Near your taste, outside your history",
    accent: "from-emerald-400/25 to-transparent",
    pick: (s) => s.discovery ?? [],
  },
  {
    id: "new_music",
    name: "New Music",
    subtitle: "Fresh releases worth a listen",
    accent: "from-amber-400/25 to-transparent",
    pick: (s) => s.newMusic ?? [],
  },
  {
    id: "right_now",
    name: "Right Now",
    subtitle: "Picked for this time of day",
    accent: "from-sky-400/25 to-transparent",
    pick: (s) => s.timeOfDay ?? [],
  },
];

/**
 * Build the mixes that have enough real tracks to be worth showing.
 *
 * `date` is injected (defaulting to now) purely so tests can pin the daily
 * rotation; the app never needs to pass it.
 */
export function buildMixes(
  sources: MixSources,
  date: Date = new Date(),
): Mix[] {
  const day = dayIndex(date);
  const mixes: Mix[] = [];
  for (const blueprint of BLUEPRINTS) {
    const items = clean(blueprint.pick(sources));
    if (items.length < MIN_MIX_TRACKS) continue;
    // Shuffle the tail of the larger shelves once a day so a mix the listener
    // plays every morning is not literally the same order forever. The FIRST
    // track is left alone: it is the mix's cover and its opener, and changing
    // it out from under a listener who pressed play yesterday is jarring.
    const rotated =
      items.length > MIN_MIX_TRACKS ? [items[0]!, ...rotate(items.slice(1), day)] : items;
    mixes.push({
      id: blueprint.id,
      name: blueprint.name,
      subtitle: blueprint.subtitle,
      items: rotated,
      accent: blueprint.accent,
    });
  }
  return mixes;
}

/** The artwork for a mix: its opening track's cover, or "" when it has none. */
export function mixCover(mix: Mix): string {
  return mix.items.find((item) => item.thumbnail)?.thumbnail ?? "";
}
