import { ArrowRight, Download, Loader2, Smartphone } from "lucide-react";
import { toast } from "sonner";

import { usePwaInstall, manualInstallHint, planInstallBlock } from "@/lib/pwa";
import { cn } from "@/lib/utils";

/**
 * The "install SYNQ" button.
 *
 * ## Why this is shared
 *
 * Installability has three surfaces — the landing page's labelled Web (PWA)
 * card, the in-app install strip and the Settings row — and each one has to
 * agree. When the install affordance only existed inside the signed-in shell,
 * the one moment a visitor is most likely to want the app (on the marketing
 * page, before they have any reason to make an account) was the one moment it
 * was unreachable. Under deferred authentication that gap got worse: a visitor
 * no longer passes through a sign-in wall on the way in, so they now reach the
 * landing page and stay there.
 *
 * One component, three call sites, one implementation of the states.
 *
 * ## Why it never lies
 *
 * `usePwaInstall` resolves to `ready`, `manual`, `dismissed`, `installed` or
 * `unavailable`. The button reflects exactly that. In particular it does not
 * show a dead "Download" that silently does nothing in a dev preview: it
 * names the real reason through `planInstallBlock` — no service worker, dev
 * build, or no HTTPS — because a button that fails in silence reads as a
 * broken app rather than an unavailable feature.
 *
 * ## Where it lives
 *
 * The hero and the nav must NOT render this button: a visitor pressing
 * "Download" next to "Start listening" wants the app itself, and the honest
 * answer is the download section (Windows installer, Android APK, and this
 * PWA — labelled as such), not a browser-install prompt. That is why the
 * component only ever appears inside the card that says "Web (PWA)".
 */
export function InstallAppButton({
  className,
  variant = "outline",
}: {
  className?: string;
  /**
   * `outline` sits beside a primary CTA; `solid` stands alone; `link` matches
   * the download cards' text-link CTAs ("Download .exe →") so the PWA card
   * reads as the same grid, not a different species of button.
   */
  variant?: "outline" | "solid" | "link";
}) {
  const { state, install, installed } = usePwaInstall();

  // Already installed: there is nothing to download, and saying so is more
  // useful than a button that does nothing.
  if (state === "installed" || installed) {
    return (
      <span
        className={cn(
          variant === "link"
            ? "mt-auto flex items-center gap-1 text-sm font-semibold text-muted-foreground"
            : "inline-flex items-center gap-2 rounded-full border border-white/10 px-5 py-3 text-sm font-semibold text-muted-foreground",
          className,
        )}
      >
        <Smartphone className="size-4" />
        App installed
      </span>
    );
  }

  const blocked = planInstallBlock({
    hasServiceWorker: "serviceWorker" in navigator,
    isProd: import.meta.env.PROD,
    isSecureContext: window.isSecureContext,
  });

  const handleClick = async () => {
    if (blocked) {
      toast.error("Can't install yet", { description: blocked });
      return;
    }
    if (state === "manual") {
      // No `beforeinstallprompt` to call — the browser has to be driven from
      // its own menu, so say exactly where to look rather than doing nothing.
      toast("Install SYNQ", {
        description: manualInstallHint(
          /iPad|iPhone|iPod/.test(navigator.userAgent),
        ),
      });
      return;
    }
    const ok = await install();
    if (ok) toast.success("SYNQ installed");
  };

  if (variant === "link") {
    return (
      <button
        type="button"
        onClick={() => void handleClick()}
        aria-label="Install SYNQ as a web app"
        className={cn(
          "group mt-auto flex items-center gap-1 text-sm font-semibold text-brand transition-colors hover:brightness-110",
          className,
        )}
      >
        {state !== "ready" && <Loader2 className="size-3.5 animate-spin" />}
        Install app
        <ArrowRight className="size-4 transition-transform [@media(hover:hover)]:group-hover:translate-x-1" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      aria-label="Download SYNQ as an app"
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold transition-ui active:scale-[0.98]",
        variant === "solid"
          ? "bg-brand text-brand-foreground hover:brightness-105"
          : "border border-white/10 text-muted-foreground hover:border-white/20 hover:text-foreground",
        className,
      )}
    >
      {state === "ready" ? (
        <Download className="size-4" />
      ) : (
        <Loader2 className="size-4" />
      )}
      Download app
    </button>
  );
}
