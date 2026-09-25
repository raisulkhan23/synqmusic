export type DiscordBridgeStatus = "disconnected" | "connecting" | "connected";

export interface DiscordPresenceActivity {
  details?: string;
  state?: string;
}

type BridgeMessage =
  | { type: "activity"; activity: DiscordPresenceActivity }
  | { type: "clear" };

const BRIDGE_URL = "ws://127.0.0.1:8787";
const listeners = new Set<(status: DiscordBridgeStatus) => void>();

let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;
let latestActivity: DiscordPresenceActivity | null = null;
let status: DiscordBridgeStatus = "disconnected";

function emitStatus(next: DiscordBridgeStatus) {
  status = next;
  for (const listener of listeners) listener(status);
}

function send(message: BridgeMessage) {
  if (socket?.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(message));
}

function scheduleReconnect() {
  if (reconnectTimer !== null) return;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 4000);
}

function connect() {
  if (typeof window === "undefined" || typeof WebSocket === "undefined") return;
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;

  emitStatus("connecting");
  const next = new WebSocket(BRIDGE_URL);
  socket = next;
  next.onopen = () => {
    emitStatus("connected");
    if (latestActivity) send({ type: "activity", activity: latestActivity });
    else send({ type: "clear" });
  };
  next.onmessage = () => undefined;
  next.onerror = () => {
    next.close();
  };
  next.onclose = () => {
    if (socket === next) socket = null;
    emitStatus("disconnected");
    scheduleReconnect();
  };
}

export function subscribeDiscordBridge(listener: (next: DiscordBridgeStatus) => void) {
  listeners.add(listener);
  listener(status);
  return () => {
    listeners.delete(listener);
  };
}

export function getDiscordBridgeStatus() {
  return status;
}

export function publishDiscordPresence(activity: DiscordPresenceActivity) {
  latestActivity = activity;
  connect();
  send({ type: "activity", activity });
}

export function clearDiscordPresence() {
  latestActivity = null;
  if (socket) send({ type: "clear" });
}
