import { join } from "node:path";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { getGeminiFlash, generateStructured } from "./gemini.js";
import { synthesizeSpeech } from "./tts.js";
import { generateLyriaAmbient } from "./lyria.js";
import { normalizeAudio, convertToMp3 } from "./audio.js";

// --- Types ---

export type CallType = "user" | "ai" | "user_voice";

export type CallRequest = {
  id: string;
  station: string;
  text: string;
  type: CallType;
  timestamp: number;
  audioBuf?: Buffer;
};

export type ProcessedCall = {
  id: string;
  mp3Path: string;
  durationMs: number;
  text: string;
};

// --- In-Memory Queue ---

const callQueue: CallRequest[] = [];

export function addCall(station: string, text: string, type: CallType = "user", audioBuf?: Buffer): string {
  const id = `call_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  callQueue.push({ id, station, text, type, timestamp: Date.now(), audioBuf });
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

export async function processCallVoice(
  call: CallRequest
): Promise<{ wavPath: string; durationMs: number }> {
  const tmpDir = join(import.meta.dir, "..", "..", ".tmp");
  mkdirSync(tmpDir, { recursive: true });

  const speechWav = join(tmpDir, `${call.id}_speech.wav`);
  const { writeFileSync } = await import("node:fs");

  let actualDurationMs = 0;

  if (call.type === "user_voice" && call.audioBuf) {
    const rawWebm = join(tmpDir, `${call.id}_raw.webm`);
    writeFileSync(rawWebm, call.audioBuf);
    
    // Convert directly to WAV
    const { runFfmpeg, probeDuration } = await import("./audio.js");
    await runFfmpeg([
      "-i", rawWebm,
      "-ar", "24000",
      "-ac", "1",
      "-c:a", "pcm_s16le",
      speechWav
    ]);
    
    // We explicitly wait a small buffer for the file system to catch up on mac
    await new Promise(r => setTimeout(r, 100));

    actualDurationMs = (await probeDuration(speechWav)) * 1000;
    try { unlinkSync(rawWebm); } catch {}
  } else {
    // Synthesize caller voice
    const voices = ["Puck", "Charon", "Kore", "Fenrir", "Aoede"];
    const callerVoice = voices[Math.floor(Math.random() * voices.length)];
    const speech = await synthesizeSpeech(call.text, callerVoice);
    writeFileSync(speechWav, speech.audio);
    actualDurationMs = speech.durationMs;
  }

  return { wavPath: speechWav, durationMs: actualDurationMs };
}
