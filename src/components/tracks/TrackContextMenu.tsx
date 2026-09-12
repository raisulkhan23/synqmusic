import { useState } from "react";
import { useNavigate } from "react-router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { albumById, artistById, type Track } from "@/lib/catalog";
import { usePlayerStore } from "@/store/player";
import { toast } from "sonner";
import {
  ExternalLink,
  Heart,
  Link2,
  ListEnd,
  ListStart,
  Share2,
} from "lucide-react";

/**
 * Right-click context menu for a catalog track: play next, add to queue,
 * like, go to album, copy link, share. Opens only on contextmenu (no
 * left-click hijacking).
 */
export function TrackContextMenu({
  track,
  children,
}: {
  track: Track;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const liked = usePlayerStore((s) => s.liked);
  const toggleLike = usePlayerStore((s) => s.toggleLike);

  const album = albumById(track.albumId);
  const artist = artistById(track.artistId);
  const isLiked = liked[track.id] !== undefined;

  const playNext = () => {
    const s = usePlayerStore.getState();
    const at = s.queueIndex >= 0 ? s.queueIndex + 1 : s.queue.length;
    s.insertInQueue(track, at);
    toast.success(`Playing "${track.title}" next`);
  };

  const add = () => {
    const s = usePlayerStore.getState();
    s.addToQueue(track);
    toast.success("Added to queue");
  };

  const copyLink = () => {
    void navigator.clipboard
      .writeText(`${window.location.origin}/album/${album.id}`)
      .then(() => toast.success("Song link copied"));
  };

  const share = async () => {
    const url = `${window.location.origin}/album/${album.id}`;
    const shareData = {
      title: `${track.title} — ${artist.name}`,
      text: `Listen to ${track.title} by ${artist.name} on SoundScape`,
      url,
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch {
        /* cancelled — fall through to copy */
      }
    }
    await navigator.clipboard.writeText(url).catch(() => undefined);
    toast.success("Link copied to clipboard");
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <span
          className="contents"
          onContextMenu={(e) => {
            e.preventDefault();
            setOpen(true);
          }}
        >
          {children}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem className="gap-2" onSelect={() => playNext()}>
          <ListStart className="size-4" />
          Play next
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2" onSelect={() => add()}>
          <ListEnd className="size-4" />
          Add to queue
        </DropdownMenuItem>
        <DropdownMenuSeparator />        <DropdownMenuItem
          className="gap-2"
          onSelect={() => toggleLike(track.id)}
        >
          <Heart
            className={`size-4 ${isLiked ? "fill-current text-[rgb(var(--tint))]" : ""}`}
          />
          {isLiked ? "Remove from Liked" : "Add to Liked"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="gap-2"
          onSelect={() => navigate(`/album/${album.id}`)}
        >
          <ExternalLink className="size-4" />
          Go to album
        </DropdownMenuItem>
        <DropdownMenuItem
          className="gap-2"
          onSelect={() => navigate(`/artist/${artist.id}`)}
        >
          <Link2 className="size-4" />
          Go to artist
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="gap-2" onSelect={() => copyLink()}>
          <Link2 className="size-4" />
          Copy song link
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2" onSelect={() => void share()}>
          <Share2 className="size-4" />
          Share…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

