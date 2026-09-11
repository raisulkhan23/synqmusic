"use node";

import { ConvexError, v } from "convex/values";
import { action } from "./_generated/server";

// ---------------------------------------------------------------------------
// Spotify source (Client Credentials flow).
//
// Reads SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET from the environment (set
// them in the project's API Keys panel). Returns rich track metadata — real
// artist names, album, cover art, duration — plus the 30s preview URL when
// Spotify provides one.
// ---------------------------------------------------------------------------

export interface SpotifyTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  /** Seconds. */
  duration: number;
  thumbnail: string;
  /** 30-second preview clip, when Spotify exposes one (often null). */
  previewUrl: string | null;
  spotifyUrl: string;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

/** App token via the Client Credentials flow, cached until shortly before expiry. */
async function clientCredentialsToken(): Promise<string> {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new ConvexError("SPOTIFY_NOT_CONFIGURED");
  }
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.value;
  }

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    throw new ConvexError(`Spotify auth failed (${res.status})`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.value;
}

interface SpotifyApiTrack {
  id?: unknown;
  name?: unknown;
  artists?: { name?: unknown }[];
  album?: { name?: unknown; images?: { url?: unknown }[] };
  duration_ms?: unknown;
  preview_url?: unknown;
  external_urls?: { spotify?: unknown };
}

/**
 * Search Spotify's catalog for tracks. Returns up to 12 results with
 * high-quality metadata for rendering and playback matching.
 */
export const searchTracks = action({
  args: { query: v.string() },
  handler: async (_ctx, { query }): Promise<{ items: SpotifyTrack[] }> => {
    if (!query.trim()) return { items: [] };

    const token = await clientCredentialsToken();
    const res = await fetch(
      `https://api.spotify.com/v1/search?type=track&limit=12&q=${encodeURIComponent(query)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      throw new ConvexError(`Spotify API returned ${res.status}`);
    }

    const data = (await res.json()) as { tracks?: { items?: SpotifyApiTrack[] } };
    const items: SpotifyTrack[] = [];
    for (const t of data.tracks?.items ?? []) {
      if (typeof t.id !== "string" || typeof t.name !== "string") continue;
      const artists = (t.artists ?? [])
        .map((a) => (typeof a.name === "string" ? a.name : ""))
        .filter(Boolean)
        .join(", ");
      const images = (t.album?.images ?? []).filter(
        (i): i is { url: string } => typeof i.url === "string",
      );
      const thumb: string = images[0]?.url ?? "";
      items.push({
        id: t.id,
        title: t.name,
        artist: artists || "Unknown artist",
        album: typeof t.album?.name === "string" ? t.album.name : "",
        duration:
          typeof t.duration_ms === "number" ? Math.round(t.duration_ms / 1000) : 0,
        thumbnail: thumb,
        previewUrl: typeof t.preview_url === "string" ? t.preview_url : null,
        spotifyUrl:
          typeof t.external_urls?.spotify === "string"
            ? t.external_urls.spotify
            : `https://open.spotify.com/track/${t.id}`,
      });
    }
    return { items };
  },
});
