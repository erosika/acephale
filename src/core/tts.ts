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

export async function synthesizeSpeech(
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

export function getVoiceProfile(
  agentName: string,
  roster: Array<{ id: string; voice: string }>
): string {
  const agent = roster.find((a) => a.id === agentName);
  if (!agent) throw new Error(`Unknown agent: ${agentName}`);
  return agent.voice;
}
