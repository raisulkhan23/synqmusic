/**
 * Tests for the USER-SUPPLIED RESOLVER.
 *
 * WHY THIS IS TESTED CAREFULLY. This module is the only route by which
 * downloads can work at all, and it has two failure modes that are easy to
 * conflate and expensive to get wrong:
 *
 *  1. A resolver that is DOWN, and a resolver that is UP but IP-blocked by
 *     YouTube, look identical if you only check "did it throw". Telling
 *     someone their server is unreachable when YouTube is blocking its IP
 *     sends them to fix the wrong thing — which is precisely the mistake that
 *     made this feature look broken for an entire session.
 *  2. The stored value is a URL that gets fetched, so it must be sanitised
 *     before it is ever stored or used.
 *
 * The real module is loaded from source with `localStorage` and `fetch`
 * injected, so the shipped logic runs here rather than a copy of it.
 *
 * Run: bun scripts/audit.resolver.ts
 */

import { readFileSync } from "node:fs";

const source = readFileSync("src/lib/customResolver.ts", "utf8");
const js = new Bun.Transpiler({ loader: "ts" }).transformSync(
  source.replace(/^import[\s\S]*?from "@\/lib\/[^"]*";\n/gm, "").replace(
    /^export /gm,
    "",
  ),
);

// ---------------------------------------------------------------------------
// A fake localStorage, including a mode that throws like private-mode Safari.
// ---------------------------------------------------------------------------

class MemoryStorage {
  private map = new Map<string, string>();
  throwOnAccess = false;
  getItem(k: string) {
    if (this.throwOnAccess) throw new Error("storage blocked");
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    if (this.throwOnAccess) throw new Error("storage blocked");
    this.map.set(k, v);
  }
  removeItem(k: string) {
    if (this.throwOnAccess) throw new Error("storage blocked");
    this.map.delete(k);
  }
}

interface Module {
  CUSTOM_RESOLVER_KEY: string;
  readCustomResolver(): string;
  writeCustomResolver(raw: string): string;
  clearCustomResolver(): void;
  checkCustomResolver(
    base: string,
    timeoutMs?: number,
  ): Promise<
    | { ok: true; detail: string }
    | { ok: false; reason: string; detail: string }
  >;
}

function load(storage: MemoryStorage, fetchImpl: typeof fetch): Module {
  const factory = new Function("localStorage", "fetch", `${js}
    return { CUSTOM_RESOLVER_KEY, readCustomResolver, writeCustomResolver, clearCustomResolver, checkCustomResolver };`) as (
    s: MemoryStorage,
    f: typeof fetch,
  ) => Module;
  return factory(storage, fetchImpl);
}

const noFetch = (() => {
  throw new Error("fetch must not be called");
}) as unknown as typeof fetch;

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("\nstoring a resolver");

{
  const store = new MemoryStorage();
  const m = load(store, noFetch);

  check("starts empty", m.readCustomResolver() === "");
  check("saves an http address", m.writeCustomResolver("http://localhost:8080") === "http://localhost:8080");
  check("reads it back", m.readCustomResolver() === "http://localhost:8080");
  check("stores under a namespaced key", m.CUSTOM_RESOLVER_KEY.startsWith("ss."), m.CUSTOM_RESOLVER_KEY);

  // Trailing slashes would double up when a path is joined onto the base.
  check("strips trailing slashes", m.writeCustomResolver("http://localhost:8080///") === "http://localhost:8080");
  check("trims surrounding whitespace", m.writeCustomResolver("  http://box:8080  ") === "http://box:8080");
  check("keeps https", m.writeCustomResolver("https://piped.example.com") === "https://piped.example.com");
}

console.log("\nrefusing what must never be fetched");

{
  const m = load(new MemoryStorage(), noFetch);
  for (const bad of [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "localhost:8080",
    "not a url",
    "",
    "   ",
  ]) {
    check(`rejects ${JSON.stringify(bad)}`, m.writeCustomResolver(bad) === "", m.writeCustomResolver(bad));
  }
  check("rejects a rejected value even if one was stored", (() => {
    m.writeCustomResolver("http://localhost:8080");
    m.writeCustomResolver("javascript:alert(1)");
    return m.readCustomResolver() === "";
  })());

  m.writeCustomResolver("http://localhost:8080");
  m.clearCustomResolver();
  check("clearing empties it", m.readCustomResolver() === "");
}

console.log("\nsurviving a browser that refuses storage");

{
  const store = new MemoryStorage();
  store.throwOnAccess = true;
  const m = load(store, noFetch);
  // Must not throw: a locked-down browser should degrade to "no resolver",
  // which is the pre-existing behaviour, not take the settings page down.
  let read: unknown;
  try {
    read = m.readCustomResolver();
  } catch (e) {
    read = `THREW: ${e}`;
  }
  check("reading survives blocked storage", read === "", String(read));
  let wrote: unknown;
  try {
    wrote = m.writeCustomResolver("http://localhost:8080");
  } catch (e) {
    wrote = `THREW: ${e}`;
  }
  check("writing survives blocked storage", wrote === "http://localhost:8080", String(wrote));
}

console.log("\ntesting a resolver — the three outcomes must stay distinct");

function scripted(
  behaviour: (url: string) => { status?: number; json?: unknown; throws?: string },
) {
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const b = behaviour(url);
    if (b.throws) throw new TypeError(b.throws);
    const status = b.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      // A real `Response` can be read as text OR json, and the module uses
      // `text()` on an error status to look for YouTube's bot-check. The stub
      // has to offer both, or the error path cannot be exercised at all.
      text: async () => (b.json === undefined ? "" : JSON.stringify(b.json)),
      json: async () => {
        if (b.json === undefined) throw new Error("no body");
        return b.json;
      },
    };
  }) as unknown as typeof fetch;
  return { f, calls };
}

const GOOD = {
  title: "Test",
  audioStreams: [{ url: "https://cdn.test/a.m4a" }],
  videoStreams: [],
};

{
  const { f } = scripted(() => ({ json: GOOD }));
  const r = await load(new MemoryStorage(), f).checkCustomResolver("http://localhost:8080");
  check("a working resolver reports ok", r.ok === true, JSON.stringify(r));
}

{
  const { f } = scripted(() => ({ throws: "Failed to fetch" }));
  const r = await load(new MemoryStorage(), f).checkCustomResolver("http://localhost:8080");
  check("an unreachable resolver is NOT ok", r.ok === false);
  check(
    "an unreachable resolver is reported as unreachable, not blocked",
    r.ok === false && r.reason === "unreachable",
    JSON.stringify(r),
  );
  check("its message mentions reachability", /reach/i.test(r.detail), r.detail);
}

{
  // The real, measured body from a public Piped mirror. It answers HTTP 500
  // with YouTube's own exception named inside it.
  const { f } = scripted(() => ({
    status: 500,
    json: {
      error:
        "org.schabi.newpipe.extractor.exceptions.SignInConfirmNotBotException: YouTube probably temporarily blocked anonymous watch access with this IP , got error LOGIN_REQUIRED: \"Sign in to confirm that you're not a bot\"",
    },
  }));
  const r = await load(new MemoryStorage(), f).checkCustomResolver("http://localhost:8080");
  check("a bot-blocked resolver is NOT ok", r.ok === false);
  check(
    "a bot-blocked resolver says BLOCKED, not unreachable",
    r.ok === false && r.reason === "blocked",
    JSON.stringify(r),
  );
  check(
    "its message says the IP is blocked, so the user fixes the right thing",
    /block/i.test(r.detail),
    r.detail,
  );
}

{
  const { f } = scripted(() => ({ json: { audioStreams: [], videoStreams: [] } }));
  const r = await load(new MemoryStorage(), f).checkCustomResolver("http://localhost:8080");
  check(
    "a resolver with no stream is distinct again",
    r.ok === false && r.reason === "no-stream",
    JSON.stringify(r),
  );
}

{
  const { f, calls } = scripted(() => ({ json: GOOD }));
  const r = await load(new MemoryStorage(), f).checkCustomResolver("nonsense");
  check("an invalid address is rejected without a request", r.ok === false && r.reason === "invalid", JSON.stringify(r));
  check("an invalid address makes no network call", calls.length === 0, `${calls.length} calls`);
}

{
  const { f, calls } = scripted(() => ({ json: GOOD }));
  await load(new MemoryStorage(), f).checkCustomResolver("http://localhost:8080/");
  check("trailing slash is normalised before the request", calls[0] === "http://localhost:8080/streams/dQw4w9WgXcQ", calls[0]);
}

console.log("\nthe custom resolver is tried BEFORE the public mirrors");

{
  // The ordering assertion, against the real `resolveViaPiped`.
  const pipedSrc = readFileSync("src/lib/pipedResolve.ts", "utf8");
  const customIdx = pipedSrc.indexOf("function customInstance()");
  const listIdx = pipedSrc.indexOf("function instanceList()");
  const loopIdx = pipedSrc.indexOf("for (const base of instanceList())");
  check("a custom instance is read from storage", customIdx > 0);
  check("a custom instance is prepended to the mirror list", customIdx > 0 && listIdx > customIdx);
  check(
    "the custom instance comes first in the list",
    /return custom \? \[custom, \.\.\.PIPED_INSTANCES\]/.test(pipedSrc),
  );
  check("the loop iterates the combined list, not the raw mirrors", loopIdx > 0 && /instanceList\(\)/.test(pipedSrc.slice(loopIdx, loopIdx + 60)));
}

console.log(
  `\n${passed} passed, ${failures.length} failed` +
    (failures.length ? `\n\nFailing:\n${failures.map((f) => `  - ${f}`).join("\n")}` : ""),
);
process.exit(failures.length ? 1 : 0);
