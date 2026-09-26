import { Logo } from "@/components/brand/Logo";
import { ShieldCheck } from "lucide-react";
import { Link } from "react-router";

/**
 * Landing footer, composed like a launch-directory masthead: a scalloped top
 * edge, a brand block with a "featured on" badge row, four small-caps link
 * columns, an oversized ghosted wordmark bleeding off both sides behind
 * everything, a centred copyright pill, and a floating promise pill.
 *
 * Deliberately built from the app's own tokens (`brand`, `muted-foreground`,
 * glass surfaces) rather than any single flat brand colour, so it re-themes
 * with the accent picker and stays legible in light, dark and amoled.
 */

const linkColumns = [
  {
    heading: "Explore",
    links: [
      { label: "Features", to: "/#features" },
      { label: "Visualizer", to: "/#visualizer" },
      { label: "Experience", to: "/#experience" },
    ],
  },
  {
    heading: "Get started",
    links: [
      { label: "Sign in", to: "/auth" },
      { label: "Your library", to: "/home" },
      { label: "New playlist", to: "/auth?returnTo=/playlists" },
    ],
  },
  {
    heading: "Product",
    links: [
      { label: "Keyboard shortcuts", to: "/#experience" },
      { label: "Listening stats", to: "/home" },
      { label: "Discover weekly", to: "/home" },
    ],
  },
  {
    heading: "Connect",
    links: [
      { label: "Support", to: "/#features" },
      { label: "Privacy", to: "/#features" },
      { label: "Terms", to: "/#features" },
    ],
  },
] as const;

const featuredOn = [
  {
    name: "EasyLaunch",
    href: "https://easylaunch.dev/media/synqmusic",
    badge: "https://easylaunch.dev/badge/easylaunch-badge-dark.svg",
    width: 188,
    height: 56,
  },
  {
    name: "Sky Launch",
    href: "https://skylaun.ch/media/synqmusic",
    badge: "https://skylaun.ch/badge/skylaunch-badge-dark.svg",
    width: 188,
    height: 56,
  },
  {
    name: "Launch Streak",
    href: "https://launchstreak.dev/media/synqmusic",
    badge: "https://launchstreak.dev/badge/launch-streak-badge-dark.svg",
    width: 248,
    height: 68,
  },
  {
    name: "EasyDoFollow",
    href: "https://easydofollow.dev/media/synqmusic",
    badge: "https://easydofollow.dev/badge/easydofollow-badge-dark.svg",
    width: 188,
    height: 56,
  },
] as const;

export function SiteFooter() {
  return (
    <footer className="footer-scallop relative z-10 mt-8 border-t border-white/[0.07] bg-white/[0.015] pt-16 pb-10 sm:mt-12 sm:pt-20">
      {/* Clipping lives on its own layer, NOT on the footer: the scalloped
          edge is drawn above the footer's top border, so an `overflow-hidden`
          here would cut the bumps off entirely. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        {/* Oversized wordmark bleeding off the bottom, the way a masthead sets
            its own name behind the content. */}
        <span className="absolute inset-x-0 -bottom-4 block select-none text-center font-display text-[26vw] leading-none font-bold tracking-tighter text-white/[0.035] sm:-bottom-6">
          SYNQ
        </span>
      </div>

      <div className="relative mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div className="grid gap-12 lg:grid-cols-[1.15fr_1.85fr] lg:gap-10">
          {/* brand block */}
          <div className="max-w-sm">
            <Logo to="/" />
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              A home for the songs you actually want to hear — no ads, no
              clutter, and a queue that moves like you do.
            </p>

            <p className="mt-8 text-[10px] font-bold tracking-[0.24em] text-muted-foreground uppercase">
              Featured on
            </p>
            <ul className="mt-3 flex flex-wrap items-center gap-2.5">
              {featuredOn.map((badge) => (
                <li key={badge.name}>
                  <a
                    href={badge.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-lg opacity-80 transition-all duration-200 hover:-translate-y-0.5 hover:opacity-100 focus-visible:-translate-y-0.5 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--tint))]"
                  >
                    <img
                      src={badge.badge}
                      alt={`Featured on ${badge.name}`}
                      width={badge.width}
                      height={badge.height}
                      loading="lazy"
                      decoding="async"
                      className="block h-8 w-auto"
                    />
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* link columns */}
          <nav className="grid grid-cols-2 gap-8 sm:grid-cols-4 sm:gap-6">
            {linkColumns.map((column) => (
              <div key={column.heading} className="min-w-0">
                <p className="text-[10px] font-bold tracking-[0.22em] text-[rgb(var(--tint))] uppercase">
                  {column.heading}
                </p>
                <ul className="mt-4 space-y-2.5">
                  {column.links.map((link) => (
                    <li key={link.label} className="min-w-0">
                      <Link
                        to={link.to}
                        className="block truncate text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        {/* copyright pill */}
        <div className="mt-14 flex justify-center sm:mt-16">
          <div className="inline-flex max-w-full flex-col items-center gap-1.5 rounded-2xl border border-white/10 bg-white/[0.04] px-6 py-3.5 text-center">
            <p className="font-mono text-xs font-medium tracking-tight text-foreground">
              © 2026 SYNQ — currently in beta
            </p>
            <p className="font-mono text-[10px] font-bold tracking-[0.26em] text-[rgb(var(--tint))] uppercase">
              Made for long listens
            </p>
          </div>
        </div>
      </div>

      {/* floating promise pill, anchored to the bottom-left of the footer */}
      <div className="pointer-events-none absolute bottom-8 left-4 hidden sm:block lg:left-6">
        <div className="inline-flex items-center gap-2.5 rounded-full border border-white/10 bg-[#0b0c11]/80 py-2 pr-3 pl-2.5 shadow-xl backdrop-blur-xl">
          <span className="flex size-7 items-center justify-center rounded-full bg-[rgb(var(--tint))]/15 text-[rgb(var(--tint))]">
            <ShieldCheck className="size-3.5" />
          </span>
          <span className="text-xs font-semibold text-foreground">Zero ads</span>
          <span className="rounded-full bg-[rgb(var(--tint))] px-2 py-0.5 text-[10px] font-bold text-black">
            forever
          </span>
        </div>
      </div>
    </footer>
  );
}
