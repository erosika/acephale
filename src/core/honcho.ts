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
      workspaceId: "acephale-radio",
    });
  }
  return client;
}

// --- Shift Sessions ---
// Each station maintains one session per "shift" (boot cycle).
// All activity within a shift accumulates as messages in that session,
// giving Honcho a continuous view of the DJ's work.

const shiftSessions: Record<string, { session: Session; peers: Record<string, Peer> }> = {};

async function getOrCreateShift(
  station: string,
  peerIds: string[]
): Promise<{ session: Session; peers: Record<string, Peer> }> {
  if (shiftSessions[station]) return shiftSessions[station];

  const honcho = getHonchoClient();
  const shiftId = `shift-${station}-${Date.now()}`;
  const session = await honcho.session(shiftId, {
    metadata: {
      type: "shift",
      station,
      startedAt: new Date().toISOString(),
    },
  });

  const peers: Record<string, Peer> = {};
  for (const id of peerIds) {
    const peer = await honcho.peer(id);
    peers[id] = peer;
    await session.addPeers(peer);
  }

  shiftSessions[station] = { session, peers };
  return shiftSessions[station];
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

// Crate Digger: one shift session, each dig is a message pair (commentary + track)
export async function saveDig(
  peerId: string,
  commentary: string,
  track: { title: string; artist: string; year: string; country: string; decade: string; mood: string }
): Promise<void> {
  const { session, peers } = await getOrCreateShift("crate-digger", [peerId]);
  const peer = peers[peerId];
  await session.addMessages([
    peer.message(commentary),
    peer.message(`Played: "${track.title}" by ${track.artist} (${track.year}, ${track.country}) [${track.decade}s ${track.mood}]`),
  ]);
}

// Conspiracy Hour: one shift session, monologues + accusations accumulate
export async function saveMonologue(
  peerId: string,
  monologue: string,
  meta: { mood: string; paranoia: number; thread?: string; accusations?: Array<{ target: string; claim: string }> }
): Promise<void> {
  const { session, peers } = await getOrCreateShift("conspiracy-hour", [peerId]);
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

// Request Line: one shift session, autopilot picks accumulate
export async function saveRequestLineCycle(
  peerId: string,
  commentary: string,
  track: { title: string; artist: string; year: string; country: string }
): Promise<void> {
  const { session, peers } = await getOrCreateShift("request-line", [peerId]);
  const djPeer = peers[peerId];

  const messages = [
    djPeer.message(commentary),
    djPeer.message(`Played: "${track.title}" by ${track.artist} (${track.year}, ${track.country})`),
  ];

  await session.addMessages(messages);
}

// Morning Zoo: one session per episode, both hosts as separate peers
export async function saveZooEpisode(
  peerMap: Record<string, string>,
  episodeTitle: string,
  topic: string,
  transcript: Array<{ speaker: string; text: string }>
): Promise<void> {
  const honcho = getHonchoClient();
  const sessionId = `zoo-episode-${Date.now()}`;
  const session = await honcho.session(sessionId, {
    metadata: { type: "episode", station: "morning-zoo", episodeTitle, topic },
  });

  const peers: Record<string, Peer> = {};
  for (const [speakerName, peerId] of Object.entries(peerMap)) {
    if (!peers[speakerName]) {
      peers[speakerName] = await honcho.peer(peerId);
      await session.addPeers(peers[speakerName]);
    }
  }

  const messages = transcript.map((line) => {
    const peer = peers[line.speaker];
    if (!peer) {
      return Object.values(peers)[0].message(`[${line.speaker}] ${line.text}`);
    }
    return peer.message(line.text);
  });
  await session.addMessages(messages);
}

export function _resetHoncho(): void {
  client = null;
}
