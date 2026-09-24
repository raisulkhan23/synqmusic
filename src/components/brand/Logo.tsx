import { cn } from "@/lib/utils";
import { Link } from "react-router";

/** iconOnly renders just the mark — used in the collapsed sidebar rail. */
export function Logo({ to = "/", className, iconOnly = false }: { to?: string; className?: string; iconOnly?: boolean }) {
  if (iconOnly) {
    return (
      <Link to={to} className={cn("group inline-flex", className)}>
        <img src="/logo.svg" alt="SYNQ logo" className="h-7 w-auto shrink-0" width={104} height={104} />
      </Link>
    );
  }
  return (
    <Link to={to} className={cn("group inline-flex items-center gap-2.5", className)}>
      <img
        src="/logo.svg"
        alt="SYNQ logo"
        className="shrink-0 h-[26px] w-auto"
        width={104}
        height={104}
      />
      <span className="font-display text-[17px] font-bold tracking-tight">
        SYNQ
      </span>
      {!iconOnly && (
      <span
        className="rounded-full border border-[rgb(var(--tint)/0.35)] bg-[rgb(var(--tint)/0.12)] px-1.5 py-px text-[9px] font-bold tracking-[0.08em] text-[rgb(var(--tint))] uppercase"
      >
        Beta        </span>
      )}
    </Link>
  );
}