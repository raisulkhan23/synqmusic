import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { Playable } from "@/lib/playable";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

/**
 * Shared "add this track to a playlist" logic. Returns the user's playlists and
 * a mutation helper that surfaces real errors instead of a generic failure.
 */
export function useAddToPlaylist(track: Playable) {
  const playlists = useQuery(api.playlists.myPlaylists);
  const addTrack = useMutation(api.playlists.addTrack);

  const addTo = async (playlistId: Id<"playlists">, name: string) => {
    // Duplicate detection: warn if the song is already in this playlist.
    const target = playlists?.find((p) => p._id === playlistId);
    if (target?.trackIds.includes(track.id)) {
      toast.warning(`"${track.title}" is already in ${name}`);
      return;
    }
    try {
      await addTrack({
        playlistId,
        trackId: track.id,
        detail: track.title,
        track: {
          id: track.id,
          title: track.title,
          artist: track.artistName || "Unknown artist",
          album: track.albumName || undefined,
          coverUrl: track.coverUrl ?? "",
          duration: Number.isFinite(track.duration) ? track.duration : 0,
          youtubeId: track.youtubeId || undefined,
        },
      });
      toast.success(`Added "${track.title}" to ${name}`);
    } catch (error) {
      const message =
        error instanceof Error && error.message ? error.message : "Unknown error";
      toast.error(`Couldn't add to ${name}`, { description: message });
    }
  };

  return { playlists, addTo };
}
