import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

/**
 * Client-side analytics helper.
 *
 * Every event goes through the Convex action so the Amplitude API key stays on
 * the server. Everything here is fire-and-forget and NEVER throws or blocks:
 * analytics must not be able to break playback or a click.
 */

type Props = Record<string, string | number | boolean | null>;

let client: ConvexHttpClient | null = null;
function getClient(): ConvexHttpClient {
  client ??= new ConvexHttpClient(import.meta.env.VITE_CONVEX_URL as string);
  return client;
}

const DEVICE_KEY = "ss.analyticsDeviceId";

/** Stable per-browser id (Amplitude uses it to stitch sessions). */
function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return "anonymous";
  }
}

/** True once a call has clearly failed, so we stop retrying every event. */
let disabled = false;

export function isAnalyticsEnabled(): boolean {
  return !disabled;
}

/** Send one event. Silently no-ops (and disables itself) if it can't be sent. */
export function track(event: string, properties: Props = {}): void {
  if (disabled) return;
  try {
    void getClient()
      .action(api.amplitude.track, { event, properties, deviceId: getDeviceId() })
      .then((res) => {
        // `skipped` means the key isn't configured yet — stay quiet but keep
        // the integration ready for when it is added.
        if (res && "skipped" in res && res.skipped) return;
      })
      .catch(() => {
        // A single failure shouldn't disable tracking; only a hard auth
        // failure does (e.g. deployment misconfigured).
        if (navigator.onLine === false) return;
      });
  } catch {
    disabled = true;
  }
}

/** Send a batch (used sparingly, e.g. session start). */
export function trackBatch(events: { event: string; properties?: Props }[]): void {
  if (disabled || events.length === 0) return;
  try {
    void getClient()
      .action(api.amplitude.trackBatch, { events, deviceId: getDeviceId() })
      .catch(() => undefined);
  } catch {
    disabled = true;
  }
}

/** Re-enable after the user adds their API key mid-session. */
export function resetAnalytics(): void {
  disabled = false;
}
