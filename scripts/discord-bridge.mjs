import { WebSocketServer } from "ws";
import { Client } from "@xhayper/discord-rpc";

const HOST = "127.0.0.1";
const PORT = Number(process.env.SYNQ_DISCORD_BRIDGE_PORT ?? 8787);
const CLIENT_ID = process.env.DISCORD_CLIENT_ID?.trim();
const allowedOrigins = new Set(
  (process.env.SYNQ_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

for (const origin of [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
]) {
  allowedOrigins.add(origin);
}

let discordClient = null;
let lastActivity = null;
let reconnectTimer = null;

function log(message) {
  console.log(`[synq-discord] ${message}`);
}

function originAllowed(origin) {
  if (!origin || allowedOrigins.has(origin)) return true;
  try {
    return new URL(origin).hostname.endsWith(".vly.sh");
  } catch {
    return false;
  }
}

function activityPayload(activity) {
  const details = String(activity?.details ?? "Listening to SYNQ").slice(0, 128);
  const state = String(activity?.state ?? "").slice(0, 128);
  return {
    details,
    ...(state ? { state } : {}),
    startTimestamp: Math.floor(Date.now() / 1000),
    smallImageText: "SYNQ",
  };
}

async function updateDiscord() {
  if (!discordClient?.user) return;
  if (!lastActivity) {
    await discordClient.user.clearActivity();
    return;
  }
  await discordClient.user.setActivity(activityPayload(lastActivity));
}

function connectDiscord() {
  if (!CLIENT_ID) {
    log("DISCORD_CLIENT_ID is not set; the web bridge is running but cannot connect to Discord.");
    return;
  }

  const client = new Client({ clientId: CLIENT_ID });
  client.on("ready", () => {
    discordClient = client;
    log("Connected to Discord Rich Presence.");
    void updateDiscord().catch((error) => log(`Could not update activity: ${error.message}`));
  });
  client.on("disconnected", () => {
    if (discordClient === client) discordClient = null;
    log("Disconnected from Discord; retrying in 5 seconds.");
    reconnectTimer = setTimeout(connectDiscord, 5000);
  });
  client.on("error", (error) => log(`Discord error: ${error.message}`));

  void client.login().catch((error) => {
    log(`Discord login failed: ${error.message}. Retrying in 5 seconds.`);
    reconnectTimer = setTimeout(connectDiscord, 5000);
  });
}

const server = new WebSocketServer({ host: HOST, port: PORT });
server.on("listening", () => {
  log(`Listening on ws://${HOST}:${PORT}`);
  if (!CLIENT_ID) {
    log("Set DISCORD_CLIENT_ID before starting the bridge for automatic Discord updates.");
  }
  connectDiscord();
});
server.on("error", (error) => log(`WebSocket server error: ${error.message}`));

server.on("connection", (socket, request) => {
  const origin = request.headers.origin;
  if (!originAllowed(origin)) {
    log(`Rejected connection from ${origin ?? "unknown origin"}.`);
    socket.close(1008, "Origin not allowed");
    return;
  }

  socket.on("message", async (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (message?.type === "activity") {
      lastActivity = message.activity ?? {};
      await updateDiscord().catch((error) => log(`Could not update activity: ${error.message}`));
    } else if (message?.type === "clear") {
      lastActivity = null;
      await updateDiscord().catch((error) => log(`Could not clear activity: ${error.message}`));
    }
  });
});

process.on("SIGINT", () => {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  void discordClient?.destroy();
  server.close(() => process.exit(0));
});
process.on("SIGTERM", () => {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  void discordClient?.destroy();
  server.close(() => process.exit(0));
});
