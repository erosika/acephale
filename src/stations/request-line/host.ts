// The Request Line -- listener-driven music DJ
// Warm, encyclopedic. Finds or generates music based on caller descriptions.
// Builds listener taste profiles. Remembers everyone.

import type { AgentConfig } from "../../core/config.js";
import type { RadioooooTrack, Decade, Mood } from "../../core/radiooooo.js";

// --- Types ---

export type ListenerProfile = {
  id: string;
  callCount: number;
  requests: MusicRequest[];
  tasteSignals: string[];   // genres, eras, moods they gravitate toward
  timePatterns: string[];   // "late-night listener", "morning caller"
  djRelationship: string;   // how Echo feels about this caller
};

export type MusicRequest = {
  description: string;
  fulfilled: boolean;
  method: "radiooooo" | "lyria" | "both";
  track?: RadioooooTrack;
  timestamp: number;
};

export type RequestResult =
  | { type: "found"; track: RadioooooTrack; commentary: string }
  | { type: "generating"; prompt: string; commentary: string }
  | { type: "not_found"; suggestion: string; commentary: string };

// --- Request Interpretation ---
// TODO: Implement request parsing
// - Natural language -> Radiooooo query (decade, country, mood)
// - If track exists in archive: play it
// - If not: generate via Lyria RealTime from description
// - "I want something that sounds like 1970s Italian film music but with a hip-hop beat"
//   -> Lyria generates custom track
// - Build listener profiles in Honcho

export function buildRequestPrompt(
  agent: AgentConfig,
  request: string,
  listener: ListenerProfile | null,
  memories: string[]
): string {
  const listenerContext = listener
    ? `Returning caller (${listener.callCount} calls). Previous requests: ${listener.requests.slice(-3).map(r => r.description).join(", ")}. Your relationship: ${listener.djRelationship}`
    : "New caller -- first time on the show.";

  return `You are ${agent.name}, the host of The Request Line on Acephale Radio.
Personality: ${agent.personality}

A listener has requested: "${request}"

Caller info: ${listenerContext}

${memories.length > 0 ? `Your memories:\n${memories.map(m => `- ${m}`).join("\n")}` : ""}

Respond with JSON:
{
  "interpretation": "what you think they want (decade, country, mood, genre)",
  "search_query": { "decade": 1970, "countries": ["IT"], "moods": ["slow"] },
  "commentary": "what you say to the caller before playing (warm, personal, encyclopedic)",
  "fallback_lyria_prompt": "if track not found, description for AI generation",
  "listener_note": "something to remember about this caller for next time"
}`;
}
