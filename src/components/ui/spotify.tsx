import { cn } from "@/lib/utils";
import type { SVGAttributes } from "react";

/** Spotify's circular mark (three arcs) used on source badges. */
export function SpotifyIcon({
  className,
  ...props
}: SVGAttributes<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      className={cn("size-3 shrink-0", className)}
      fill="currentColor"
      {...props}
    >
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.516 17.293a.748.748 0 0 1-1.03.249c-2.82-1.724-6.37-2.113-10.553-1.158a.748.748 0 1 1-.333-1.459c4.567-1.044 8.488-.602 11.667 1.338.352.216.464.676.249 1.03zm1.472-3.268a.936.936 0 0 1-1.288.308c-3.228-1.984-8.148-2.559-11.962-1.4a.937.937 0 1 1-.544-1.793c4.357-1.323 9.775-.68 13.486 1.597.44.27.578.847.308 1.288zm.127-3.404C15.085 8.365 8.999 8.165 5.39 9.25a1.123 1.123 0 0 1-.652-2.15c4.153-1.26 10.9-1.016 15.196 1.547a1.123 1.123 0 0 1-1.15 1.929l.231-.105z" />
    </svg>
  );
}
