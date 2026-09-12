import { cn } from "@/lib/utils";
import { Link } from "react-router";

export function Logo({ to = "/", className }: { to?: string; className?: string }) {
  return (
    <Link to={to} className={cn("group inline-flex items-center gap-2.5", className)}>
      <img
        src="/logo.svg"
        alt="SoundCore logo"
        className="shrink-0 h-[26px] w-auto"
        width={104}
        height={104}
      />
      <span className="font-display text-[17px] font-bold tracking-tight">
        SoundCore
      </span>
      <span
        className="rounded-full border border-[rgb(var(--tint)/0.35)] bg-[rgb(var(--tint)/0.12)] px-1.5 py-px text-[9px] font-bold tracking-[0.08em] text-[rgb(var(--tint))] uppercase"
      >
        Beta
      </span>
    </Link>
  );
}