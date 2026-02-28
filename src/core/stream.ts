import { Socket } from "node:net";
import { resolve } from "node:path";
import { getEnv } from "./config.js";
import type { StationId } from "./config.js";
import type { TrackMetadata } from "./audio.js";

// --- Types ---

export type Channel = Exclude<StationId, "static">;

type ChannelPorts = Record<Channel, number>;

// Liquidsoap queue IDs -- must match the id= in each .liq config
const QUEUE_IDS: Record<Channel, string> = {
  "morning-zoo": "zoo_queue",
  "crate-digger": "crate_queue",
  "conspiracy-hour": "conspiracy_queue",
  "request-line": "request_queue",
};

// --- Path Translation ---
// Tracks are generated on the host in .tmp/, which is mounted as /tmp-tracks
// inside the Liquidsoap containers. Translate host paths accordingly.

const PROJECT_ROOT = resolve(import.meta.dir, "..", "..");
const TMP_HOST = resolve(PROJECT_ROOT, ".tmp");
const TMP_CONTAINER = "/tmp-tracks";
const TRACKS_HOST = resolve(PROJECT_ROOT, "tracks");
const TRACKS_CONTAINER = "/tracks";
const EPISODES_HOST = resolve(PROJECT_ROOT, "episodes");
const EPISODES_CONTAINER = "/episodes";

function hostToContainerPath(hostPath: string): string {
  const abs = resolve(hostPath);
  if (abs.startsWith(TMP_HOST)) {
    return abs.replace(TMP_HOST, TMP_CONTAINER);
  }
  if (abs.startsWith(TRACKS_HOST)) {
    return abs.replace(TRACKS_HOST, TRACKS_CONTAINER);
  }
  if (abs.startsWith(EPISODES_HOST)) {
    return abs.replace(EPISODES_HOST, EPISODES_CONTAINER);
  }
  // If we can't translate, return as-is (will fail in container but at least logs the path)
  console.warn(`[stream] WARNING: cannot translate host path to container path: ${abs}`);
  return abs;
}

// --- Telnet Interface ---

function getChannelPorts(): ChannelPorts {
  return {
    "morning-zoo": parseInt(getEnv("LIQUIDSOAP_TELNET_PORT_ZOO", "1234"), 10),
    "crate-digger": parseInt(getEnv("LIQUIDSOAP_TELNET_PORT_CRATE", "1235"), 10),
    "conspiracy-hour": parseInt(getEnv("LIQUIDSOAP_TELNET_PORT_CONSPIRACY", "1236"), 10),
    "request-line": parseInt(getEnv("LIQUIDSOAP_TELNET_PORT_REQUEST", "1237"), 10),
  };
}

async function sendTelnet(port: number, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    let response = "";
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Telnet timeout on port ${port}`));
    }, 5000);

    socket.connect(port, "localhost", () => {
      socket.write(command + "\n");
      socket.write("quit\n");
    });

    socket.on("data", (data) => {
      response += data.toString();
    });

    socket.on("end", () => {
      clearTimeout(timeout);
      resolve(response.trim());
    });

    socket.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// --- Public API ---

export async function queueTrack(
  channel: Channel | "static",
  filepath: string,
  metadata?: TrackMetadata
): Promise<string> {
  // If static, hijack the request line temporarily since they share a port for now
  const targetChannel = channel === "static" ? "request-line" : channel;
  const ports = getChannelPorts();
  const queueId = QUEUE_IDS[targetChannel];
  const containerPath = hostToContainerPath(filepath);
  const uri = metadata ? formatAnnotate(containerPath, metadata) : containerPath;
  console.log(`[stream] ${queueId}.push ${uri}`);
  return sendTelnet(ports[targetChannel], `${queueId}.push ${uri}`);
}

function formatAnnotate(filepath: string, meta: TrackMetadata): string {
  const pairs: string[] = [];
  if (meta.title) pairs.push(`title="${escapeAnnotate(meta.title)}"`);
  if (meta.artist) pairs.push(`artist="${escapeAnnotate(meta.artist)}"`);
  if (meta.album) pairs.push(`album="${escapeAnnotate(meta.album)}"`);
  if (meta.year) pairs.push(`year="${escapeAnnotate(meta.year)}"`);
  if (meta.genre) pairs.push(`genre="${escapeAnnotate(meta.genre)}"`);
  if (meta.comment) pairs.push(`comment="${escapeAnnotate(meta.comment)}"`);
  if (pairs.length === 0) return filepath;
  return `annotate:${pairs.join(",")}:${filepath}`;
}

function escapeAnnotate(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export async function getStatus(channel: Channel): Promise<string> {
  const ports = getChannelPorts();
  const queueId = QUEUE_IDS[channel];
  return sendTelnet(ports[channel], `${queueId}.queue`);
}

export async function skip(channel: Channel): Promise<string> {
  const ports = getChannelPorts();
  const queueId = QUEUE_IDS[channel];
  return sendTelnet(ports[channel], `${queueId}.skip`);
}

export async function getQueue(channel: Channel): Promise<string[]> {
  const ports = getChannelPorts();
  const queueId = QUEUE_IDS[channel];
  const response = await sendTelnet(ports[channel], `${queueId}.queue`);
  return response.split("\n").filter(Boolean);
}
