/**
 * The importer registry.
 *
 * One entry per service, describing what it can do, whether it needs the user
 * to connect an account, and which environment variables the deployment needs
 * before it will work. The UI reads this to decide what to show; the Convex
 * actions do the fetching. Adding a service means adding a row here and an
 * action beside it — not another copy of the import flow.
 *
 * Pure, so the whole capability table is unit testable.
 */

import type { PlaylistService } from "@/lib/sources";
import type { ImportErrorCode } from "@/lib/importModel";

export interface ImporterCapabilities {
  service: PlaylistService;
  /** Human label, matching the one the detector already produces. */
  label: string;
  /**
   * Can SYNQ fetch the track list itself once authorised? False means the only
   * route is an exported file, which is still supported.
   */
  direct: boolean;
  /**
   * True when the service will only answer for a user who has authorised SYNQ.
   * Drives whether the UI offers "Connect" before "Import".
   */
  needsAuth: boolean;
  /** Collection kinds this importer accepts. */
  kinds: ("playlist" | "album")[];
  /**
   * Environment variables the deployment needs for this importer to work.
   * Read server-side only; the values never reach the browser.
   */
  envVars: string[];
  /** Shown when the importer is reachable but this deployment has no keys. */
  notConfiguredCode: Extract<ImportErrorCode, "not-configured" | "unsupported">;
  /** One line for the detection badge and the empty state. */
  blurb: string;
}

export const IMPORTERS: Record<PlaylistService, ImporterCapabilities> = {
  youtube: {
    service: "youtube",
    label: "YouTube",
    direct: true,
    needsAuth: false,
    kinds: ["playlist"],
    envVars: [],
    notConfiguredCode: "not-configured",
    blurb: "Imports straight from the link — no account needed.",
  },
  "youtube-music": {
    service: "youtube-music",
    label: "YouTube Music",
    direct: true,
    needsAuth: false,
    kinds: ["playlist"],
    envVars: [],
    notConfiguredCode: "not-configured",
    blurb: "Imports straight from the link — no account needed.",
  },
  spotify: {
    service: "spotify",
    label: "Spotify",
    direct: true,
    needsAuth: true,
    kinds: ["playlist", "album"],
    // PKCE is a public-client flow, so only the client id is needed and it is
    // safe to ship. No client secret is ever required or stored.
    envVars: ["SPOTIFY_CLIENT_ID"],
    notConfiguredCode: "not-configured",
    blurb:
      "Connects to Spotify so SYNQ can read the playlist's tracks. Spotify is a metadata source here — playback still comes from YouTube.",
  },
  "apple-music": {
    service: "apple-music",
    label: "Apple Music",
    direct: true,
    needsAuth: true,
    kinds: ["playlist", "album"],
    // A developer token is a signed JWT, which means a private key that has to
    // stay on the server. None of this is shippable to the browser.
    envVars: [
      "APPLE_MUSIC_TEAM_ID",
      "APPLE_MUSIC_KEY_ID",
      "APPLE_MUSIC_PRIVATE_KEY",
    ],
    notConfiguredCode: "not-configured",
    blurb:
      "Uses Apple's catalog API to read the playlist. Needs Apple developer credentials on the server.",
  },
  soundcloud: {
    service: "soundcloud",
    label: "SoundCloud",
    direct: false,
    needsAuth: true,
    kinds: ["playlist"],
    envVars: ["SOUNDCLOUD_CLIENT_ID", "SOUNDCLOUD_CLIENT_SECRET"],
    notConfiguredCode: "not-configured",
    blurb: "SoundCloud sets can only be read with a registered app.",
  },
  deezer: {
    service: "deezer",
    label: "Deezer",
    direct: false,
    needsAuth: false,
    kinds: ["playlist"],
    envVars: [],
    notConfiguredCode: "not-configured",
    blurb: "Deezer's playlist API needs app credentials we don't ship.",
  },
  tidal: {
    service: "tidal",
    label: "Tidal",
    direct: false,
    needsAuth: true,
    kinds: ["playlist"],
    envVars: ["TIDAL_CLIENT_ID", "TIDAL_CLIENT_SECRET"],
    notConfiguredCode: "not-configured",
    blurb: "Tidal's API is not open to third-party clients.",
  },
  bandcamp: {
    service: "bandcamp",
    label: "Bandcamp",
    direct: false,
    needsAuth: false,
    kinds: ["playlist"],
    envVars: [],
    notConfiguredCode: "not-configured",
    blurb: "Bandcamp collections are export-only.",
  },
  unknown: {
    service: "unknown",
    label: "That service",
    direct: false,
    needsAuth: false,
    kinds: [],
    envVars: [],
    notConfiguredCode: "unsupported",
    blurb: "SYNQ doesn't recognise that link.",
  },
};

export const importerFor = (service: PlaylistService): ImporterCapabilities =>
  IMPORTERS[service] ?? IMPORTERS.unknown;

/** Services that import from a link with no account linking at all. */
export const DIRECT_IMPORT_SERVICES: PlaylistService[] = Object.values(
  IMPORTERS,
)
  .filter((entry) => entry.direct && !entry.needsAuth)
  .map((entry) => entry.service);

/** Every environment variable the importer set needs, for the setup notes. */
export function requiredEnvVars(): string[] {
  return [...new Set(Object.values(IMPORTERS).flatMap((e) => e.envVars))];
}
