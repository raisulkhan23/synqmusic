/**
 * Tests for the TAB-CAPTURE download path.
 *
 * WHY THIS IS TESTED CAREFULLY. This is the only download route that works
 * with no resolver at all, because it never asks for a stream URL — it records
 * the audio the tab is already playing. That makes it the feature that has to
 * be right, and it has several failure modes that are easy to conflate:
 *
 *  1. The user picked a tab but did not tick "Share tab audio". That returns a
 *     perfectly valid stream with zero audio tracks. Written as-is it would
 *     produce a zero-byte file and report success — the worst possible outcome,
 *     because the user believes they saved something.
 *  2. A dismissed permission picker is not an error to shout about, but it is
 *     not a successful recording either.
 *  3. A recorder that produced nothing must not be reported as a save.
 *  4. The extension has to match the container. Opus-in-WebM named `.mp3` is a
 *     file that refuses to play in much of the world.
 *
 * The real module is loaded from source with `navigator`, `MediaRecorder`,
 * `MediaStream` and `window` injected, so the shipped logic runs here rather
 * than a copy of it.
 *
 * Run: bun scripts/audit.capture.ts
 */

import { readFileSync } from "node:fs";

const source = readFileSync("src/lib/captureDownload.ts", "utf8");
// `export` is stripped because the module is evaluated inside a function body,
// where an export declaration is a syntax error.
const js = new Bun.Transpiler({ loader: "ts" }).transformSync(
  source.replace(/^export /gm, ""),
);

interface Module {
  CaptureError: new (reason: string, message: string) => Error & {
    reason: string;
  };
  captureSupported(): boolean;
  pickCaptureMimeType(): string | null;
  startAudioCapture(): Promise<{
    stop(): Promise<Uint8Array>;
    readonly bytes: number;
    dispose(): void;
  }>;
  captureFilename(
    title: string,
    artist: string,
    mimeType: string | null,
  ): string;
}

function load(env: {
  getDisplayMedia?: () => Promise<unknown>;
  /** Model a share with no audio tracks — the unticked "Share tab audio" box. */
  noAudio?: boolean;
  isSecureContext?: boolean;
  supported?: readonly string[];
  recorderThrows?: boolean;
  startThrows?: boolean;
  eventError?: boolean;
}): Module {
  // A track that records its own lifecycle, so tests can assert that stopping
  // actually released the tab share rather than leaving the indicator on.
  const stops: string[] = [];
  const mkTrack = (kind: string) => ({
    kind,
    stop() {
      stops.push(kind);
    },
  });

  class FakeStream {
    constructor(private tracks: unknown[]) {}
    getTracks() {
      return this.tracks;
    }
    getAudioTracks() {
      return (this.tracks as { kind: string }[]).filter((t) => t.kind === "audio");
    }
    getVideoTracks() {
      return (this.tracks as { kind: string }[]).filter((t) => t.kind === "video");
    }
  }

  class FakeRecorder {
    static supportedTypes: readonly string[] = env.supported ?? [
      "audio/webm;codecs=opus",
    ];
    /** The recorder the module actually constructed, for driving tests. */
    static last: FakeRecorder | null = null;
    state: "inactive" | "recording" = "inactive";
    mimeType: string;
    private listeners = new Map<string, ((e: unknown) => void)[]>();
    /** Recorded but not yet flushed, mirroring a real timeslice recorder. */
    private pending = 0;
    constructor(
      public stream: FakeStream,
      options?: { mimeType?: string },
    ) {
      if (env.recorderThrows) throw new Error("recorder refused");
      this.mimeType = options?.mimeType ?? "audio/webm";
      FakeRecorder.last = this;
    }
    static isTypeSupported(t: string) {
      return FakeRecorder.supportedTypes.includes(t);
    }
    addEventListener(type: string, fn: (e: unknown) => void) {
      const list = this.listeners.get(type) ?? [];
      list.push(fn);
      this.listeners.set(type, list);
    }
    private emit(type: string, e?: unknown) {
      for (const fn of this.listeners.get(type) ?? []) fn(e);
    }
    /** One `dataavailable`, carrying the blob the module reads `data.size` from. */
    private flush(size: number) {
      if (size <= 0) return;
      // A REAL Blob, because the module concatenates chunks and reads
      // `.arrayBuffer()`. A stand-in object would be stringified by the Blob
      // constructor and produce 15 bytes of "[object Object]" per chunk, which
      // would look like a module bug and be nothing of the kind.
      this.emit("dataavailable", { data: new Blob([new Uint8Array(size)]) });
    }
    start() {
      if (env.startThrows) throw new Error("cannot start");
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      // A real recorder flushes whatever is buffered as a final chunk, which is
      // the only reason a short recording is not silently truncated.
      this.flush(this.pending);
      this.pending = 0;
      if (env.eventError) this.emit("error");
      this.emit("stop");
    }
    /** Test-only: record `size` bytes and flush them as one chunk. */
    deliver(size: number) {
      this.pending += size;
      const out = this.pending;
      this.pending = 0;
      this.flush(out);
    }
    /** Test-only: record bytes WITHOUT flushing, so `stop()` must. */
    buffer(size: number) {
      this.pending += size;
    }
  }

  const getDisplayMedia =
    env.getDisplayMedia ??
    (async () =>
      // The default share is a video+audio stream, built from `mkTrack` so the
      // release of the share is observable. `noAudio` models the real trap: the
      // user shares the tab but never ticks "Share tab audio".
      new FakeStream(
        env.noAudio ? [mkTrack("video")] : [mkTrack("video"), mkTrack("audio")],
      ));

  const factory = new Function(
    "navigator",
    "MediaRecorder",
    "MediaStream",
    "window",
    `${js}
    return { CaptureError, captureSupported, pickCaptureMimeType, startAudioCapture, captureFilename };`,
  ) as (
    n: unknown,
    r: unknown,
    s: unknown,
    w: unknown,
  ) => Module;

  const nav = {
    mediaDevices: env.getDisplayMedia === null ? undefined : { getDisplayMedia },
  };
  const win = { isSecureContext: env.isSecureContext ?? true };

  const mod = factory(nav, FakeRecorder, FakeStream, win);
  // `deliver` pushes a chunk through the LIVE recorder the module built, which
  // is the only way to exercise the chunk-accumulation and byte-count paths.
  return Object.assign(mod, {
    __stops: stops,
    deliver(n: number) {
      FakeRecorder.last?.deliver(n);
    },
    buffer(n: number) {
      FakeRecorder.last?.buffer(n);
    },
  });
}

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail !== undefined ? ` — ${detail}` : ""}`);
  }
}

console.log("\ndetecting whether capture is possible at all");

{
  const m = load({}) as Module & { __stops: string[]; deliver(n: number): void };
  check("a capable browser is supported", m.captureSupported() === true);
}

{
  // Secure context is required by getDisplayMedia. Offering the button on an
  // insecure origin means offering something that cannot work.
  const m = load({ isSecureContext: false });
  check("an insecure context is NOT supported", m.captureSupported() === false);
}

{
  const m = new Function(
    "navigator",
    "MediaRecorder",
    "MediaStream",
    "window",
    `${js}
    return { CaptureError, captureSupported, pickCaptureMimeType, startAudioCapture, captureFilename };`,
  )({ mediaDevices: {} }, undefined, class {}, { isSecureContext: true }) as Module;
  check("a browser with no getDisplayMedia is NOT supported", m.captureSupported() === false);
}

console.log("\nchoosing a container the browser will actually accept");

{
  const m = load({ supported: ["audio/webm;codecs=opus"] });
  check("prefers Opus in WebM", m.pickCaptureMimeType() === "audio/webm;codecs=opus");
}
{
  const m = load({ supported: ["audio/mp4"] });
  check("falls back to a supported container", m.pickCaptureMimeType() === "audio/mp4");
}
{
  const m = load({ supported: [] });
  check("returns null when nothing is supported, letting the browser choose", m.pickCaptureMimeType() === null);
}

console.log("\nrecording the tab and saving real bytes");

{
  const m = load({}) as Module & {
    __stops: string[];
    };
  const capture = await m.startAudioCapture();
  check("starting yields a handle", typeof capture.stop === "function");
  check("reports zero bytes before anything arrives", capture.bytes === 0);

  // THE happy path, which is the whole point of the feature: audio arrives,
  // the byte count climbs, and stopping returns those exact bytes.
  m.deliver(4_096);
  check("the live byte count climbs while recording", capture.bytes === 4_096, capture.bytes);
  m.deliver(2_048);
  check("and accumulates across chunks", capture.bytes === 6_144, capture.bytes);

  const bytes = await capture.stop();
  check(
    "stopping returns real bytes, not an empty buffer",
    bytes instanceof Uint8Array && bytes.length === 6_144,
    `${(bytes as Uint8Array).length} bytes`,
  );
  check(
    "releasing the capture stops the tab share",
    m.__stops.includes("video") && m.__stops.includes("audio"),
    JSON.stringify(m.__stops),
  );
}

{
  // A second `stop()` must not hang or double-write. The handle memoises its
  // promise, and a double-tap on a Stop button is entirely likely.
  const m = load({}) as Module & { };
  const capture = await m.startAudioCapture();
  m.deliver(1_024);
  const [a, b] = await Promise.all([capture.stop(), capture.stop()]);
  check(
    "stopping twice resolves both calls",
    a.length === 1_024 && b.length === 1_024,
    `${a.length}/${b.length}`,
  );
}

{
  const m = load({}) as Module & { __stops: string[]; };
  const capture = await m.startAudioCapture();
  m.deliver(512);
  capture.dispose();
  check(
    "disposing releases the share without saving",
    m.__stops.includes("video"),
    JSON.stringify(m.__stops),
  );
}

{
  // The empty case: a recorder that ran but produced nothing must NOT be
  // reported as a save, or the user believes they have a track they do not.
  const m = load({}) as Module & { };
  const capture = await m.startAudioCapture();
  const bytes = await capture.stop().catch((e: Error) => e);
  check(
    "an empty recording is refused rather than saved as a 0-byte file",
    bytes instanceof Error && /Nothing was captured/i.test(bytes.message),
    bytes instanceof Error ? bytes.message : `${(bytes as Uint8Array).length} bytes`,
  );
  check(
    "and it is classified distinctly",
    bytes instanceof Error && (bytes as { reason?: string }).reason === "empty",
    bytes instanceof Error ? (bytes as { reason?: string }).reason : "",
  );
}

console.log("\nthe \"Share tab audio\" trap");

{
  // THE case that matters most: the user shares the tab, the stream is valid,
  // and it has NO audio tracks because the checkbox was left unticked. Silently
  // producing an empty file here is how a user ends up believing they saved a
  // track they did not save.
  const m = load({ noAudio: true }) as Module & {
    __stops: string[];
    deliver(n: number): void;
  };

  const err = await m.startAudioCapture().catch((e: Error) => e);
  check("a stream with no audio is refused", err instanceof Error, err);
  check(
    "and says to tick \"Share tab audio\", naming the actual fix",
    err instanceof Error && /Share tab audio/i.test(err.message),
    err instanceof Error ? err.message : "",
  );
  check(
    "and names its reason distinctly, not as a generic failure",
    err instanceof Error && (err as { reason?: string }).reason === "no-audio",
    err instanceof Error ? (err as { reason?: string }).reason : "",
  );
  check(
    "the share is released, so the tab indicator does not stay on",
    m.__stops.includes("video"),
    JSON.stringify(m.__stops),
  );
}

console.log("\npermission refused is not a crash");

{
  const m = load({
    getDisplayMedia: async () => {
      const err = new Error("Permission denied");
      err.name = "NotAllowedError";
      throw err;
    },
  });
  const err = await m.startAudioCapture().catch((e: Error) => e);
  check("a dismissed picker is reported, not thrown raw", err instanceof Error);
  check(
    "and is classified as denied",
    err instanceof Error && (err as { reason?: string }).reason === "denied",
    err instanceof Error ? (err as { reason?: string }).reason : "",
  );
}

console.log("\nfilenames must match the container they hold");

{
  const m = load({});
  check(
    "Opus in WebM is named .webm",
    m.captureFilename("Despacito", "Luis Fonsi", "audio/webm;codecs=opus") ===
      "Luis Fonsi - Despacito.webm",
    m.captureFilename("Despacito", "Luis Fonsi", "audio/webm;codecs=opus"),
  );
  check(
    "an MP4 recording is named .m4a, never .mp3",
    m.captureFilename("x", "y", "audio/mp4") === "y - x.m4a",
    m.captureFilename("x", "y", "audio/mp4"),
  );
  check(
    "path separators in a title cannot escape into a path",
    !m.captureFilename("a/b", "c\\d", "audio/webm").includes("/"),
    m.captureFilename("a/b", "c\\d", "audio/webm"),
  );
  check(
    "a blank title still yields a usable name",
    m.captureFilename("", "", null) === "recording.webm",
    m.captureFilename("", "", null),
  );
}

console.log(
  `\n${passed} passed, ${failures.length} failed` +
    (failures.length
      ? `\n\nFailing:\n${failures.map((f) => `  - ${f}`).join("\n")}`
      : ""),
);
process.exit(failures.length ? 1 : 0);