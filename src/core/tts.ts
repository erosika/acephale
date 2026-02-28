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

// --- Google Cloud TTS (Chirp 3 HD) ---

async function googleTTS(
  text: string,
  voiceName: string,
  options?: SynthesisOptions
): Promise<SynthesisResult> {
  const apiKey = getEnv("GOOGLE_TTS_API_KEY", process.env.GEMINI_API_KEY);
  const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`;

  const input = options?.ssml
    ? { ssml: text }
    : { text };

  const body = {
    input,
    voice: {
      languageCode: voiceName.slice(0, 5),
      name: voiceName,
    },
    audioConfig: {
      audioEncoding: "LINEAR16",
      sampleRateHertz: 24000,
      speakingRate: options?.speakingRate ?? 1.0,
      pitch: options?.pitch ?? 0,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`TTS failed (${res.status}): ${err}`);
  }

  const json = (await res.json()) as { audioContent: string };
  const audio = Buffer.from(json.audioContent, "base64");

  // Estimate duration: LINEAR16 = 24000 samples/sec * 2 bytes/sample
  const bytesPerSecond = 24000 * 2;
  const durationMs = Math.round((audio.length / bytesPerSecond) * 1000);

  return { audio, durationMs };
}

// --- macOS Local TTS Fallback ---

const VOICE_MAP: Record<string, string> = {
  "en-US-Chirp3-HD-Aoede": "Samantha",
  "en-US-Chirp3-HD-Leda": "Karen",
  "en-US-Chirp3-HD-Puck": "Daniel",
  "en-US-Chirp3-HD-Charon": "Tom",
  "en-US-Chirp3-HD-Kore": "Moira",
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

  const macVoice = VOICE_MAP[voiceName] || "Samantha";
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

  // Cleanup
  try { unlinkSync(aiffPath); } catch { /* ignore */ }
  try { unlinkSync(wavPath); } catch { /* ignore */ }

  const bytesPerSecond = 24000 * 2;
  const durationMs = Math.round((audio.length / bytesPerSecond) * 1000);

  return { audio: Buffer.from(audio), durationMs };
}

// --- Public API (auto-fallback) ---

export async function synthesizeSpeech(
  text: string,
  voiceName: string,
  options?: SynthesisOptions
): Promise<SynthesisResult> {
  try {
    return await googleTTS(text, voiceName, options);
  } catch (err) {
    const msg = String(err);
    if (msg.includes("403") || msg.includes("SERVICE_DISABLED") || msg.includes("PERMISSION_DENIED")) {
      console.log("[tts] Google Cloud TTS unavailable, using local macOS fallback");
      return localTTS(text, voiceName, options);
    }
    throw err;
  }
}

export function getVoiceProfile(
  agentName: string,
  roster: Array<{ id: string; voice: string }>
): string {
  const agent = roster.find((a) => a.id === agentName);
  if (!agent) throw new Error(`Unknown agent: ${agentName}`);
  return agent.voice;
}
