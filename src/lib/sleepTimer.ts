import { useEffect, useState } from "react";

/**
 * Sleep-timer countdown, shared by every surface that shows it.
 *
 * It lived inside the fullscreen player, which meant the timer was invisible
 * everywhere else: on a phone the bar is the only chrome most of the time, so
 * a listener who armed a 30-minute timer had no way to see it counting down or
 * cancel it without opening the fullscreen view.
 */

/** `4:07`, or `9s` under a minute — a timer has to read at a glance. */
export function formatRemaining(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

/**
 * A ticking `Date.now()` while a timer is armed, and a frozen one otherwise.
 *
 * Ticks on a 1s interval rather than aligning to the second boundary: the
 * label rounds to whole seconds anyway, and a per-second `setTimeout` chain
 * that reschedules itself keeps a timer running forever in a background tab.
 */
export function useSleepCountdown(sleepEndsAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (sleepEndsAt === null) return;
    // No synchronous `setNow` here: it would be a second render pass on every
    // arm/cancel, and `now` is at most one tick stale without it.
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [sleepEndsAt]);

  return now;
}
