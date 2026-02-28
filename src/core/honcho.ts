import { Honcho } from "@honcho-ai/sdk";
import type { Peer, Session } from "@honcho-ai/sdk";
import { getEnv } from "./config.js";

// --- Client Singleton ---

let client: Honcho | null = null;

export function getHonchoClient(): Honcho {
  if (!client) {
    client = new Honcho({
      apiKey: getEnv("HONCHO_API_KEY"),
      baseURL: getEnv("HONCHO_BASE_URL", "https://api.honcho.dev/v3"),
      workspaceId: "acephale",
    });
  }
  return client;
}

// --- Channel Sessions ---
// Each channel has exactly one persistent session. Session names are stable
// (no timestamps, no boot-cycle IDs) so every mic break, dig, monologue,
// and episode accumulates in the same long-running session.

const channels: Record<string, { session: Session; peers: Record<string, Peer> }> = {};

async function getChannel(
  channel: string,
  peerIds: string[]
): Promise<{ session: Session; peers: Record<string, Peer> }> {
  if (channels[channel]) return channels[channel];

  const honcho = getHonchoClient();
  const session = await honcho.session(channel);

  const peers: Record<string, Peer> = {};
  for (const id of peerIds) {
    const peer = await honcho.peer(id);
    peers[id] = peer;
    await session.addPeers(peer);
  }

  channels[channel] = { session, peers };
  return channels[channel];
}

// --- Agent Memory ---
// Uses peer.chat() for contextual recall instead of raw card.

export async function getAgentMemory(
  agentUserId: string,
  context?: string
): Promise<string[]> {
  const honcho = getHonchoClient();
  const peer = await honcho.peer(agentUserId);

  // Try contextual query first, fall back to card
  if (context) {
    try {
      const response = await peer.chat(context);
      if (response) return [response];
    } catch {
      // Fall through to card
    }
  }

  const card = await peer.getCard();
  return card || [];
}

// --- Station-Specific Memory ---

// Crate Digger: each dig is a message pair (commentary + track)
export async function saveDig(
  peerId: string,
  commentary: string,
  track: { title: string; artist: string; year: string; country: string; decade: string; mood: string }
): Promise<void> {
  const { session, peers } = await getChannel("crate-digger", [peerId]);
  const peer = peers[peerId];
  await session.addMessages([
    peer.message(commentary),
    peer.message(`Played: "${track.title}" by ${track.artist} (${track.year}, ${track.country}) [${track.decade}s ${track.mood}]`),
  ]);
}

// Conspiracy Hour: monologues + accusations accumulate
export async function saveMonologue(
  peerId: string,
  monologue: string,
  meta: { mood: string; paranoia: number; thread?: string; accusations?: Array<{ target: string; claim: string }> }
): Promise<void> {
  const { session, peers } = await getChannel("conspiracy-hour", [peerId]);
  const peer = peers[peerId];

  const messages = [
    peer.message(monologue, {
      metadata: { mood: meta.mood, paranoia: meta.paranoia, thread: meta.thread },
    }),
  ];

  if (meta.accusations?.length) {
    for (const acc of meta.accusations) {
      messages.push(peer.message(`I suspect ${acc.target}: ${acc.claim}`));
    }
  }

  await session.addMessages(messages);
}

// Request Line: autopilot picks accumulate
export async function saveRequestLineCycle(
  peerId: string,
  commentary: string,
  track: { title: string; artist: string; year: string; country: string }
): Promise<void> {
  const { session, peers } = await getChannel("request-line", [peerId]);
  const djPeer = peers[peerId];

  const messages = [
    djPeer.message(commentary),
    djPeer.message(`Played: "${track.title}" by ${track.artist} (${track.year}, ${track.country})`),
  ];

  await session.addMessages(messages);
}

// Morning Zoo: both hosts share the same persistent session
export async function saveZooEpisode(
  peerMap: Record<string, string>,
  episodeTitle: string,
  topic: string,
  transcript: Array<{ speaker: string; text: string }>
): Promise<void> {
  const allPeerIds = [...new Set(Object.values(peerMap))];
  const { session, peers: channelPeers } = await getChannel("morning-zoo", allPeerIds);

  // Build speaker→peer lookup from the channel's resolved peers
  const speakerPeers: Record<string, Peer> = {};
  for (const [speakerName, peerId] of Object.entries(peerMap)) {
    speakerPeers[speakerName] = channelPeers[peerId];
  }

  const messages = transcript.map((line) => {
    const peer = speakerPeers[line.speaker];
    if (!peer) {
      return Object.values(speakerPeers)[0].message(`[${line.speaker}] ${line.text}`);
    }
    return peer.message(line.text);
  });
  await session.addMessages(messages);
}

export function _resetHoncho(): void {
  client = null;
  for (const key of Object.keys(channels)) delete channels[key];
}
