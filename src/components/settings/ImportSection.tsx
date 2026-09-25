import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { parsePlaylistImport } from "@/lib/importPlaylist";
import { Loader2, Music4, Upload } from "lucide-react";
import { toast } from "sonner";

/**
 * Settings section for importing playlists (liked songs, collections) from
 * other music services. Works from a CSV/text export file — no account
 * linking or provider passwords needed. Imported playlists appear in the
 * Library and are resolved to playable tracks at play time.
 */
export function ImportSection({ open, className = "" }: { open: boolean; className?: string }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [lastImported, setLastImported] = useState<string | null>(null);
  const saveImported = useMutation(api.playlists.saveImported);

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

  return (
    <section className={`settings-import flex flex-col gap-2.5 ${className}`}>
      <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
        <Music4 className="size-3.5" />
        Import playlists
      </p>
      <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.03] px-3 py-4 text-center">
        <p className="text-sm font-medium">Bring your music with you</p>
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
              <span className="font-medium text-foreground/80">YouTube Music:</span>{" "}
              Google Takeout → YouTube &amp; YouTube Music → playlists CSV.
            </li>
            <li>
              <span className="font-medium text-foreground/80">Spotify:</span> any
              playlist export tool or "Export playlist as CSV" extension.
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
