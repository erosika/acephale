// Static -- the space between stations
// Not a show. Audio fragments from adjacent channels bleed in.
// Sometimes a DJ intentionally broadcasts here (usually Conspiracy Hour).
// Lyria-generated noise/ambient fills.
// Easter egg: pirate station appears occasionally.

import type { StationId } from "../../core/config.js";

// --- Types ---

export type StaticSource =
  | { type: "noise"; generator: "lyria" | "synthesized" }
  | { type: "bleed"; from: StationId; gain: number }  // 0.0-1.0
  | { type: "pirate"; agent: string; content: string }
  | { type: "leak"; from: StationId; intentional: boolean; agent: string };

export type StaticMix = {
  sources: StaticSource[];
  timestamp: number;
};

export type PirateStation = {
  id: string;
  name: string;
  personality: string;
  frequency: number;       // how often it appears (0.0-1.0)
  lastAppeared: number;
  content: string;         // what it broadcasts
};

// --- Static Generation ---
// TODO: Implement static channel
// - Base layer: Lyria-generated noise/ambient
// - Bleed from adjacent channels based on dial position
// - Conspiracy Hour intentional leaks
// - Pirate station easter egg (unannounced agent, rare)
// - Crossfade: smooth transition between static and real stations
// - The static should feel alive -- not dead air, but haunted frequencies
