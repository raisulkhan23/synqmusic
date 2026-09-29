import { useRef, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { parsePlaylistImport } from "@/lib/importPlaylist";
import { canDirectImport, nameFromUrl, planImport } from "@/lib/sources";
import { Link2, Loader2, Music4, Upload } from "lucide-react";
import { toast } from "sonner";

/**
 * Settings section for importing playlists (liked songs, collections) from
 * other music services.
 *
 * Two routes in, because the services differ in what they will let a music
 * client do:
 *
 * 1. A share link. YouTube and YouTube Music publish their playlist contents
 *    through the public InnerTube endpoint the player already uses, so those
 *    import in one click with no account linking, no token and no key. The
 *    link is read on the Convex side and the caller then saves it through the
 *    `saveImported` mutation, which owns the signed-in check.
 * 2. A file. Every other service (Spotify, Apple Music, SoundCloud, …) only
 *    offers a closed API, so those links are recognised and answered with
 *    instructions for that specific service rather than a generic "export a
 *    CSV". The parser stays provider-agnostic: it never needs a provider
 *    account, just the exported file the user already has.
 *
 * Imported playlists appear in the Library and are resolved to playable
 * tracks at play time.
 */
export function ImportSection({
  open,
  className = "",
}: {
  open: boolean;
  className?: string;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState("");
  const [lastImported, setLastImported] = useState<string | null>(null);
  const saveImported = useMutation(api.playlists.saveImported);
  const fetchYouTubePlaylist = useAction(api.youtube.importPlaylistById);

  const handleFile = async (file: File) => {
    if (busy) return;
    setBusy(true);
    try {
      const text = await file.text();
      // Default name: file name without extension
      const fallbackName = file.name.replace(/\.(csv|txt|tsv)$/i, "");
      const parsed = parsePlaylistImport(text, fallbackName);
      if (!parsed) {
        toast.error(
          "Couldn't find any songs in that file. Export your playlist as CSV or a plain text list and try again.",
        );
        return;
      }
      await saveImported({
        name: parsed.name,
        origin: parsed.origin,
        tracks: parsed.tracks,
      });
      setLastImported(`${parsed.name} · ${parsed.tracks.length} songs`);
      toast.success(
        `Imported "${parsed.name}" — ${parsed.tracks.length} ${parsed.tracks.length === 1 ? "song" : "songs"} from ${parsed.origin}`,
      );
    } catch {
      toast.error("Couldn't read that file — try again");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const handleLink = async () => {
    const plan = planImport(link);
    if (busy || !link.trim()) return;
    setBusy(true);
    try {
      if (
        plan.mode !== "direct" ||
        !plan.source ||
        !canDirectImport(plan.source)
      ) {
        // Not a linkable service (or not a playlist). Say exactly what to do
        // next instead of failing with a generic error.
        toast.error(plan.message, { duration: 8000 });
        return;
      }
      const result = await fetchYouTubePlaylist({
        playlistId: plan.source.id!,
      });
      if (result.tracks.length === 0) {
        toast.error("That playlist came back empty — it may be private.");
        return;
      }
      const name = nameFromUrl(link) || result.name;
      await saveImported({
        name,
        origin: result.origin,
        tracks: result.tracks,
      });
      setLink("");
      setLastImported(`${name} · ${result.tracks.length} songs`);
      toast.success(
        `Imported "${name}" — ${result.tracks.length} ${result.tracks.length === 1 ? "song" : "songs"} straight from ${result.origin}${
          result.partial ? " (first 500)" : ""
        }`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Couldn't import that playlist — is it public?",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`settings-import flex flex-col gap-2.5 ${className}`}>
      <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
        <Music4 className="size-3.5" />
        Import playlists
      </p>

      {/* Direct import from a share link */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3">
        <p className="text-sm font-medium">Paste a playlist link</p>
        <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
          YouTube and YouTube Music links import in one click — no export, no
          account linking. Other services need a file (see below).
        </p>
        <div className="mt-2.5 flex items-center gap-2">
          <div className="relative flex-1">
            <Link2 className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="url"
              inputMode="url"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleLink();
              }}
              placeholder="https://music.youtube.com/playlist?list=…"
              aria-label="Playlist link"
              disabled={busy || !open}
              className="w-full rounded-full border border-white/10 bg-black/25 py-2 pr-3 pl-8 text-sm outline-none placeholder:text-muted-foreground focus:border-[rgb(var(--tint))] disabled:opacity-50"
            />
          </div>
          <button
            type="button"
            onClick={() => void handleLink()}
            disabled={busy || !open || !link.trim()}
            className="flex shrink-0 items-center gap-2 rounded-full bg-[rgb(var(--tint))] px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Link2 className="size-4" />
            )}
            {busy ? "Importing…" : "Import"}
          </button>
        </div>
      </div>

      {/* File import */}
      <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.03] px-3 py-4 text-center">
        <p className="text-sm font-medium">Or bring a file</p>
        <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
          Export a playlist (or your liked songs) from another music service as
          a CSV or text file, then drop it here. It shows up in your Library.
        </p>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,.txt,.tsv,text/csv,text/plain"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
        />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={busy || !open}
          className="mx-auto mt-3 flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-semibold transition-colors hover:bg-white/[0.1] disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Upload className="size-4" />
          )}
          {busy ? "Importing…" : "Choose a file"}
        </button>
        <details className="mt-3 text-left">
          <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground hover:text-foreground">
            How do I export my playlists?
          </summary>
          <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[11px] text-muted-foreground">
            <li>
              <span className="font-medium text-foreground/80">
                YouTube / YouTube Music:
              </span>{" "}
              just paste the link above — no export needed.
            </li>
            <li>
              <span className="font-medium text-foreground/80">Spotify:</span>{" "}
              paste the link to check, then use any CSV exporter (or a "Export
              playlist to CSV" extension) and drop the file here.
            </li>
            <li>
              <span className="font-medium text-foreground/80">
                Apple Music:
              </span>{" "}
              Share → Copy link to check the format, then export to CSV.
            </li>
            <li>
              Any text list of songs also works — one "Artist - Title" per line.
            </li>
          </ul>
        </details>
        {lastImported && (
          <p className="mt-2 text-[11px] text-[rgb(var(--tint))]">
            Last import: {lastImported}
          </p>
        )}
      </div>
    </section>
  );
}
