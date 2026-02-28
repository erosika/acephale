// Lyria RealTime client -- file-based capture
// Opens a session via @google/genai SDK, collects PCM chunks for a
// target duration, writes WAV, converts to MP3, returns path for
// queue to Liquidsoap.
//
// Uses GEMINI_AI_STUDIO_KEY (separate from the models API key)
// because Lyria v1alpha requires an AI Studio-provisioned key.

import { GoogleGenAI } from "@google/genai";
import { join } from "node:path";
import { writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { getEnv } from "./config.js";
import { buildWavHeader, convertToMp3 } from "./audio.js";

// --- Types ---

export type WeightedPrompt = {
  text: string;
  weight: number;
};

export type LyriaGenerationConfig = {
  bpm?: number;             // 60-200
  density?: number;         // 0.0-1.0
  brightness?: number;      // 0.0-1.0
  scale?: string;           // e.g. "C_MAJOR_A_MINOR"
  temperature?: number;     // 0.0-3.0, default 1.1
  guidance?: number;        // 0.0-6.0, default 4.0
  musicGenerationMode?: "QUALITY" | "DIVERSITY" | "VOCALIZATION";
};

export type LyriaTrackResult = {
  mp3Path: string;
  durationMs: number;
};

// --- Singleton Client ---

let client: GoogleGenAI | null = null;

function getLyriaClient(): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({
      apiKey: getEnv("GEMINI_AI_STUDIO_KEY"),
      apiVersion: "v1alpha",
    });
  }
  return client;
}

// --- PCM Format ---

// Lyria outputs audio/l16;rate=48000;channels=2
// SDK decodes L16 to native little-endian 16-bit PCM
const SAMPLE_RATE = 48000;
const NUM_CHANNELS = 2;
const BITS_PER_SAMPLE = 16;
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8;
const BYTES_PER_SECOND = SAMPLE_RATE * NUM_CHANNELS * BYTES_PER_SAMPLE;

// --- Prompt Builders ---

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

// --- Main Generation Function ---

export async function generateLyriaTrack(opts: {
  prompts: WeightedPrompt[];
  durationSeconds: number;
  config?: LyriaGenerationConfig;
}): Promise<LyriaTrackResult> {
  const { prompts, durationSeconds, config } = opts;
  const ai = getLyriaClient();

  const tmpDir = join(import.meta.dir, "..", "..", ".tmp");
  mkdirSync(tmpDir, { recursive: true });
  const timestamp = Date.now();
  const wavPath = join(tmpDir, `lyria-${timestamp}.wav`);
  const mp3Path = join(tmpDir, `lyria-${timestamp}.mp3`);

  const targetBytes = durationSeconds * BYTES_PER_SECOND;
  const chunks: Buffer[] = [];
  let collectedBytes = 0;
  let sessionDone = false;
  let firstMessage = true;

  console.log(`[lyria] Generating ${durationSeconds}s track (${(targetBytes / 1024 / 1024).toFixed(1)}MB PCM)`);

  const session = await ai.live.music.connect({
    model: "models/lyria-realtime-exp",
    callbacks: {
      onmessage: (message: any) => {
        if (sessionDone) return;

        // Log structure of first message for diagnostics
        if (firstMessage) {
          firstMessage = false;
          const keys = Object.keys(message || {});
          console.log(`[lyria] First message keys: ${JSON.stringify(keys)}`);
        }

        // Extract audio -- try multiple access paths
        const audioChunks =
          message.serverContent?.audioChunks ||
          message.server_content?.audio_chunks ||
          message.audioChunks;

        if (!audioChunks) return;

        for (const chunk of audioChunks) {
          if (sessionDone) break;
          if (chunks.length === 0) {
            const data = chunk.data;
            console.log(`[lyria] First chunk data type:`, typeof data);
            if (data) console.log(`[lyria] Constructor:`, data.constructor.name);
            if (typeof data === "string") console.log(`[lyria] Starts with:`, data.slice(0, 50));
          }
          const data = chunk.data;
          const buf = typeof data === "string"
            ? Buffer.from(data, "base64")
            : Buffer.from(data);
          
          if (buf.length % 2 !== 0) {
            console.warn(`[lyria] WARNING: Chunk length is not even! Length: ${buf.length}`);
          }
          if (buf.length % 4 !== 0) {
            console.warn(`[lyria] WARNING: Chunk length is not multiple of 4 (stereo 16-bit)! Length: ${buf.length}`);
          }

          chunks.push(buf);
          collectedBytes += buf.length;
        }

        if (chunks.length === 1 || chunks.length % 20 === 0) {
          console.log(`[lyria] Chunks: ${chunks.length}, ${(collectedBytes / 1024).toFixed(0)}KB / ${(targetBytes / 1024).toFixed(0)}KB`);
        }
      },
      onerror: (error: any) => {
        console.error("[lyria] Session error:", error?.message || error);
      },
      onclose: (e: any) => {
        const detail = e?.reason || e?.code || "";
        if (detail) console.log(`[lyria] Session closed: ${detail}`);
        sessionDone = true;
      },
    },
  });

  try {
    // Build generation config -- only musical parameters,
    // skip audioFormat/sampleRateHz to avoid snake_case field name issues
    const musicConfig: Record<string, any> = {};
    if (config?.bpm != null) musicConfig.bpm = config.bpm;
    if (config?.density != null) musicConfig.density = config.density;
    if (config?.brightness != null) musicConfig.brightness = config.brightness;
    if (config?.scale != null) musicConfig.scale = config.scale;
    if (config?.temperature != null) musicConfig.temperature = config.temperature;
    if (config?.guidance != null) musicConfig.guidance = config.guidance;
    if (config?.musicGenerationMode != null) musicConfig.musicGenerationMode = config.musicGenerationMode;

    if (Object.keys(musicConfig).length > 0) {
      await session.setMusicGenerationConfig({ musicGenerationConfig: musicConfig });
    }

    await session.setWeightedPrompts({ weightedPrompts: prompts });
    await session.play();
    console.log("[lyria] Session started, waiting for audio...");

    // Poll until we have enough audio or session ends
    const startTime = Date.now();
    const timeoutMs = (durationSeconds + 60) * 1000;

    while (collectedBytes < targetBytes && !sessionDone) {
      if (Date.now() - startTime > timeoutMs) {
        console.warn(`[lyria] Timeout after ${Math.round((Date.now() - startTime) / 1000)}s`);
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  } finally {
    try {
      sessionDone = true;
      await session.stop();
    } catch {
      // Session may already be closed
    }
  }

  if (collectedBytes === 0) {
    throw new Error("[lyria] No audio data received from session");
  }

  console.log(`[lyria] Collected ${(collectedBytes / 1024 / 1024).toFixed(1)}MB in ${chunks.length} chunks`);

  // Trim to exact target length (or use all if we got less)
  const pcmData = Buffer.concat(chunks);
  const trimmed = pcmData.length > targetBytes
    ? pcmData.subarray(0, targetBytes)
    : pcmData;

  // Write WAV
  const wavHeader = buildWavHeader(trimmed.length);
  writeFileSync(wavPath, Buffer.concat([wavHeader, trimmed]));

  // Convert to MP3
  const comment = prompts.map((p) => p.text).join("; ");
  await convertToMp3(wavPath, mp3Path, {
    title: "Lyria Generation",
    artist: "Acephale Radio -- Lyria",
    comment: comment
  });

  // Clean up WAV
  try { unlinkSync(wavPath); } catch { /* ignore */ }

  const actualDurationMs = (trimmed.length / BYTES_PER_SECOND) * 1000;
  console.log(`[lyria] Output: ${mp3Path} (${(actualDurationMs / 1000).toFixed(1)}s)`);

  return { mp3Path, durationMs: actualDurationMs };
}

// --- Convenience Wrappers ---

export async function generateLyriaAmbient(
  mood: string,
  durationSeconds: number = 120
): Promise<LyriaTrackResult> {
  return generateLyriaTrack({
    prompts: buildAmbientPrompt(mood),
    durationSeconds,
    config: {
      temperature: 0.8,
      guidance: 3.0,
      density: 0.3,
      brightness: 0.3,
      musicGenerationMode: "QUALITY",
    },
  });
}

export async function generateLyriaTransition(
  fromGenre: string,
  toGenre: string,
  durationSeconds: number = 15
): Promise<LyriaTrackResult> {
  return generateLyriaTrack({
    prompts: buildTransitionPrompt(fromGenre, toGenre, durationSeconds),
    durationSeconds,
    config: {
      temperature: 1.0,
      guidance: 4.5,
      density: 0.5,
      musicGenerationMode: "QUALITY",
    },
  });
}

export async function generateLyriaCustomTrack(
  description: string,
  durationSeconds: number = 120
): Promise<LyriaTrackResult> {
  return generateLyriaTrack({
    prompts: buildCustomTrackPrompt(description),
    durationSeconds,
    config: {
      temperature: 1.1,
      guidance: 4.0,
      musicGenerationMode: "QUALITY",
    },
  });
}

// --- Standalone Test ---

if (import.meta.main) {
  console.log("[lyria] Running standalone test generation...");
  const result = await generateLyriaCustomTrack(
    "lo-fi jazz with warm piano and gentle rain ambience",
    30
  );
  console.log("[lyria] Test complete:", result);
}
