import { useEffect, useState } from "react";
import { useAction } from "convex/react";
import { GravityAd } from "@gravity-ai/react";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";

/**
 * A single, clearly-labelled sponsored slot.
 *
 * Deliberately restrained: one card, labelled, skippable, and it renders
 * nothing at all when the integration isn't configured (no key, no fill) or
 * when the user has turned sponsored content off. The request happens
 * server-side, so no API key is ever exposed.
 */

const OPT_OUT_KEY = "ss.hideSponsored";

function optOutEnabled(): boolean {
  try {
    return localStorage.getItem(OPT_OUT_KEY) === "1";
  } catch {
    return true;
  }
}

export function GravitySponsor({
  context,
  placement = "search_results",
  className,
}: {
  context: string;
  placement?: string;
  className?: string;
}) {
  const requestAds = useAction(api.gravity.requestAds);
  const [ad, setAd] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (optOutEnabled()) return;
    let cancelled = false;
    const query = context.trim();
    if (query.length < 2) return;
    void requestAds({ context: query, placement })
      .then((res) => {
        if (cancelled) return;
        const first = res.ads?.[0];
        setAd(first ? (first as unknown as Record<string, unknown>) : null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [context, placement, requestAds]);

  const dismiss = () => {
    setAd(null);
    try {
      localStorage.setItem(OPT_OUT_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  if (optOutEnabled() || ad === null) return null;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4",
        className,
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold tracking-widest text-muted-foreground/80 uppercase">
          <Sparkles className="size-3" />
          Sponsored
        </span>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Hide sponsored content"
          className="rounded-full px-2 py-0.5 text-[10px] text-muted-foreground/70 transition-colors hover:bg-white/[0.06] hover:text-foreground"
        >
          Hide ads
        </button>
      </div>
      <GravityAd
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ad={ad as any}
        variant="labeled"
        showLabel={false}
        openInNewTab
        className="w-full"
      />
    </div>
  );
}
