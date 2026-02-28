import { Socket } from "node:net";
import { getEnv } from "./config.js";
import type { StationId } from "./config.js";

// --- Types ---

export type Channel = Exclude<StationId, "static">;

type ChannelPorts = Record<Channel, number>;

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

export async function queueTrack(channel: Channel, filepath: string): Promise<string> {
  const ports = getChannelPorts();
  return sendTelnet(ports[channel], `request.push ${filepath}`);
}

export async function getStatus(channel: Channel): Promise<string> {
  const ports = getChannelPorts();
  return sendTelnet(ports[channel], "request.alive");
}

export async function skip(channel: Channel): Promise<string> {
  const ports = getChannelPorts();
  return sendTelnet(ports[channel], "source.skip");
}

export async function getQueue(channel: Channel): Promise<string[]> {
  const ports = getChannelPorts();
  const response = await sendTelnet(ports[channel], "request.queue");
  return response.split("\n").filter(Boolean);
}
