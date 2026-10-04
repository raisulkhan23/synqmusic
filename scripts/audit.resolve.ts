/**
 * Tests for STREAM RESOLUTION ORDER: backend first, Piped mirror second.
 *
 * The bug under test: a download failed and told the user "Sign in to confirm
 * you're not a bot". That message is YouTube's bot-check aimed at Convex's
 * datacenter IP — it is the BACKEND's reason, and it was being shown even
 * though the real failure was that no Piped mirror answered. Two distinct
 * defects produced that one confusing toast:
 *
 *  1. The Convex action was awaited unguarded, so a rejection (or a hang)
 *     propagated out of `resolveStreamUrl` and the Piped fallback below it
 *     never ran at all. A slow or broken backend therefore silently removed
 *     the only working route.
 *  2. When both routes did fail, the message shown was the backend's reason,
 *     which describes something the user cannot act on and is usually not the
 *     actual cause.
 *
 * The real modules are loaded from source with `fetch` injected, so the
 * shipped logic is what runs here rather than a copy of it.
 *
 * Run: bun scripts/audit.resolve.ts
 */

import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Load the real `resolveViaPiped` with a fake `fetch`.
// ---------------------------------------------------------------------------

// Bun's own transpiler strips the types properly. An earlier version of this
// file hand-rolled regexes for that, which broke the moment the module grew a
// nested type — the test then failed to PARSE, which says nothing about the
// product. Compiling the real source is both simpler and honest.
const realPiped = new Bun.Transpiler({ loader: "ts" }).transformSync(
  readFileSync("src/lib/pipedResolve.ts", "utf8"),
);

const PIPED_INSTANCES: string[] = (() => {
  const m = realPiped.match(/PIPED_INSTANCES = \[([\s\S]*?)\]/);
  if (!m) throw new Error("could not read PIPED_INSTANCES from source");
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
})();

type FetchCall = { url: string };

/** The shape `resolveViaPiped` resolves with. */
type PipedResult = {
  url: string | null;
  failures: { instance: string; detail: string }[];
};

/** What the fake `fetch` should do for one request. */
interface ScriptedResponse {
  status?: number;
  json?: unknown;
  throws?: string;
}

/** Build a `resolveViaPiped` bound to a scripted `fetch`. */
function makeResolver(handler: (url: string) => ScriptedResponse) {
  const calls: FetchCall[] = [];
  // The module calls the global `fetch`. Wrapping the transpiled source in a
  // function whose PARAMETER is named `fetch` shadows that global for the
  // whole body, so the real code path runs against a scripted network without
  // the source being modified in any way.
  //
  // A plain `Function`, not an async one: the module body has no top-level
  // `await` (the awaits are all inside `resolveViaPiped`), and an async
  // wrapper would make this factory return a promise of the function rather
  // than the function itself.
  const factory = new Function(
    "fetch",
    `${realPiped.replace(/^export /gm, "")}
     return resolveViaPiped;`,
  ) as (f: typeof fetch) => (videoId: string) => Promise<PipedResult>;

  const fakeFetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push({ url });
    const r = handler(url);
    if (r.throws) throw new Error(r.throws);
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (r.json === undefined) throw new Error("no body scripted");
        return r.json;
      },
    };
  }) as unknown as typeof fetch;

  return { resolve: factory(fakeFetch), calls };
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const AUDIO_ONLY = {
  audioStreams: [
    { url: "https://cdn.test/audio-low.m4a", bitrate: 48_000 },
    { url: "https://cdn.test/audio-high.m4a", bitrate: 128_000 },
  ],
  videoStreams: [],
};

const MUXED_ONLY = {
  audioStreams: [],
  videoStreams: [
    { url: "https://cdn.test/720.mkv", quality: "720p", videoOnly: false },
    { url: "https://cdn.test/360.mp4", quality: "360p", videoOnly: false },
    { url: "https://cdn.test/v-only", quality: "360p", videoOnly: true },
    {
      url: "https://cdn.test/hls.m3u8",
      quality: "LBRY HLS",
      videoOnly: false,
      mimeType: "application/x-mpegurl",
    },
  ],
};

console.log("\nresolveViaPiped — picking a stream");

{
  const { resolve, calls } = makeResolver(() => ({ json: AUDIO_ONLY }));
  const r = await resolve("vid1");
  check("returns the highest-bitrate audio stream", r.url === "https://cdn.test/audio-high.m4a", String(r.url));
  check("queries the first instance", calls[0]?.url.includes(PIPED_INSTANCES[0]));
  check("does not query later instances once one works", calls.length === 1, `made ${calls.length} calls`);
  check("reports no failures on success", r.failures.length === 0);
}

{
  // Piped returns audioStreams: [] for many videos, so the muxed path is the
  // common case, not an edge case.
  const { resolve } = makeResolver(() => ({ json: MUXED_ONLY }));
  const r = await resolve("vid2");
  check("falls back to the lowest-resolution muxed stream", r.url === "https://cdn.test/360.mp4", String(r.url));
}

{
  const { resolve } = makeResolver(() => ({ json: { audioStreams: [], videoStreams: [] } }));
  const r = await resolve("vid3");
  check("an empty result is a failure, not a URL", r.url === null);
  check("an empty result names the instance", r.failures[0]?.detail === "no audio or muxed stream", r.failures[0]?.detail);
}

console.log("\nresolveViaPiped — reporting why it failed");

{
  const { resolve, calls } = makeResolver(() => ({ status: 502 }));
  const r = await resolve("vid4");
  check("tries every instance when all fail", calls.length === PIPED_INSTANCES.length, `made ${calls.length} of ${PIPED_INSTANCES.length}`);
  check("returns no URL", r.url === null);
  check("records one failure per instance", r.failures.length === PIPED_INSTANCES.length, `${r.failures.length}`);
  check("keeps the HTTP status in the detail", r.failures.every((f) => f.detail === "HTTP 502"));
  check("names instances by host, not full URL", r.failures.every((f) => !f.instance.startsWith("http")));
}

{
  const { resolve } = makeResolver(() => ({ throws: "Failed to fetch" }));
  const r = await resolve("vid5");
  check("a network error is a failure, not a throw", r.url === null);
  check("a network error is recorded", r.failures.length === PIPED_INSTANCES.length);
  check("a network error keeps its message", r.failures[0]?.detail === "Failed to fetch", r.failures[0]?.detail);
}

{
  // A CORS-blocked fetch surfaces as an opaque TypeError in the browser, which
  // is the single most likely real-world outcome. It must not abort the loop.
  const { resolve, calls } = makeResolver((url) =>
    url.includes(PIPED_INSTANCES[0])
      ? { throws: "Failed to fetch" }
      : { json: AUDIO_ONLY },
  );
  const r = await resolve("vid6");
  check("a CORS/network error moves on to the next instance", r.url === "https://cdn.test/audio-high.m4a", String(r.url));
  check("a later instance can rescue an earlier failure", calls.length === 2, `made ${calls.length}`);
  check("failures from skipped instances are not reported on success", r.failures.length === 0);
}

{
  const { resolve } = makeResolver(() => ({ json: undefined }));
  const r = await resolve("vid7");
  check("malformed JSON is a failure, not a throw", r.url === null);
  check("malformed JSON is reported as such", r.failures[0]?.detail === "malformed JSON", r.failures[0]?.detail);
}

{
  const r = await makeResolver(() => ({ json: AUDIO_ONLY })).resolve("");
  check("an empty video id resolves to nothing without any network call", r.url === null);
}

// ---------------------------------------------------------------------------
// `describeFailure` — the message the user actually sees.
// ---------------------------------------------------------------------------

// `describeFailure` is pure string-building, so it can be lifted straight out
// of the module and compiled on its own. It is compiled with the same
// transpiler rather than hand-edited, so the test runs the shipped code.
const describeSource = readFileSync("src/lib/trackSource.ts", "utf8");
const describeStart = describeSource.indexOf("function describeFailure(");
if (describeStart < 0) {
  throw new Error("could not read describeFailure from source");
}
// Brace-match to the end of the function rather than matching to the first
// `\n}\n`, which would cut it short at the first nested block. The opening
// brace to match from is the BODY's, which is the first `{` at or after the
// closing `)` of the parameter list — the parameter type `{ reason?: string }`
// contains a brace of its own and would otherwise be matched as the body.
const paramsEnd = describeSource.indexOf(")", describeStart);
let depth = 0;
let describeEnd = -1;
for (let i = describeSource.indexOf("{", paramsEnd); i < describeSource.length; i++) {
  if (describeSource[i] === "{") depth++;
  else if (describeSource[i] === "}") {
    depth--;
    if (depth === 0) {
      describeEnd = i + 1;
      break;
    }
  }
}
if (describeEnd < 0) throw new Error("could not find the end of describeFailure");

const describeJs = new Bun.Transpiler({ loader: "ts" }).transformSync(
  describeSource.slice(describeStart, describeEnd),
);
const describeFailure = new Function(`${describeJs}; return describeFailure;`)() as (
  backend: { reason?: string } | null,
  failures: { instance: string; detail: string }[],
) => string;

console.log("\nThe message the user sees");

{
  const msg = describeFailure(
    { reason: "Sign in to confirm you're not a bot" },
    [
      { instance: "a.test", detail: "HTTP 502" },
      { instance: "b.test", detail: "Failed to fetch" },
    ],
  );
  check(
    "does NOT blame YouTube's bot-check when a mirror failed",
    !msg.includes("not a bot"),
    msg,
  );
  check("names the mirror that failed", msg.includes("a.test"), msg);
  check("says how many mirrors were tried", msg.includes("2 mirrors"), msg);
  check("uses the singular for one mirror", describeFailure(null, [{ instance: "a.test", detail: "x" }]).includes("1 mirror:"));
  check("keeps each failure's detail", msg.includes("HTTP 502") && msg.includes("Failed to fetch"), msg);
}

{
  // With no mirror diagnostics there is nothing better to say than the
  // backend's own reason, so that is still correct to surface.
  const msg = describeFailure(
    { reason: "Sign in to confirm you're not a bot" },
    [],
  );
  check("falls back to the backend reason when it is all we have", msg === "Sign in to confirm you're not a bot", msg);
  check("has a message when there is no reason at all", describeFailure(null, []).length > 0);
}

{
  const many = Array.from({ length: 9 }, (_, i) => ({
    instance: `h${i}.test`,
    detail: "HTTP 502",
  }));
  const msg = describeFailure(null, many);
  check("caps a long list of hosts", !msg.includes("h5.test"), msg);
  check("still reports the true total", msg.includes("9 mirrors") && msg.includes("+6 more"), msg);
  check("stays a single line", !msg.includes("\n"), JSON.stringify(msg));
}

// ---------------------------------------------------------------------------
// `resolveStreamUrl` ITSELF — the order of attempts, and which reason wins.
//
// This part exists because testing `describeFailure` in isolation proved
// nothing. A mutant that deleted the `describeFailure(...)` call from
// `resolveStreamUrl` and went back to reporting the backend's reason passed
// every assertion above, because none of them ran the code that decides what
// the user is told. Only calling the real function catches that.
// ---------------------------------------------------------------------------

/**
 * Load the real `resolveStreamUrl` with its module imports replaced.
 *
 * `trackSource.ts` pulls in the OPFS sink and the Piped resolver, neither of
 * which belong in a resolution test. Only `resolveStreamUrl`,
 * `resolveViaBackend`, `viaAudioProxy`, `StreamUnavailableError` and
 * `describeFailure` are needed, so the file is truncated before
 * `createTrackAdapter` and the imports are swapped for locals.
 */
function loadResolver(pipedImpl: (id: string) => Promise<PipedResult>) {
  const src = readFileSync("src/lib/trackSource.ts", "utf8");
  const cut = src.indexOf("export function createTrackAdapter(");
  if (cut < 0) throw new Error("could not find createTrackAdapter to truncate at");
  const head = src
    .slice(0, cut)
    // Drop the import block; the stubs below replace it.
    .replace(/^import[\s\S]*?from "@\/lib\/[^"]*";\n/gm, "")
    // `import.meta` is illegal in a `Function` body. Only `audioProxyBase`
    // reads it, to build the proxy origin — which these tests assert on by
    // substring (`/audio-proxy`), never by host.
    .replace(
      /const audioProxyBase = `\$\{[\s\S]*?\}\/audio-proxy`;/,
      'const audioProxyBase = "https://stub.test/audio-proxy";',
    );

  const js = new Bun.Transpiler({ loader: "ts" }).transformSync(head);
  const factory = new Function(
    "resolveViaPiped",
    "opfsSupported",
    "OpfsSink",
    `${js.replace(/^export /gm, "")}
     return { resolveStreamUrl, describeFailure };`,
  ) as (
    p: (id: string) => Promise<PipedResult>,
    supported: () => boolean,
    Sink: unknown,
  ) => {
    resolveStreamUrl: (
      resolve: (a: { videoId: string; quality?: "high" | "low" }) => Promise<{
        url: string | null;
        title: string;
        reason?: string;
      }>,
      track: { id: string; title: string },
      quality?: "high" | "low",
    ) => Promise<{ url: string; title: string }>;
  };

  return factory(pipedImpl, () => true, class {});
}

const backendOk = async () => ({
  url: "https://googlevideo.test/signed",
  title: "Backend title",
});
const backendBotBlocked = async () => ({
  url: null,
  title: "Some title",
  reason: "Sign in to confirm you're not a bot",
});
const backendThrows = async () => {
  throw new Error("convex transport exploded");
};
/** Never settles — models a backend hanging rather than failing. */
const backendHangs = () => new Promise<never>(() => {});

console.log("\nresolveStreamUrl — order of attempts");

{
  const { resolveStreamUrl } = loadResolver(async () => {
    throw new Error("Piped must not be consulted when the backend works");
  });
  const r = await resolveStreamUrl(backendOk, { id: "v1", title: "T" });
  check("uses the backend URL when it works", r.url.includes("googlevideo.test"));
  check("wraps the backend URL in the CORS proxy", r.url.includes("/audio-proxy"), r.url);
  check("keeps the backend's title", r.title === "Backend title");
}

{
  let pipedCalled = false;
  const { resolveStreamUrl } = loadResolver(async () => {
    pipedCalled = true;
    return { url: "https://piped.test/stream.m4a", failures: [] };
  });
  const r = await resolveStreamUrl(backendBotBlocked, { id: "v1", title: "T" });
  check("falls back to Piped when the backend is bot-blocked", pipedCalled);
  check("uses the Piped URL", r.url === "https://piped.test/stream.m4a", r.url);
  check("does NOT proxy a Piped URL — it already sends CORS", !r.url.includes("/audio-proxy"), r.url);
  check("uses the track's own title for a Piped result", r.title === "T", r.title);
}

console.log("\nresolveStreamUrl — a broken backend must not skip the fallback");

{
  // This is the defect behind the whole session: an unguarded `await` meant a
  // rejecting backend threw straight out and Piped was never reached.
  let pipedCalled = false;
  const { resolveStreamUrl } = loadResolver(async () => {
    pipedCalled = true;
    return { url: "https://piped.test/recovered.m4a", failures: [] };
  });
  // Caught rather than awaited directly: when the bug is present the rejection
  // escapes `resolveStreamUrl` entirely, and letting that throw would abort the
  // whole suite on the first mutant instead of reporting which check failed.
  const r = await resolveStreamUrl(backendThrows, { id: "v1", title: "T" }).then(
    (v) => v,
    (e) => ({ url: `THREW: ${e instanceof Error ? e.message : String(e)}` }),
  );
  check("a rejecting backend still reaches Piped", pipedCalled);
  check("a rejecting backend does not fail the download", r.url === "https://piped.test/recovered.m4a", r.url);
}

{
  let pipedCalled = false;
  const { resolveStreamUrl } = loadResolver(async () => {
    pipedCalled = true;
    return { url: "https://piped.test/from-hang.m4a", failures: [] };
  });
  const r = await Promise.race([
    resolveStreamUrl(backendHangs, { id: "v1", title: "T" }),
    new Promise((_, rej) => setTimeout(() => rej(new Error("never fell through")), 20_000)),
  ]).catch((e) => e);
  check("a hanging backend is written off rather than awaited forever", !(r instanceof Error) || r.message !== "never fell through", String(r));
  check("a hanging backend still reaches Piped", pipedCalled);
}

console.log("\nresolveStreamUrl — the reason the user is shown");

{
  // The assertion that the isolated `describeFailure` tests could not make.
  const { resolveStreamUrl } = loadResolver(async () => ({
    url: null,
    failures: [
      { instance: "api.piped.private.coffee", detail: "HTTP 502" },
      { instance: "pipedapi.ducks.party", detail: "Failed to fetch" },
    ],
  }));
  const err = await resolveStreamUrl(backendBotBlocked, { id: "v1", title: "T" }).then(
    () => null,
    (e) => e,
  );
  check("a total failure throws", err !== null);
  check(
    "the thrown reason is the MIRROR failure, not YouTube's bot-check",
    !String(err?.message).includes("not a bot"),
    String(err?.message),
  );
  check("the thrown reason names the mirror", String(err?.message).includes("piped.private.coffee"), String(err?.message));
  check("the error is a StreamUnavailableError", err?.name === "StreamUnavailableError", String(err?.name));
}

{
  // No Piped diagnostics at all: the backend reason is then all there is, and
  // dropping it would leave the user with nothing.
  const { resolveStreamUrl } = loadResolver(async () => ({ url: null, failures: [] }));
  const err = await resolveStreamUrl(backendBotBlocked, { id: "v1", title: "T" }).then(
    () => null,
    (e) => e,
  );
  check(
    "with no mirror diagnostics the backend reason is used",
    String(err?.message) === "Sign in to confirm you're not a bot",
    String(err?.message),
  );
}

console.log("\nresolveStreamUrl — quality and id are passed through");

{
  let seen: { videoId: string; quality?: string } | null = null;
  const { resolveStreamUrl } = loadResolver(async () => ({ url: null, failures: [] }));
  await resolveStreamUrl(
    async (a) => {
      seen = a;
      return { url: "https://x.test/a", title: "T" };
    },
    { id: "the-video-id", title: "T" },
    "low",
  ).catch(() => {});
  check("passes the track's id to the backend", seen?.videoId === "the-video-id", JSON.stringify(seen));
  check("passes the requested quality through", seen?.quality === "low", JSON.stringify(seen));
}

// ---------------------------------------------------------------------------

console.log(
  `\n${passed} passed, ${failures.length} failed` +
    (failures.length ? `\n\nFailing:\n${failures.map((f) => `  - ${f}`).join("\n")}` : ""),
);
process.exit(failures.length ? 1 : 0);
