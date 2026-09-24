import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { usePlayerStore } from "@/store/player";
import { toast } from "sonner";
import { ExternalLink, Loader2, ShieldCheck } from "lucide-react";

/**
 * YouTube occasionally answers stream requests with a "Sign in to confirm
 * you're not a bot" check. That check can only be completed by a human —
 * and YouTube renders it inside its own player. So instead of silently
 * failing (which left the EQ/effects dead with an error toast), we surface
 * the official player here, let the user clear the check, and then retry the
 * stream resolution so effects start working.
 */
export function VerificationDialog() {
  const open = usePlayerStore((s) => s.needsHumanVerification);
  const close = usePlayerStore((s) => s.closeHumanVerification);
  const current = usePlayerStore((s) => s.current);
  const setQueueOpen = usePlayerStore((s) => s.setQueueOpen);
  const setQueueOpenAction = usePlayerStore((s) => s.setQueueOpen);
  const [checking, setChecking] = useState(false);

  // Clear the queue panel so it can't sit on top of the check.
  useEffect(() => {
    if (open) {
      setQueueOpen(false);
      setQueueOpenAction(false);
    }
  }, [open, setQueueOpen, setQueueOpenAction]);

  const videoId = current?.youtubeId;

  const retry = async () => {
    if (!current) return;
    setChecking(true);
    try {
      // Re-resolve and swap the current track onto the filtered audio path.
      // The store's retry helper re-runs ytResolve and, on success, the EQ
      // chain takes over from the IFrame engine.
      const { playViaStream } = usePlayerStore.getState();
      const marked = { ...current, audioUrl: "stream" };
      playViaStream(marked, usePlayerStore.getState().currentTime);
      close();
      toast.success("Verification saved — applying your effect");
    } finally {
      setChecking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-[rgb(var(--tint))]" />
            One quick verification
          </DialogTitle>
          <DialogDescription>
            YouTube asked us to confirm a real person is listening. Complete the
            check below and your sound effects (EQ, 8D, bass boost) will keep
            working for the rest of this session.
          </DialogDescription>
        </DialogHeader>

        {videoId ? (
          <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-white/10 bg-black">
            <iframe
              key={videoId}
              title="YouTube verification"
              src={`https://www.youtube.com/embed/${videoId}?autoplay=0&controls=1&modestbranding=0&rel=0&iv_load_policy=3&origin=${typeof window !== "undefined" ? window.location.origin : ""}`}
              allow="accelerometer; encrypted-media; picture-in-picture"
              referrerPolicy="strict-origin-when-cross-origin"
              className="absolute inset-0 size-full border-0"
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Play a song first, then reopen this check.
          </p>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <a
            href={videoId ? `https://www.youtube.com/watch?v=${videoId}` : "https://www.youtube.com"}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Open on YouTube instead
            <ExternalLink className="size-3" />
          </a>
          <Button onClick={() => void retry()} disabled={checking || !videoId}>
            {checking ? <Loader2 className="size-4 animate-spin" /> : null}
            {checking ? "Applying…" : "I finished the check"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
