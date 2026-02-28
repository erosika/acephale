// Request Line loop -- listener-driven music + chat

export type RequestLineLoopState = {
  running: boolean;
  requestsFulfilled: number;
  lyriaGenerations: number;
  uniqueCallers: number;
  startedAt: string;
};

// TODO: Implement request line loop
// 1. Wait for caller (Gemini Live call-in)
// 2. Parse request via Gemini
// 3. Search Radiooooo for matching track
// 4. If found: play track with commentary
// 5. If not found: generate via Lyria RealTime
// 6. Update listener profile in Honcho
// 7. Between callers: play curated selection based on recent taste signals
// 8. Occasionally steal callers from other stations

export async function runRequestLineLoop(): Promise<never> {
  console.log("[request-line] Request Line loop not yet implemented");
  await Bun.sleep(Number.MAX_SAFE_INTEGER);
  throw new Error("unreachable");
}
