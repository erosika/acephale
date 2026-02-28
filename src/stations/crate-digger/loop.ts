// Crate Digger loop -- continuous music + commentary

import type { Decade, Mood } from "../../core/radiooooo.js";

export type CrateDiggerLoopState = {
  running: boolean;
  currentDecade: Decade;
  currentMood: Mood;
  tracksPlayed: number;
  regionsVisited: string[];
  startedAt: string;
};

// TODO: Implement continuous crate-digging loop
// 1. Select decade + country + mood (from schedule or drift)
// 2. Fetch track from Radiooooo
// 3. Generate commentary via Gemini
// 4. TTS render commentary
// 5. Queue: commentary -> track -> silence -> repeat
// 6. Every N tracks, do a "deep dive" (extended commentary about a region)
// 7. React to cross-channel signals (pranks, caller requests)
// 8. Save track history + commentary to Honcho
// 9. Use Lyria RealTime for live genre-bridging transitions

export async function runCrateDiggerLoop(): Promise<never> {
  console.log("[crate-digger] Crate Digger loop not yet implemented");
  await Bun.sleep(Number.MAX_SAFE_INTEGER);
  throw new Error("unreachable");
}
