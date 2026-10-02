import { describe, expect, test, beforeEach } from "bun:test";
import { Window } from "happy-dom";
import { readFileSync } from "node:fs";

/**
 * Offline playback and offline audio storage.
 *
 * Two kinds of test, for two different reasons:
 *
 *  - The `offline audio storage` block EXECUTES the real storage layer against
 *    an in-memory Cache Storage and IndexedDB. The failure it guards against is
 *    silent: bytes are written, the list shows the track, and it still never
 *    plays offline.
 *
 *  - The player-block tests assert on SOURCE. Executing `loadTrack` from a test
 *    file is not possible here — see the note on the module-scope globals below
 *    for the full reason. This matches how the rest of the suite tests the
 *    store.
 */

// MODULE SCOPE: the store reads localStorage and wires an Audio element while
// it is being evaluated, so every DOM global it touches must exist first.
//
// REUSE the DOM another suite already installed rather than building a second
// happy-dom Window. `audio.ts` caches its two <audio> decks in MODULE scope
// (`let decks`), and `getAudio()` re-appends a disconnected element to
// `document.body`. Bun shares one module instance across every test file, so
// if this file replaced `document` with a Window of its own, the cached deck
// element would belong to a different happy-dom instance and the append would
// throw inside happy-dom with a bare `PropertySymbol.nodeArray` -- surfacing
// as "the offline branch never ran", for reasons unrelated to offline
// playback. Installing a fresh Window here was tried and made it worse.
//
// Only the globals this suite genuinely needs and no earlier file provides are
// filled in, and a missing DOM is built only when there is none at all.
if (!globalThis.document) {
  const win = new Window({ url: "https://example.test/" });
  globalThis.window = win;
  globalThis.document = win.document;
  globalThis.localStorage = win.localStorage;
  globalThis.navigator = win.navigator;
  globalThis.HTMLElement = win.HTMLElement;
  globalThis.HTMLMediaElement = win.HTMLMediaElement;
  globalThis.Element = win.Element;
  globalThis.Node = win.Node;
  globalThis.Event = win.Event;
  globalThis.Audio = win.Audio;
  globalThis.Blob = win.Blob;
  globalThis.Response = win.Response;
  globalThis.Headers = win.Headers;
}
globalThis.AbortSignal = globalThis.AbortSignal ?? AbortSignal;

// A REAL object-URL implementation.
//
// Another suite stubs `URL.createObjectURL` to return the constant
// "blob:stub", and Bun's own global `URL` is not happy-dom's. Either would make
// the offline assertions pass or fail for reasons unrelated to offline
// playback, so this installs an implementation that hands back a distinct
// `blob:` URL per Blob and revokes it correctly.
const objectUrls = new Map();
let objectUrlSeq = 0;
globalThis.URL.createObjectURL = (obj) => {
  const url = `blob:synq-offline/${++objectUrlSeq}`;
  objectUrls.set(url, obj);
  return url;
};
globalThis.URL.revokeObjectURL = (url) => {
  objectUrls.delete(String(url));
};

/** In-memory Cache Storage stand-in.
 *
 *  `put` SERIALISES the body, which is what real Cache Storage does: it writes
 *  the bytes to disk, and `match` hands back a fresh Response. Storing the
 *  Response object itself is not just unfaithful, it is actively misleading —
 *  a Response body is single-use, so the second read fails with "Body has
 *  already been used" in a way no real browser would ever produce, and the
 *  offline branch looks broken when it is fine.
 */
function makeCache() {
  const store = new Map();
  return {
    async put(req, res) {
      const bytes = await res.arrayBuffer();
      store.set(String(req), {
        status: res.status,
        type: res.headers.get("Content-Type") ?? "application/octet-stream",
        bytes,
      });
    },
    async match(req) {
      const hit = store.get(String(req));
      if (!hit) return undefined;
      return new Response(hit.bytes, {
        status: hit.status,
        headers: { "Content-Type": hit.type },
      });
    },
    async delete(req) {
      store.delete(String(req));
    },
    async keys() {
      return [...store.keys()].map((k) => new Request(k));
    },
  };
}

const cache = makeCache();
globalThis.caches = {
  async open() {
    return cache;
  },
  async delete() {
    return true;
  },
};

/**
 * Minimal in-memory IndexedDB.
 *
 * Only the four operations `offlineAudio.ts` actually performs are modelled:
 * open with an upgrade hook, a `readwrite`/`readonly` transaction, object
 * store put/delete/getAll/clear, and the completion events. Modelling the ABSENT
 * browser API instead would have been the easier mistake — every call would
 * pass and the storage path would never have run at all.
 */
globalThis.indexedDB = (() => {
  const DB_VERSION = 1;
  const data = new Map();
  return {
    open(_name, _version) {
      const request = { result: null };
      const db = {
        objectStoreNames: { contains: () => true },
        createObjectStore() {},
        close() {},
        transaction() {
          const tx = {
            oncomplete: null,
            onerror: null,
            onabort: null,
          };
          const settle = () => tx.oncomplete && tx.oncomplete();
          tx.objectStore = () => ({
            put: (row) => {
              data.set(row.key, row);
              queueMicrotask(settle);
            },
            delete: (key) => {
              data.delete(key);
              queueMicrotask(settle);
            },
            clear: () => {
              data.clear();
              queueMicrotask(settle);
            },
            getAll: () => ({
              get onsuccess() {
                return null;
              },
              set onsuccess(_fn) {
                queueMicrotask(() => {
                  _fn();
                  settle();
                });
              },
              result: [...data.values()],
            }),
          });
          return tx;
        },
      };
      request.result = db;
      queueMicrotask(() => {
        if (request.onupgradeneeded) request.onupgradeneeded();
        if (request.onsuccess) request.onsuccess();
      });
      return request;
    },
  };
})();

/** happy-dom does not implement the Storage API; the store asks for it. */
globalThis.navigator.storage = undefined;

const { offlineAudioUrl, saveDownload, removeDownload } =
  await import("../src/lib/offlineAudio.ts");
// Plain, un-busted imports.
//
// An earlier version appended a `?offline-<timestamp>` query here to force a
// fresh evaluation, on the theory that other suites cached this module against
// their own DOM. That is worse than the problem it solved: Bun treats the
// stamped specifier as a DISTINCT module, so `player.ts` was evaluated a second
// time and `wireAudio()` appended an <audio> element to a happy-dom document
// belonging to a different Window instance. The duplicate store then blew up
// with `PropertySymbol.nodeArray` on every subsequent run.
//
// The suite's existing convention is one module instance shared across files,
// with each file setting globals before importing. Following it is both simpler
// and correct: these tests set every global the store touches at module scope,
// before the import, so the shared instance is bound to this file's DOM.
const { usePlayerStore } = await import("../src/store/player.ts");
const { useAuthGate } = await import("../src/store/authGate.ts");

// The deferred-auth gate refuses playback for a signed-out visitor, which is
// correct product behaviour and would stop every assertion below before the
// offline branch was ever reached. Authenticate, as a listener would be.
// The gate's state key is `authenticated`, not `isAuthenticated` — setting the
// wrong one leaves the gate closed and every assertion below fails on a null
// `current`, which looks like a broken offline branch.
useAuthGate.setState({ isLoading: false, authenticated: true });

/** `loadTrack` is module-private; `playTrack` is the public entry point that
 *  reaches it, which is also what a real click does. */
async function playTrack(track) {
  usePlayerStore.getState().playTrack(track);
  await new Promise((r) => setTimeout(r, 30));
}

describe("test-environment sanity", () => {
  test("object URLs are real, not another suite's stub", () => {
    // Without this guard a stubbed createObjectURL makes the whole file
    // meaningless: every "played from disk" assertion would pass against a
    // constant string.
    const url = URL.createObjectURL(new Blob([new Uint8Array([1])]));
    expect(url).toMatch(/^blob:/);
    expect(url).not.toBe("blob:stub");
    URL.revokeObjectURL(url);
  });

  test("Cache Storage is this file's, not a leaked global", async () => {
    await cache.put("/__sentinel__", new Response(new Uint8Array([7])));
    const hit = await cache.match("/__sentinel__");
    expect(hit).not.toBeUndefined();
    // A real cache re-materialises the body rather than replaying a spent
    // Response object, which is what makes a second read legal.
    expect((await hit.blob()).size).toBe(1);
  });
});

const TRACK_ID = "offline-test-track";

function playable() {
  return {
    id: TRACK_ID,
    title: "Downloaded Song",
    artistName: "Artist",
    albumName: "",
    coverUrl: "",
    // "stream" is the placeholder that would normally send this to the network
    // resolver. Offline, that resolver cannot work — which is exactly why the
    // local file has to be checked BEFORE it.
    audioUrl: "stream",
    duration: 120,
    source: "youtube",
    youtubeId: TRACK_ID,
  };
}

describe("offline audio storage", () => {
  beforeEach(async () => {
    await removeDownload(TRACK_ID);
  });

  test("a track that was never downloaded has no local audio", async () => {
    expect(await offlineAudioUrl(TRACK_ID)).toBeNull();
  });

  test("a downloaded track yields a playable blob URL", async () => {
    await saveDownload(
      {
        key: `/__offline__/track/${TRACK_ID}`,
        trackId: TRACK_ID,
        title: "Downloaded Song",
        artistName: "Artist",
        coverUrl: "",
        duration: 120,
        bytes: 4,
        savedAt: Date.now(),
        source: "jamendo",
        licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      },
      new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" },
      }),
    );
    const url = await offlineAudioUrl(TRACK_ID);
    expect(url).not.toBeNull();
    expect(url.startsWith("blob:")).toBe(true);
    URL.revokeObjectURL(url);
  });

  test("removing a download removes the audio, not just the row", async () => {
    await saveDownload(
      {
        key: `/__offline__/track/${TRACK_ID}`,
        trackId: TRACK_ID,
        title: "t",
        artistName: "a",
        coverUrl: "",
        duration: 1,
        bytes: 1,
        savedAt: 1,
        source: "jamendo",
        licenseUrl: "cc",
      },
      new Response(new Uint8Array([9]), { status: 200 }),
    );
    expect(await offlineAudioUrl(TRACK_ID)).not.toBeNull();
    await removeDownload(TRACK_ID);
    // Deleting only the index row would leave a "downloaded" track that cannot
    // play offline, with nothing for the listener to tell what happened.
    expect(await offlineAudioUrl(TRACK_ID)).toBeNull();
  });
});

describe("the player prefers a downloaded file over the network", () => {
  // SOURCE-SHAPE, deliberately.
  //
  // Executing `loadTrack` from this file was tried and abandoned. Bun shares one
  // module instance across every test file, and `audio.ts` caches its two
  // <audio> decks in MODULE scope (`let decks`). Whichever suite touches it
  // first binds the decks to ITS happy-dom Window; every later file then
  // throws `PropertySymbol.nodeArray` when `getAudio()` re-appends a
  // disconnected element to a `document.body` from a different Window. That is
  // a property of the shared test harness, not of offline playback, and
  // fighting it (cache-busting the specifier) made every later suite fail too.
  //
  // The rest of this suite's player tests assert on source for the same reason.
  // The executable proof that a downloaded track is reachable lives in the
  // `offline audio storage` block above, which needs no media element at all.
  const player = readFileSync("src/store/player.ts", "utf8");

  test("the local file is checked before the no-source guard", () => {
    // Order is the whole point. The check must sit ABOVE the "no audio source"
    // bail-out and above every engine branch, or a downloaded track -- whose
    // `audioUrl` is the "stream" placeholder -- gets handed to a resolver that
    // needs the very network that is missing.
    // Anchored to `loadTrack` itself. A bare `indexOf` over the whole file picks
    // up `prefetchTrack`'s `if (track.youtubeId)` hundreds of lines earlier, and
    // a test that silently measures the wrong function is worse than no test.
    const loadTrackAt = player.indexOf("const loadTrack = async (");
    expect(loadTrackAt).toBeGreaterThan(-1);
    const body = player.slice(loadTrackAt);

    const local = body.indexOf("offlineAudioUrl(track.id)");
    const noSource = body.indexOf("this track has no audio source");
    const engineBranch = body.indexOf("if (track.youtubeId) {");
    expect(local).toBeGreaterThan(-1);
    expect(noSource).toBeGreaterThan(-1);
    expect(engineBranch).toBeGreaterThan(-1);
    expect(local).toBeLessThan(noSource);
    expect(local).toBeLessThan(engineBranch);
  });

  test("the local branch plays the blob and never calls the resolver", () => {
    const start = player.indexOf(
      "const localUrl = await offlineAudioUrl(track.id)",
    );
    expect(start).toBeGreaterThan(-1);
    const branch = player.slice(start, start + 2600);
    expect(branch).toMatch(/localAudio\.src = localUrl/);
    // No network resolution anywhere in the offline path.
    expect(branch).not.toMatch(/ytResolve\(/);
    expect(branch).not.toMatch(/resolveYoutubeStream\(/);
  });

  test("the track stored as current carries the blob URL", () => {
    // Every time update, state change and EQ hand-off in the store is gated on
    // `audioElementIsSource`. If `current` kept the "stream" placeholder while
    // a blob was actually sounding, the store would ignore the song that is
    // playing -- position frozen, controls inert, which looks like a hang.
    const start = player.indexOf(
      "const localUrl = await offlineAudioUrl(track.id)",
    );
    const branch = player.slice(start, start + 2600);
    expect(branch).toMatch(/audioUrl: localUrl/);
  });

  test("a blob URL counts as the audio element being the active source", () => {
    expect(player).toMatch(/t\.audioUrl\.startsWith\("blob:"\)/);
  });

  test("an EQ change on a downloaded track does not re-resolve from the network", () => {
    // The worst outcome for an offline listener: turn a bass slider and the
    // song stops and re-resolves from a source that is not there.
    const fn = player.slice(
      player.indexOf("const swapToFilteredStream"),
      player.indexOf("const swapToFilteredStream") + 900,
    );
    expect(fn).toMatch(
      /offlineObjectUrl && track\.audioUrl\.startsWith\("blob:"\)/,
    );
  });

  test("a failed local play removes the bad copy instead of retrying forever", () => {
    const start = player.indexOf(
      "const localUrl = await offlineAudioUrl(track.id)",
    );
    const branch = player.slice(start, start + 2600);
    expect(branch).toMatch(/forgetDownload\(track\.id\)/);
    // The two benign rejections must stay ignored, or a download would be
    // deleted every time autoplay policy or a newer load interrupted it.
    expect(branch).toMatch(/NotAllowedError/);
    expect(branch).toMatch(/AbortError/);
  });
});
