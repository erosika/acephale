import { GoogleGenAI } from "@google/genai";
import { join } from "node:path";
import { mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { getEnv } from "./config.js";

// --- Types ---

export type SynthesisOptions = {
  speakingRate?: number;
  pitch?: number;
  ssml?: boolean;
};

export type SynthesisResult = {
  audio: Buffer;
  durationMs: number;
};

// --- Voice name normalization ---
// Accepts both "en-US-Chirp3-HD-Aoede" and "Aoede"

function shortVoiceName(voice: string): string {
  const parts = voice.split("-");
  return parts[parts.length - 1];
}

// --- WAV header for raw PCM (24kHz mono 16-bit) ---

function wrapPcmAsWav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  const dataSize = pcm.length;
  const fileSize = 36 + dataSize;

  header.write("RIFF", 0);
  header.writeUInt32LE(fileSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);       // fmt chunk size
  header.writeUInt16LE(1, 20);        // PCM format
  header.writeUInt16LE(1, 22);        // mono
  header.writeUInt32LE(24000, 24);    // sample rate
  header.writeUInt32LE(48000, 28);    // byte rate (24000 * 1 * 2)
  header.writeUInt16LE(2, 32);        // block align
  header.writeUInt16LE(16, 34);       // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm]);
}

// --- Gemini TTS (gemini-2.5-flash-preview-tts) ---

let genai: GoogleGenAI | null = null;

function getGenAI(): GoogleGenAI {
  if (!genai) {
    genai = new GoogleGenAI({ apiKey: getEnv("GEMINI_API_KEY") });
  }
  return genai;
}

async function geminiTTS(
  text: string,
  voiceName: string,
  _options?: SynthesisOptions
): Promise<SynthesisResult> {
  const ai = getGenAI();

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text }] }],
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: shortVoiceName(voiceName) },
        },
      },
    },
  });

  const data = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!data) throw new Error("TTS: no audio data in response");

  const pcm = Buffer.from(data, "base64");
  const audio = wrapPcmAsWav(pcm);

  // PCM 24kHz mono 16-bit
  const bytesPerSecond = 24000 * 2;
  const durationMs = Math.round((pcm.length / bytesPerSecond) * 1000);

  return { audio, durationMs };
}

// --- macOS Local TTS Fallback ---

const MAC_VOICE_MAP: Record<string, string> = {
  Aoede: "Samantha",
  Leda: "Karen",
  Puck: "Daniel",
  Charon: "Tom",
  Kore: "Moira",
};

async function localTTS(
  text: string,
  voiceName: string,
  options?: SynthesisOptions
): Promise<SynthesisResult> {
  const tmpDir = join(import.meta.dir, "..", "..", ".tmp");
  mkdirSync(tmpDir, { recursive: true });

  const ts = Date.now();
  const aiffPath = join(tmpDir, `tts-${ts}.aiff`);
  const wavPath = join(tmpDir, `tts-${ts}.wav`);

  const short = shortVoiceName(voiceName);
  const macVoice = MAC_VOICE_MAP[short] || "Samantha";
  const rate = Math.round((options?.speakingRate ?? 1.0) * 200);

  // macOS say -> AIFF
  const sayProc = Bun.spawn(["say", "-v", macVoice, "-r", String(rate), "-o", aiffPath, text], {
    stdout: "pipe",
    stderr: "pipe",
  });
  await sayProc.exited;

  // Convert AIFF -> WAV (LINEAR16 24kHz mono)
  const ffProc = Bun.spawn([
    "ffmpeg", "-y", "-i", aiffPath,
    "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le",
    wavPath,
  ], { stdout: "pipe", stderr: "pipe" });
  await ffProc.exited;

  const audio = readFileSync(wavPath);

  try { unlinkSync(aiffPath); } catch { /* ignore */ }
  try { unlinkSync(wavPath); } catch { /* ignore */ }

  const bytesPerSecond = 24000 * 2;
  const durationMs = Math.round((audio.length / bytesPerSecond) * 1000);

  return { audio: Buffer.from(audio), durationMs };
}

// --- Public API (Gemini first, macOS fallback) ---

export async function synthesizeSpeech(
  text: string,
  voiceName: string,
  options?: SynthesisOptions
): Promise<SynthesisResult> {
  const MAX_RETRIES = 2;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await geminiTTS(text, voiceName, options);
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        const delayMs = 1000 * (attempt + 1);
        console.log(`[tts] Gemini TTS attempt ${attempt + 1} failed, retrying in ${delayMs}ms...`);
        await new Promise((r) => setTimeout(r, delayMs));
      } else {
        console.log(`[tts] Gemini TTS failed after ${MAX_RETRIES + 1} attempts (${String(err).slice(0, 120)}), using local macOS fallback`);
        return localTTS(text, voiceName, options);
      }
    }
  }
  return localTTS(text, voiceName, options);
}

export function getVoiceProfile(
  agentName: string,
  roster: Array<{ id: string; voice: string }>
): string {
  const agent = roster.find((a) => a.id === agentName);
  if (!agent) throw new Error(`Unknown agent: ${agentName}`);
  return agent.voice;
}
