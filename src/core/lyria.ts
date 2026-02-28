// Lyria RealTime WebSocket client
// Real-time streaming music generation for:
// - Live transitions between tracks (Crate Digger bridging genres)
// - Custom tracks from descriptions (Request Line generating on the fly)
// - Ambient/noise for atmosphere (Conspiracy Hour backdrop, static channel)
// - Jingles and station IDs (AI-generated, evolving over time)

// --- Types ---

export type WeightedPrompt = {
  text: string;
  weight: number;
};

export type LyriaSession = {
  ws: WebSocket | null;
  sessionId: string;
  startedAt: number;
  promptHistory: WeightedPrompt[];
};

export type LyriaConfig = {
  sampleRate: 48000;
  channels: 2;
  format: "pcm_f32le";
  maxSessionDurationMs: 600_000; // 10 min hard limit
};

export const DEFAULT_LYRIA_CONFIG: LyriaConfig = {
  sampleRate: 48000,
  channels: 2,
  format: "pcm_f32le",
  maxSessionDurationMs: 600_000,
};

export type LyriaUseCase =
  | "transition"     // bridge between two different tracks/genres
  | "custom_track"   // generate from listener description
  | "ambient"        // background atmosphere
  | "jingle"         // station ID / bumper
  | "noise";         // static channel fill

// --- Session Management ---
// TODO: Implement Lyria RealTime client
// - WebSocket connection to Lyria endpoint
// - Send WeightedPrompt[] to steer generation
// - Receive 48kHz PCM audio chunks
// - Auto-reconnect on 10-minute session limit
// - Pipe PCM output to liquidsoap via stdin or temp file
// - Handle backpressure from liquidsoap
// - Use case routing: different prompt strategies per use case

export function buildTransitionPrompt(
  fromGenre: string,
  toGenre: string,
  durationSeconds: number = 10
): WeightedPrompt[] {
  return [
    { text: `smooth musical transition from ${fromGenre}`, weight: 0.5 },
    { text: `evolving into ${toGenre}`, weight: 0.5 },
    { text: `${durationSeconds} second instrumental bridge`, weight: 0.3 },
  ];
}

export function buildAmbientPrompt(mood: string): WeightedPrompt[] {
  return [
    { text: `atmospheric ${mood} ambient background`, weight: 0.7 },
    { text: "subtle, non-intrusive, low volume", weight: 0.3 },
  ];
}

export function buildCustomTrackPrompt(description: string): WeightedPrompt[] {
  return [
    { text: description, weight: 0.8 },
    { text: "high quality, radio-ready production", weight: 0.2 },
  ];
}
