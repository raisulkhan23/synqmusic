import { Link } from "react-router";
import { ImportSection } from "@/components/settings/ImportSection";

/**
 * Import as a first-class route.
 *
 * Importing already worked, but only as one section buried inside Settings —
 * reachable by opening Settings and scrolling to it. This page renders that
 * SAME component rather than a second implementation, so the file/paste/URL
 * import logic, the YouTube playlist fetch, the Spotify/Tidal/Apple handoff and
 * the repair pass all stay in exactly one place.
 *
 * Nothing here is new logic; what is new is that importing is one click from
 * the nav instead of several clicks and a scroll into Settings.
 */
export default function ImportHub() {
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
          Import
        </h1>
        <p className="text-sm text-muted-foreground">
          Bring a playlist in from a file, a link, or another service.
        </p>
      </header>

      <ImportSection open />

      <p className="text-xs text-muted-foreground/70">
        Imported playlists keep working offline from your library —{" "}
        <Link
          to="/downloads"
          className="underline underline-offset-2 transition-colors hover:text-foreground"
        >
          see what&rsquo;s available offline
        </Link>
        .
      </p>
    </div>
  );
}