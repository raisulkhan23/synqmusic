import { useNavigate } from "react-router";
import type { Doc } from "@/convex/_generated/dataModel";
import { ListMusic } from "lucide-react";

export function PlaylistCard({ playlist }: { playlist: Doc<"playlists"> }) {
  const navigate = useNavigate();

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/playlist/${playlist._id}`)}
      onKeyDown={(e) => {
        if (e.key === "Enter") navigate(`/playlist/${playlist._id}`);
      }}
      className="group w-36 shrink-0 cursor-pointer sm:w-44"
    >
      <div className="relative aspect-square overflow-hidden rounded-xl ring-1 ring-white/10">
        <div className="flex size-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-white/[0.09] to-white/[0.03]">
          <ListMusic className="size-8 text-muted-foreground/50" />
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      </div>
      <div className="mt-2.5 px-0.5">
        <p className="truncate text-sm font-semibold">{playlist.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {playlist.trackIds.length} {playlist.trackIds.length === 1 ? "song" : "songs"}
        </p>
      </div>
    </div>
  );
}
