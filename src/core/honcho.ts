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
  const honcho = getHonchoClient();

  if (!channels[channel]) {
    const session = await honcho.session(channel);
    channels[channel] = { session, peers: {} };
  }

  const { session, peers } = channels[channel];

  for (const id of peerIds) {
    if (!peers[id]) {
      const peer = await honcho.peer(id);
      peers[id] = peer;
      await session.addPeers(peer);
    }
  }

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

// The Generator (Static): ambient generation records
export async function saveGeneratorCycle(
  peerId: string,
  commentary: string,
  trackTitle: string,
  trackPrompt: string
): Promise<void> {
  const { session, peers } = await getChannel("static", [peerId]);
  const peer = peers[peerId];

  await session.addMessages([
    peer.message(commentary),
    peer.message(`Synthesized Track: "${trackTitle}" (Prompt: ${trackPrompt})`)
  ]);
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

// Callers: Add listener calls to a station's session so the DJ remembers them
export async function saveCall(
  station: string,
  callerId: string, // we should use the caller's distinct ID so they are their own peer
  text: string
): Promise<void> {
  const { session, peers } = await getChannel(station, [callerId]);
  const peer = peers[callerId];
  await session.addMessages([
    peer.message(`[Listener Call]: "${text}"`, { metadata: { isCall: true } })
  ]);
}

export function _resetHoncho(): void {
  client = null;
  for (const key of Object.keys(channels)) delete channels[key];
}
