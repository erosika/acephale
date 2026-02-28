import { join } from "node:path";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { getGeminiFlash, generateStructured } from "./gemini.js";
import { synthesizeSpeech } from "./tts.js";
import { generateLyriaAmbient } from "./lyria.js";
import { normalizeAudio, convertToMp3 } from "./audio.js";

// --- Types ---

export type CallType = "user" | "ai";

export type CallRequest = {
  id: string;
  station: string;
  text: string;
  type: CallType;
  timestamp: number;
};

export type ProcessedCall = {
  id: string;
  mp3Path: string;
  durationMs: number;
  text: string;
};

// --- In-Memory Queue ---

const callQueue: CallRequest[] = [];

export function addCall(station: string, text: string, type: CallType = "user"): string {
  const id = `call_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  callQueue.push({ id, station, text, type, timestamp: Date.now() });
  console.log(`[calls] Added ${type} call to queue for ${station} (Queue size: ${callQueue.length})`);
  return id;
}

export function pickNextCall(station: string): CallRequest | null {
  const index = callQueue.findIndex((c) => c.station === station || c.station === "any");
  if (index !== -1) {
    const call = callQueue.splice(index, 1)[0];
    return call;
  }
  return null;
}

// --- AI Caller Generation ---

export async function generateAICaller(station: string, context?: string): Promise<string> {
  const model = getGeminiFlash();
  const prompt = `You are a listener calling in to the radio station "${station}".
${context ? `Context about what's playing/happening: ${context}` : ""}

Write a short, natural-sounding voice message (2-4 sentences). 
You could be requesting a song, sharing a weird thought, or reacting to the host.
Make it sound conversational, with occasional pauses or hesitations.

Respond with JSON:
{
  "text": "your message"
}`;

  const result = await generateStructured(model, prompt, (raw) => JSON.parse(raw));
  return addCall(station, result.text, "ai");
}

// --- Processing & Lyria Integration ---

export async function processCallWithLyriaUnderbed(
  call: CallRequest,
  mood: string = "dark ambient, tense, ethereal"
): Promise<ProcessedCall> {
  const tmpDir = join(import.meta.dir, "..", "..", ".tmp");
  mkdirSync(tmpDir, { recursive: true });

  console.log(`[calls] Processing call ${call.id}...`);

  // 1. Synthesize caller voice (we use generic voices for callers)
  const voices = ["Puck", "Charon", "Kore", "Fenrir", "Aoede"];
  const callerVoice = voices[Math.floor(Math.random() * voices.length)];
  const speech = await synthesizeSpeech(call.text, callerVoice);
  
  const speechWav = join(tmpDir, `${call.id}_speech.wav`);
  const { writeFileSync } = await import("node:fs");
  writeFileSync(speechWav, speech.audio);

  // 2. Generate Lyria underbed (music under voice)
  // We want the track to be slightly longer than the speech
  const durationSec = Math.ceil(speech.durationMs / 1000) + 10;
  console.log(`[calls] Generating ${durationSec}s Lyria underbed for call...`);
  const lyria = await generateLyriaAmbient(mood, durationSec);

  // 3. Mix them together using ffmpeg
  const mixedWav = join(tmpDir, `${call.id}_mixed.wav`);
  const finalMp3 = join(tmpDir, `${call.id}_final.mp3`);

  // ffmpeg filter complex to mix:
  // - [0:a] is the speech
  // - [1:a] is the Lyria track (lowered in volume)
  // amix mixes them.
  const { spawn } = await import("bun");
  const proc = spawn([
    "ffmpeg", "-y",
    "-i", speechWav,
    "-i", lyria.mp3Path,
    "-filter_complex", "[0:a]volume=1.2[v];[1:a]volume=0.3[m];[v][m]amix=inputs=2:duration=longest",
    mixedWav
  ], { stdout: "pipe", stderr: "pipe" });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`[calls] ffmpeg mix failed (exit ${exitCode}): ${stderr}`);
  }

  // 4. Normalize and convert to final MP3
  const normWav = await normalizeAudio(mixedWav);
  await convertToMp3(normWav, finalMp3, {
    title: "Listener Call",
    artist: "Anonymous",
    album: "Acephale Radio",
  });

  // Cleanup temps
  try { unlinkSync(speechWav); } catch {}
  try { unlinkSync(lyria.mp3Path); } catch {}
  try { unlinkSync(mixedWav); } catch {}
  try { unlinkSync(normWav); } catch {}

  // The duration is roughly the Lyria track duration since we used `duration=longest`
  // But let's probe it to be exact
  const { probeDuration } = await import("./audio.js");
  const actualDurationMs = await probeDuration(finalMp3) * 1000;

  console.log(`[calls] Processed call ${call.id}: ${finalMp3}`);

  return {
    id: call.id,
    mp3Path: finalMp3,
    durationMs: actualDurationMs,
    text: call.text,
  };
}
