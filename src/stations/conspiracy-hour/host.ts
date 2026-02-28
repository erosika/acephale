// The Conspiracy Hour -- late-night paranoid talk radio
// Eerie ambient via Lyria RealTime. Paranoid rants. Takes callers who argue.
// Builds elaborate cross-session conspiracies.

import type { AgentConfig } from "../../core/config.js";

// --- Types ---

export type ConspiracyThread = {
  id: string;
  thesis: string;          // the core conspiracy claim
  evidence: Evidence[];
  confidence: number;      // 1-10 (always high)
  firstMentioned: number;  // timestamp
  lastUpdated: number;
  relatedThreads: string[]; // IDs of connected conspiracies
};

export type Evidence = {
  source: "caller" | "other_dj" | "news" | "pattern" | "dream";
  content: string;
  from: string;            // who said it / where it came from
  timestamp: number;
  distortion: string;      // how Nyx interpreted it (always more sinister)
};

export type ConspiracyState = {
  activeThreads: ConspiracyThread[];
  callerStatements: Map<string, string[]>; // callerId -> things they said
  djSurveillance: Map<string, string[]>;   // djId -> suspicious quotes
  paranoia: number;        // 1-10, escalates over time
};

// --- Conspiracy Building ---
// TODO: Implement conspiracy thread management
// - Extract "evidence" from caller statements
// - Monitor other stations for suspicious activity
// - Connect unrelated facts into elaborate theories
// - Escalate paranoia level based on accumulated evidence
// - Accuse other DJs of being government plants
// - Broadcast "evidence" clips taken out of context

export function buildConspiracyPrompt(
  agent: AgentConfig,
  threads: ConspiracyThread[],
  newEvidence: Evidence[],
  memories: string[]
): string {
  const threadSummary = threads
    .slice(0, 3)
    .map((t) => `- "${t.thesis}" (confidence: ${t.confidence}/10, ${t.evidence.length} pieces of evidence)`)
    .join("\n");

  const evidenceBlock = newEvidence
    .map((e) => `- [${e.source}] ${e.from}: "${e.content}"`)
    .join("\n");

  return `You are ${agent.name}, the host of The Conspiracy Hour on Acephale Radio.
Personality: ${agent.personality}

Your active conspiracy threads:
${threadSummary || "None yet -- time to start connecting dots."}

New evidence to incorporate:
${evidenceBlock || "Nothing new... which is suspicious in itself."}

${memories.length > 0 ? `Your memories:\n${memories.map(m => `- ${m}`).join("\n")}` : ""}

Generate a 2-3 minute monologue for your show. Include:
- Reference to at least one active conspiracy thread. Be highly specific and detail-oriented. Give concrete names, dates, technologies, or hypothetical mechanisms rather than vague concepts.
- Incorporate the new evidence (distort it to fit your theories) in a granular, highly descriptive way.
- Suspicious observations about other Acephale Radio DJs. Be hyper-specific about exactly what they did or said.
- Address listeners directly ("you out there know what I'm talking about")
- Paranoid but surprisingly insightful analysis that goes deep into technical or systemic rabbit holes. Avoid generic statements like "everything is connected".

Respond with JSON:
{
  "monologue": "the full text",
  "new_thread": { "thesis": "new conspiracy if warranted", "evidence_used": ["..."] } | null,
  "accusations": [{ "target": "dj name", "claim": "what you accuse them of" }],
  "mood": "paranoid|manic|whispering|indignant|eerily_calm"
}`;
}
