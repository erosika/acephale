// Request Line loop -- listener-driven music + autopilot DJ
// Echo plays curated Radiooooo selections between callers, generating warm
// commentary about each track. When callers are in queue, processes their
// requests by searching Radiooooo.

import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { loadAgentRoster, getStationAgents } from "../../core/config.js";
import { getGeminiFlash, generateStructured } from "../../core/gemini.js";
import { getAgentMemory, saveRequestLineCycle } from "../../core/honcho.js";
import { synthesizeSpeech } from "../../core/tts.js";
import { concatAudio, normalizeAudio, convertToMp3, applyFades, type AudioSegment } from "../../core/audio.js";
import { randomTrack, downloadAndTagTrack, type RadioooooTrack, type Decade, type Mood, ALL_DECADES } from "../../core/radiooooo.js";
import { queueTrack } from "../../core/stream.js";
import { setNowPlaying } from "../../core/nowplaying.js";
import { logArchiveEntry } from "../../core/archive.js";
import { generateLyriaCustomTrack } from "../../core/lyria.js";

// --- Types ---

export type RequestLineLoopState = {
  running: boolean;
  tracksPlayed: number;
  startedAt: string;
};

type AutopilotCommentary = {
  commentary: string;
  theme: string;
  mood: string;
};

// --- Taste Model ---
// Accumulates signals from what gets played, informing autopilot picks.

const tasteSignals: { decade: Decade; country: string; mood: Mood }[] = [];

function recordTaste(track: RadioooooTrack): void {
  tasteSignals.push({
    decade: track.decade,
    country: track.country,
    mood: track.mood,
  });
  // Keep last 20 signals
  if (tasteSignals.length > 20) tasteSignals.shift();
}

function getAutopilotParams(): { decade: Decade; mood: Mood; country?: string } {
  if (tasteSignals.length === 0) {
    // Cold start -- eclectic defaults
    const decades: Decade[] = [1960, 1970, 1980, 1990, 2000];
    return {
      decade: decades[Math.floor(Math.random() * decades.length)],
      mood: "slow",
    };
  }

  // Bias toward recent taste but with drift
  const recent = tasteSignals.slice(-5);
  const decadeCounts = new Map<Decade, number>();
  const countryCounts = new Map<string, number>();
  const moodCounts = new Map<Mood, number>();

  for (const s of recent) {
    decadeCounts.set(s.decade, (decadeCounts.get(s.decade) || 0) + 1);
    countryCounts.set(s.country, (countryCounts.get(s.country) || 0) + 1);
    moodCounts.set(s.mood, (moodCounts.get(s.mood) || 0) + 1);
  }

  // Most popular from recent, with 30% chance of random drift
  const doDrift = Math.random() < 0.3;

  const topDecade = doDrift
    ? ALL_DECADES[Math.floor(Math.random() * ALL_DECADES.length)]
    : [...decadeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 1970 as Decade;

  const topMood = doDrift
    ? (["slow", "fast", "weird"] as Mood[])[Math.floor(Math.random() * 3)]
    : [...moodCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "slow" as Mood;

  const topCountry = doDrift
    ? undefined
    : [...countryCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  return { decade: topDecade, mood: topMood, country: topCountry };
}

// --- Commentary Generation ---

function parseAutopilot(raw: string): AutopilotCommentary {
  const parsed = JSON.parse(raw);
  return {
    commentary: parsed.commentary || "",
    theme: parsed.theme || "",
    mood: parsed.mood || "warm",
  };
}

async function generateAutopilotCommentary(
  track: RadioooooTrack,
  memories: string[],
  agentName: string,
  personality: string
): Promise<AutopilotCommentary> {
  const model = getGeminiFlash();
  const prompt = `You are ${agentName}, the host of The Request Line on Acephale Radio.
Personality: ${personality}

No callers right now, so you're playing your own picks. You're about to play:
"${track.title}" by ${track.artist} (${track.year}, ${track.country})

${memories.length > 0 ? `Your memories:\n${memories.map(m => `- ${m}`).join("\n")}` : ""}

Write a warm, brief introduction (2-3 sentences). You're talking to whoever might be listening.
Mention you're open for calls. Be personal and enthusiastic about the music.

Respond with JSON:
{
  "commentary": "your intro for the track",
  "theme": "the musical theme you're exploring tonight",
  "mood": "warm|nostalgic|excited|contemplative"
}`;

  return generateStructured(model, prompt, parseAutopilot);
}

// --- Audio Rendering ---

async function renderSpeech(
  text: string,
  voiceName: string
): Promise<{ mp3Path: string; durationMs: number }> {
  const tmpDir = join(import.meta.dir, "..", "..", "..", ".tmp");
  mkdirSync(tmpDir, { recursive: true });

  const timestamp = Date.now();
  const wavPath = join(tmpDir, `request-speech-${timestamp}.wav`);
  const mp3Path = join(tmpDir, `request-speech-${timestamp}.mp3`);

  const result = await synthesizeSpeech(text, voiceName);
  const segments: AudioSegment[] = [{ audio: result.audio, label: "speech" }];

  await concatAudio(segments, wavPath, 0);
  const normPath = await normalizeAudio(wavPath);
  await convertToMp3(normPath, mp3Path);

  return { mp3Path, durationMs: result.durationMs };
}

// --- Autopilot Cycle ---

async function runAutopilotCycle(
  agent: { name: string; voice: string; personality: string; honchoUser: string },
  memories: string[]
): Promise<number> {
  // 1. Pick track based on taste model
  const params = getAutopilotParams();
  console.log(`[request-line] Autopilot: ${params.decade}s, ${params.mood}, ${params.country || "worldwide"}`);

  const track = await randomTrack({
    decades: [params.decade],
    country: params.country,
    moods: [params.mood],
  });

  if (!track || !track.audioUrl) {
    console.log("[request-line] No track found, trying broader search");
    const fallback = await randomTrack({ decades: [params.decade] });
    if (!fallback || !fallback.audioUrl) {
      return runLyriaFallback(agent, params, memories);
    }
    return runTrackCycle(agent, fallback, memories);
  }

  return runTrackCycle(agent, track, memories);
}

async function runTrackCycle(
  agent: { name: string; voice: string; personality: string; honchoUser: string },
  track: RadioooooTrack,
  memories: string[]
): Promise<number> {
  console.log(`[request-line] Playing: "${track.title}" by ${track.artist} (${track.year}, ${track.country})`);

  // Generate commentary
  const commentary = await generateAutopilotCommentary(track, memories, agent.name, agent.personality);

  // Render speech
  const rendered = await renderSpeech(commentary.commentary, agent.voice);

  // Download and tag track
  const taggedPath = await downloadAndTagTrack(track, "Acephale Radio -- Request Line");

  // Apply fades to track only (TTS stays clean)
  await applyFades(taggedPath, { fadeInSec: 1.0, fadeOutSec: 2.5 });

  // Queue
  const trackMeta = {
    title: track.title,
    artist: track.artist,
    album: track.album || `${track.country} ${track.decade}s`,
    year: track.year,
  };

  await queueTrack("request-line", rendered.mp3Path);
  await queueTrack("request-line", taggedPath, trackMeta);

  // Update state
  setNowPlaying("request-line", {
    title: track.title,
    artist: track.artist,
    album: track.album,
    year: track.year,
    country: track.country,
    coverUrl: track.coverUrl,
  });

  logArchiveEntry({
    station: "request-line",
    timestamp: Date.now(),
    title: track.title,
    artist: track.artist,
    year: track.year,
    country: track.country,
    duration: track.length || undefined,
  });

  recordTaste(track);

  // Save to Honcho
  try {
    await saveRequestLineCycle(agent.honchoUser, commentary.commentary, {
      title: track.title,
      artist: track.artist,
      year: String(track.year),
      country: track.country,
    });
  } catch {
    // Non-fatal
  }

  // Return wait time -- start prepping next before current ends (no dead air)
  const totalMs = rendered.durationMs + ((track.length || 180) * 1000);
  const prepLeadMs = Math.min(30000, totalMs * 0.4);
  return Math.max(5000, totalMs - prepLeadMs);
}

// --- Lyria Fallback ---

async function runLyriaFallback(
  agent: { name: string; voice: string; personality: string; honchoUser: string },
  params: { decade: Decade; mood: Mood; country?: string },
  memories: string[]
): Promise<number> {
  const description = `${params.mood} ${params.decade}s ${params.country || "world"} music, radio-ready instrumental`;
  console.log(`[request-line] Radiooooo exhausted, generating via Lyria: "${description}"`);

  try {
    const lyria = await generateLyriaCustomTrack(description, 120);

    // Generate intro commentary
    const model = getGeminiFlash();
    const prompt = `You are ${agent.name}, the host of The Request Line on Acephale Radio.
Personality: ${agent.personality}

${memories.length > 0 ? `Your memories:\n${memories.map(m => `- ${m}`).join("\n")}` : ""}

You couldn't find a record for someone, so you fired up the AI generator to create something fresh.
The vibe: ${description}

Write a warm, brief introduction (2-3 sentences). Mention that this one was generated live just for the listeners.

Respond with JSON:
{
  "commentary": "your intro"
}`;

    const commentary = await generateStructured(model, prompt, (raw: string) => {
      const parsed = JSON.parse(raw);
      return parsed.commentary as string || "";
    });

    const rendered = await renderSpeech(commentary, agent.voice);

    // Apply fades to generated track
    await applyFades(lyria.mp3Path, { fadeInSec: 1.5, fadeOutSec: 3.0 });

    // Queue speech then track
    await queueTrack("request-line", rendered.mp3Path);
    await queueTrack("request-line", lyria.mp3Path, {
      title: "Lyria Generation",
      artist: "Acephale Radio -- Lyria",
      genre: `${params.decade}s ${params.mood}`,
    });

    setNowPlaying("request-line", {
      title: "Lyria Generation",
      artist: "Acephale Radio -- Lyria",
    });

    logArchiveEntry({
      station: "request-line",
      timestamp: Date.now(),
      title: "Lyria Generation",
      artist: "Lyria",
      duration: Math.round(lyria.durationMs / 1000),
    });

    // Save to Honcho
    try {
      await saveRequestLineCycle(agent.honchoUser, commentary, {
        title: "Lyria Generation",
        artist: "Lyria",
        year: "2026",
        country: params.country || "AI",
      });
    } catch {
      // Non-fatal
    }

    const totalMs = rendered.durationMs + lyria.durationMs;
    const prepLeadMs = Math.min(30000, totalMs * 0.4);
    return Math.max(5000, totalMs - prepLeadMs);
  } catch (err) {
    console.error("[request-line] Lyria fallback failed:", err);
    return 10000;
  }
}

// --- Main Loop ---

export async function runRequestLineLoop(): Promise<never> {
  console.log("[request-line] Starting Request Line loop");

  const roster = loadAgentRoster();
  const agents = getStationAgents(roster, "request-line");
  const agent = agents[0];
  if (!agent) throw new Error("No Request Line agent in roster");

  let cycleCount = 0;

  while (true) {
    try {
      // Fetch memories
      let memories: string[] = [];
      try {
        memories = await getAgentMemory(agent.honchoUser);
      } catch {
        // First run or Honcho unavailable
      }

      const waitMs = await runAutopilotCycle(agent, memories);

      cycleCount++;
      console.log(`[request-line] Cycle #${cycleCount}. Waiting ~${Math.round(waitMs / 1000)}s`);
      await Bun.sleep(waitMs);

    } catch (err) {
      console.error("[request-line] Loop error:", err);
      await Bun.sleep(10000);
    }
  }
}

if (import.meta.main) {
  runRequestLineLoop().catch(console.error);
}
