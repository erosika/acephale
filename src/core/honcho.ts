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

// --- Agent Memory ---

export async function getAgentMemory(agentUserId: string): Promise<string[]> {
  const honcho = getHonchoClient();
  const peer = await honcho.peer(agentUserId);
  const card = await peer.getCard();
  return card || [];
}

export async function startEpisodeSession(
  agentUserId: string,
  metadata: Record<string, string>
): Promise<{ peer: Peer; session: Session }> {
  const honcho = getHonchoClient();
  const peer = await honcho.peer(agentUserId);
  const sessionId = `episode-${Date.now()}`;
  const session = await honcho.session(sessionId, { metadata });
  await session.addPeers(peer);
  return { peer, session };
}

export async function saveEpisodeMemory(
  peer: Peer,
  session: Session,
  transcript: Array<{ speaker: string; text: string }>
): Promise<void> {
  const messages = transcript.map((line) =>
    peer.message(`[${line.speaker}] ${line.text}`)
  );
  await session.addMessages(messages);
}

export function _resetHoncho(): void {
  client = null;
}
