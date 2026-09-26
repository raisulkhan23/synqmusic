import { useState } from "react";
import { cn } from "@/lib/utils";
import { Link } from "react-router";
import { ArrowRightFromLine, ArrowRightToLine } from "lucide-react";

/** iconOnly renders just the mark — used in the collapsed sidebar rail. */
export function Logo({
  to = "/home",
  className,
  iconOnly = false,
  onToggle,
  collapsed,
}: {
  to?: string;
  className?: string;
  iconOnly?: boolean;
  /** When given, the logo becomes the sidebar collapse/expand control. */
  onToggle?: () => void;
  /** Sidebar state, so the icon shown on hover says what the click will do. */
  collapsed?: boolean;
}) {
  // Pointer only, never focus: a keyboard user tabbing onto the control should
  // keep seeing the wordmark, and a touch tap must not leave the icon stuck
  // in place after the finger lifts.
  const [hovered, setHovered] = useState(false);

  if (onToggle) {
    const ActionIcon = collapsed ? ArrowRightFromLine : ArrowRightToLine;
    const actionLabel = collapsed ? "Expand sidebar" : "Collapse sidebar";
    const pointerProps = {
      onPointerEnter: () => setHovered(true),
      onPointerLeave: () => setHovered(false),
    };

    if (iconOnly) {
      return (
        <button
          type="button"
          onClick={onToggle}
          {...pointerProps}
          aria-label={actionLabel}
          title={actionLabel}
          className={cn("group inline-flex", className)}
        >
          <span className="relative inline-flex items-center justify-center">
            <img
              src="/logo.svg"
              alt="SYNQ logo"
              aria-hidden={hovered || undefined}
              className={cn(
                "h-7 w-auto shrink-0 transition-opacity duration-150",
                hovered && "opacity-0",
              )}
              width={104}
              height={104}
            />
            <ActionIcon
              aria-hidden
              className={cn(
                "absolute left-1/2 top-1/2 size-[18px] -translate-x-1/2 -translate-y-1/2 text-foreground transition-opacity duration-150",
                hovered ? "opacity-100" : "opacity-0",
              )}
            />
          </span>
        </button>
      );
    }

    return (
      <button
        type="button"
        onClick={onToggle}
        {...pointerProps}
        aria-label={actionLabel}
        title={actionLabel}
        className={cn(
          "group inline-flex items-center gap-2.5 rounded-lg text-left transition-colors hover:bg-white/[0.05]",
          className,
        )}
      >
        {/* The wordmark keeps its box while it fades, so the header does not
            jump sideways when the icon takes its place. */}
        <span className="relative inline-flex items-center">
          <span
            className={cn(
              "inline-flex items-center gap-2.5 transition-opacity duration-150",
              hovered ? "opacity-0" : "opacity-100",
            )}
          >
            <img
              src="/logo.svg"
              alt="SYNQ logo"
              aria-hidden={hovered || undefined}
              className="h-[26px] w-auto shrink-0"
              width={104}
              height={104}
            />
            <span className="font-display text-[17px] font-bold tracking-tight">
              SYNQ
            </span>
            <span className="rounded-full border border-[rgb(var(--tint)/0.35)] bg-[rgb(var(--tint)/0.12)] px-1.5 py-px text-[9px] font-bold tracking-[0.08em] text-[rgb(var(--tint))] uppercase">
              Beta
            </span>
          </span>
          <ActionIcon
            aria-hidden
            className={cn(
              "absolute left-0 top-1/2 size-[18px] -translate-y-1/2 text-foreground transition-opacity duration-150",
              hovered ? "opacity-100" : "opacity-0",
            )}
          />
        </span>
      </button>
    );
  }

  if (iconOnly) {
    return (
      <Link to={to} className={cn("group inline-flex", className)}>
        <img
          src="/logo.svg"
          alt="SYNQ logo"
          className="h-7 w-auto shrink-0"
          width={104}
          height={104}
        />
      </Link>
    );
  }
  return (
    <Link
      to={to}
      className={cn("group inline-flex items-center gap-2.5", className)}
    >
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
        <span className="rounded-full border border-[rgb(var(--tint)/0.35)] bg-[rgb(var(--tint)/0.12)] px-1.5 py-px text-[9px] font-bold tracking-[0.08em] text-[rgb(var(--tint))] uppercase">
          Beta{" "}
        </span>
      )}
    </Link>
  );
}
