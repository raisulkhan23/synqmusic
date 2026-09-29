import { ConvexError, v } from "convex/values";
import { action } from "./_generated/server";
import {
  dedupeTracks,
  ImportError,
  normalizeTrack,
  type ImportOutcome,
  type NormalizedTrack,
} from "../lib/importModel";
import { SPOTIFY_TOKEN_URL } from "../lib/spotifyAuth";

/**
 * Spotify importer.
 *
 * Spotify is a METADATA source for SYNQ, never an audio one. There is no
 * public endpoint that returns playable audio, and pretending otherwise would
 * be the worst kind of lie in a music app: the imported playlist carries
 * title/artist/album/artwork, and playback resolves those against YouTube the
 * same way every other imported playlist already does.
 *
 * Two endpoints, both official:
 *   GET /v1/playlists/{id}            metadata
 *   GET /v1/playlists/{id}/tracks     paged, 100 at a time
 *
 * Both require a USER access token. A client-credentials token is explicitly
 * rejected for playlist endpoints, so the user authorises SYNQ once via PKCE.
 * PKCE has no client secret, so there is no secret in this file and none in
 * the client either.
 *
 * Every failure is translated into an `ImportError` code so the UI can explain
 * itself instead of surfacing a raw provider string.
 */

const API = "https://api.spotify.com/v1";
const REQUEST_TIMEOUT_MS = 15_000;
/** Spotify's own cap on a playlist's returned items. */
const MAX_TRACKS = 10_000;
/** Guard against a pathological link; a real playlist is far below this. */
const MAX_PAGES = 100;

interface SpotifyImage {
  url?: string;
}

interface SpotifyArtist {
  name?: string;
}

interface SpotifyTrack {
  id?: string | null;
  name?: string | null;
  uri?: string | null;
  external_urls?: { spotify?: string };
  duration_ms?: number;
  // Present on a real track; null on a relinked/removed entry.
  track?: SpotifyTrack | null;
  artists?: SpotifyArtist[];
  album?: { name?: string; images?: SpotifyImage[] };
  is_local?: boolean;
  type?: string;
}

async function spotifyGet(
  path: string,
  accessToken: string,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new ImportError("network");
    }
    throw new ImportError("network");
  }

  // Spotify's own status codes map cleanly onto the codes the UI knows.
  if (response.status === 401) throw new ImportError("auth-expired");
  if (response.status === 429) throw new ImportError("rate-limited");
  if (response.status === 403) throw new ImportError("private");
  if (response.status === 404) throw new ImportError("not-found");
  if (!response.ok) throw new ImportError("unknown");

  return (await response.json()) as Record<string, unknown>;
}

/** Flatten a playlist item, following the nested `track` object. */
function trackFromItem(item: SpotifyTrack): NormalizedTrack | null {
  // A removed or region-blocked entry keeps its position but has `track: null`
  // and only an `is_local` stub. It must be reported as skipped, not imported
  // as a blank row.
  const inner = item.track ?? item;
  const artists = (inner.artists ?? item.artists ?? [])
    .map((a) => a.name ?? "")
    .filter(Boolean)
    .join(", ");
  return normalizeTrack({
    title: inner.name,
    artist: artists,
    album: inner.album?.name,
    artwork: inner.album?.images?.[0]?.url,
    durationMs: inner.duration_ms,
    source: "spotify",
    sourceId: inner.id ?? item.id,
    sourceUrl: inner.external_urls?.spotify,
  });
}

/**
 * Import a Spotify playlist by id.
 *
 * Paginates properly rather than stopping at the first 100, caps at the
 * provider's own limit, and reports how many listed tracks could not be
 * imported instead of dropping them silently.
 */
export const importPlaylist = action({
  args: {
    playlistId: v.string(),
    accessToken: v.optional(v.string()),
  },
  handler: async (
    _ctx,
    { playlistId, accessToken },
  ): Promise<ImportOutcome> => {
    const id = playlistId.trim();
    if (!/^[A-Za-z0-9]{22}$/.test(id)) throw new ImportError("invalid-url");
    if (!accessToken) throw new ImportError("auth-required");

    const warnings: string[] = [];
    const meta = await spotifyGet(`/playlists/${id}`, accessToken);
    const name =
      (meta.name as string | undefined)?.trim() || "Spotify playlist";
    const declaredTotal = Number((meta.tracks as { total?: number })?.total);
    const isPublic = meta.public === true;

    let next: string | undefined;
    let pages = 0;
    let seen = 0;
    const raw: NormalizedTrack[] = [];
    let skipped = 0;

    do {
      const query = next
        ? `?limit=100&offset=${next}`
        : "?limit=100&offset=0";
      const page = await spotifyGet(
        `/playlists/${id}/tracks${query}`,
        accessToken,
      );
      const items = (page.items as SpotifyTrack[] | undefined) ?? [];
      for (const item of items) {
        seen++;
        const track = trackFromItem(item);
        if (track) raw.push(track);
        else skipped++;
      }
      pages++;
      next =
        (page.next as string | undefined)
          ?.split("offset=")
          .pop() ?? undefined;
      if (raw.length + skipped >= MAX_TRACKS) break;
    } while (next && pages < MAX_PAGES);

    if (next && pages >= MAX_PAGES) {
      warnings.push(
        `Stopped after ${MAX_PAGES} pages. Very large playlists are imported in part.`,
      );
    }
    if (Number.isFinite(declaredTotal) && seen < declaredTotal) {
      warnings.push(
        `${declaredTotal - seen} more ${declaredTotal - seen === 1 ? "track is" : "tracks are"} listed but not returned.`,
      );
    }
    if (!isPublic) {
      warnings.push(
        "This playlist is private, so some tracks may be missing.",
      );
    }

    const deduped = dedupeTracks(raw);
    return {
      name,
      origin: "Spotify",
      tracks: deduped.tracks,
      // A repeat and an unavailable track are both "not in your library", and
      // the user should hear the real number.
      skipped: deduped.skipped + skipped,
      partial: Boolean(next) || skipped > 0,
      warnings,
    };
  },
});

/**
 * Exchange an authorisation code for an access token.
 *
 * PKCE, so the request carries the verifier and never a client secret. The
 * token is returned to the caller for this one import and is not persisted.
 */
export const exchangeCode = action({
  args: {
    code: v.string(),
    verifier: v.string(),
    redirectUri: v.string(),
  },
  handler: async (
    _ctx,
    { code, verifier, redirectUri },
  ): Promise<{ accessToken: string; expiresIn: number }> => {
    const clientId = process.env.SPOTIFY_CLIENT_ID;
    if (!clientId) throw new ImportError("not-configured");

    let response: Response;
    try {
      response = await fetch(SPOTIFY_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: clientId,
          code_verifier: verifier,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new ImportError("network");
    }
    if (response.status === 400 || response.status === 401) {
      throw new ImportError("auth-expired");
    }
    if (response.status === 429) throw new ImportError("rate-limited");
    if (!response.ok) throw new ConvexError("Spotify rejected the sign-in");
    const body = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!body.access_token) throw new ImportError("auth-expired");
    return {
      accessToken: body.access_token,
      expiresIn: body.expires_in ?? 3600,
    };
  },
});
