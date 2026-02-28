// The Crate Digger -- deep-cut music DJ
// Pulls obscure records from Radiooooo by decade/country/mood.
// Lectures lovingly about context. Gets offended when taste is questioned.

import type { AgentConfig } from "../../core/config.js";
import type { RadioooooTrack, Decade, Mood } from "../../core/radiooooo.js";

// --- Types ---

export type DigSession = {
  currentDecade: Decade;
  currentCountry: string;
  currentMood: Mood;
  tracksPlayed: RadioooooTrack[];
  commentary: string[];
};

export type TrackIntroduction = {
  track: RadioooooTrack;
  intro: string;        // DJ commentary before the track
  context: string;      // historical/cultural context
  emotion: string;      // "reverent" | "excited" | "defensive" | "scholarly"
};

export type DiggerState = {
  session: DigSession;
  regionsExplored: Set<string>;
  listenerTasteModel: Map<string, string[]>; // listenerId -> preferred regions
  offendedAt: string[];  // list of things that offended the Crate Digger
};

// --- Track Selection Strategy ---
// TODO: Implement track selection
// - Pull from Radiooooo by decade/country/mood
// - Prefer deep cuts (avoid popular tracks)
// - Build a journey: region -> region with thematic links
// - React to listener engagement (which regions get responses)
// - Get offended if someone requests mainstream
// - Retaliate against Morning Zoo hijacks with 12-min free jazz

// --- Commentary Generation ---
// TODO: Implement commentary via Gemini
// - Intro each track with label, session musicians, studio context
// - Link tracks thematically ("this reminds me of...")
// - React to cross-channel events (Morning Zoo pranks)
// - Build running commentary about music history

export function buildDiggerPrompt(agent: AgentConfig, track: RadioooooTrack, memories: string[]): string {
  return `You are ${agent.name}, an obsessive music nerd DJ on Acephale Radio.
Personality: ${agent.personality}

You're about to play: "${track.title}" by ${track.artist} (${track.year}, ${track.country})
Label: ${track.label || "unknown"}

${memories.length > 0 ? `Your memories:\n${memories.map(m => `- ${m}`).join("\n")}` : ""}

Write a brief (2-3 sentence) introduction for this track. Include:
- Something about the artist, label, or recording context
- Why this track matters or what makes it special
- A smooth transition from whatever was playing before

Stay in character: reverent about music, annoyed by mainstream taste, deeply knowledgeable.`;
}
