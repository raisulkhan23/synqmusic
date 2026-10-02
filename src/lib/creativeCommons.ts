// ---------------------------------------------------------------------------
// Which visible tracks are Creative Commons — the state behind the row badge.
//
// ---------------------------------------------------------------------------
// WHY THIS IS BATCHED, NOT A REQUEST PER ROW
// ---------------------------------------------------------------------------
// The badge has to agree with the Download action, so it needs the same rights
// answer. Asking per row would be one request per row: a 200-track playlist
// would fire 200 calls to settle a question the backend answers 50 ids at a
// time. Ids are therefore collected for a moment and sent as one batch, and
// every row that asked re-renders from the shared answer.
//
// ---------------------------------------------------------------------------
// WHY THIS IS AN EXTERNAL STORE, NOT COMPONENT STATE
// ---------------------------------------------------------------------------
// Rows mount and unmount constantly — scrolling, paging, changing a filter.
// State held by a row would re-ask about the same song every time it scrolled
// back into view. The answers live in one module-level map for the session, so
// a song is checked at most once and a returning row is answered immediately.
//
// ---------------------------------------------------------------------------
// WHAT A MISSING ANSWER MEANS
// ---------------------------------------------------------------------------
// Nothing is badged until it is verified: the hook reports `false` for
// "unknown" exactly as it does for "not Creative Commons". A badge shown
// optimistically would advertise a download that then refuses, and a listener
// who taps it has been lied to by the badge — worse than a badge that arrives
// a moment late.
// ---------------------------------------------------------------------------

import { useEffect, useSyncExternalStore } from "react";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

/** videoId → verified Creative Commons (and therefore downloadable). */
const known = new Map<string, boolean>();

/** Ids asked about but not sent yet. */
const pending = new Set<string>();

const listeners = new Set<() => void>();

let client: ConvexHttpClient | null = null;
let flushTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * How long ids are collected before being sent.
 *
 * Long enough that the rows of one page collapse into a single request, short
 * enough that a badge appearing does not read as a delay.
 */
const FLUSH_DELAY_MS = 120;

/** The backend refuses more than this per call, so the client chunks. */
const MAX_IDS_PER_CALL = 50;

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * Subscribe to the whole store.
 *
 * One shared listener set rather than one per id, which is safe because
 * `useSyncExternalStore` compares the snapshot it reads and skips the render
 * when a row's own answer has not changed. A batch therefore repaints only the
 * rows it actually said something about.
 */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function schedule(): void {
  if (flushTimer !== undefined) return;
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    void flush();
  }, FLUSH_DELAY_MS);
}

/** Ask about one video, if the answer is not known and not already asked for. */
function request(videoId: string): void {
  if (known.has(videoId) || pending.has(videoId)) return;
  pending.add(videoId);
  schedule();
}

async function flush(): Promise<void> {
  if (pending.size === 0) return;
  const batch = [...pending];
  pending.clear();

  const ids = batch.slice(0, MAX_IDS_PER_CALL);
  const overflow = batch.slice(MAX_IDS_PER_CALL);

  try {
    client ??= new ConvexHttpClient(import.meta.env.VITE_CONVEX_URL as string);
    const result = await client.action(api.youtube.creativeCommonsFlags, {
      videoIds: ids,
    });
    const eligible = new Set(result.ids);
    for (const id of ids) known.set(id, eligible.has(id));
  } catch {
    // Recorded as NOT badged rather than left unknown, so a backend hiccup
    // cannot become a retry on every render. The only cost is a missing badge:
    // Download still performs its own check at the moment it matters, and that
    // check is the one that decides whether bytes are written.
    for (const id of ids) known.set(id, false);
  }
  notify();

  // Anything past the per-call cap goes back for the next round.
  for (const id of overflow) pending.add(id);
  if (pending.size > 0) schedule();
}

/**
 * Whether this track is verified Creative Commons.
 *
 * `enabled` is false for rows that cannot be verified at all — a non-YouTube
 * source, or a row with no video id — so nothing is requested on their behalf.
 * The value stays `false` while an answer is outstanding; see the header.
 */
export function useIsCreativeCommons(
  videoId: string | undefined,
  enabled: boolean,
): boolean {
  const isCreativeCommons = useSyncExternalStore(
    subscribe,
    () => (videoId ? known.get(videoId) === true : false),
    () => false,
  );

  useEffect(() => {
    if (enabled && videoId) request(videoId);
  }, [enabled, videoId]);

  return isCreativeCommons;
}
