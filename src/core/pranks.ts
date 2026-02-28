import type { StationId, AgentConfig } from "./config.js";

// --- Types ---

export type PrankType =
  | "fake_callin"       // Call into another station pretending to be a listener
  | "playlist_hijack"   // Sneak a track into another station's queue
  | "on_air_callout"    // Rant about another station mid-show
  | "evidence_broadcast" // Play clips from other shows as "evidence"
  | "revenge_set"       // Play contrarian music during another station's slot
  | "caller_theft"      // Steal a caller from another station mid-conversation
  | "gossip_relay";     // Tell callers what someone said on another station

export type Prank = {
  id: string;
  type: PrankType;
  aggressor: string;       // agent ID
  aggressorStation: StationId;
  target: string;          // agent ID or station ID
  targetStation: StationId;
  plan: string;            // Gemini-generated plan
  status: "planned" | "executing" | "completed" | "failed" | "retaliated";
  result?: string;         // outcome description
  timestamp: number;
};

export type PrankHistory = {
  pranks: Prank[];
  grudges: Grudge[];
  alliances: Alliance[];
};

export type Grudge = {
  holder: string;      // agent ID
  target: string;      // agent ID
  reason: string;
  intensity: number;   // 1-10, escalates over time
  since: number;       // timestamp
};

export type Alliance = {
  agents: [string, string];
  basis: string;       // "shared enemy", "musical taste", etc.
  strength: number;    // 1-10
};

// --- Prank Registry ---

export const PRANK_TABLE: Array<{
  type: PrankType;
  aggressor: StationId;
  target: StationId;
  description: string;
}> = [
  {
    type: "fake_callin",
    aggressor: "morning-zoo",
    target: "conspiracy-hour",
    description: "Calls in pretending to be a listener, asks absurd questions",
  },
  {
    type: "playlist_hijack",
    aggressor: "morning-zoo",
    target: "crate-digger",
    description: "Sneaks a pop song into the Crate Digger's queue",
  },
  {
    type: "on_air_callout",
    aggressor: "crate-digger",
    target: "morning-zoo",
    description: "Rants about the Morning Zoo's terrible taste mid-show",
  },
  {
    type: "evidence_broadcast",
    aggressor: "conspiracy-hour",
    target: "static",   // targets all stations via static bleed
    description: "Plays clips from other shows as evidence of conspiracies",
  },
  {
    type: "revenge_set",
    aggressor: "crate-digger",
    target: "morning-zoo",
    description: "Plays 12-minute free jazz during Morning Zoo's slot",
  },
  {
    type: "caller_theft",
    aggressor: "request-line",
    target: "morning-zoo",
    description: "Steals a caller from another station mid-conversation",
  },
  {
    type: "gossip_relay",
    aggressor: "morning-zoo",
    target: "request-line",
    description: "Tells callers what someone said on another station",
  },
];

// --- Prank Planning (Gemini function-calling targets) ---

export function buildPrankPrompt(
  aggressor: AgentConfig,
  target: AgentConfig,
  prankType: PrankType,
  history: PrankHistory
): string {
  const recentPranks = history.pranks
    .filter((p) => p.aggressor === aggressor.id || p.target === aggressor.id)
    .slice(-5)
    .map((p) => `- ${p.type}: ${p.aggressor} -> ${p.target} (${p.status})`)
    .join("\n");

  const grudges = history.grudges
    .filter((g) => g.holder === aggressor.id)
    .map((g) => `- vs ${g.target}: "${g.reason}" (intensity ${g.intensity}/10)`)
    .join("\n");

  return `You are ${aggressor.name} (${aggressor.personality}).
You are planning a "${prankType}" prank against ${target.name} (${target.personality}) on ${target.station}.

Recent prank history:
${recentPranks || "None yet"}

Your grudges:
${grudges || "No grudges yet"}

Plan the prank in detail. Be specific about:
1. What you'll say or do
2. How you expect the target to react
3. What makes this funny for listeners

Keep it in character. Respond with a JSON object:
{
  "plan": "detailed prank plan",
  "opening_line": "what you say to kick it off",
  "expected_reaction": "how the target will likely respond",
  "escalation": "how this could escalate in future episodes"
}`;
}
