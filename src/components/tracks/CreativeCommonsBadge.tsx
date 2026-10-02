import { CreativeCommons } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Marks a track whose licence has been CONFIRMED as Creative Commons — which
 * means the Download action will actually accept it.
 *
 * One component for all three surfaces (list rows, shelf cards, the queue), so
 * the claim cannot drift between them. This badge is a statement about rights,
 * and three hand-rolled copies of it is exactly how one of them ends up
 * asserting something the others do not.
 *
 * It is deliberately tiny and low-contrast next to a track's real controls: it
 * labels a song, it does not compete with Play.
 */
export function CreativeCommonsBadge({ className }: { className?: string }) {
  return (
    <span
      title="Creative Commons — this track can be downloaded"
      aria-label="Creative Commons — available to download"
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-full border border-[rgb(var(--tint)_/_0.35)] bg-[rgb(var(--tint)_/_0.1)] px-1.5 py-px text-[9px] font-semibold tracking-wide text-[rgb(var(--tint))] uppercase",
        className,
      )}
    >
      <CreativeCommons className="size-2.5" aria-hidden />
      CC
    </span>
  );
}
