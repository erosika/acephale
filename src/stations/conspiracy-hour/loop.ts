// Conspiracy Hour loop -- paranoid monologues + ambient
// Nyx generates escalating conspiracy theories, weaving in "evidence" from
// other stations, callers, and news. Monologues get progressively more paranoid.

import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { loadAgentRoster, getStationAgents } from "../../core/config.js";
import { getGeminiPro, generateStructured } from "../../core/gemini.js";
import { getAgentMemory, saveMonologue } from "../../core/honcho.js";
import { synthesizeSpeech } from "../../core/tts.js";
import { concatAudio, normalizeAudio, convertToMp3, type AudioSegment } from "../../core/audio.js";
import { queueTrack } from "../../core/stream.js";
import { setNowPlaying } from "../../core/nowplaying.js";
import { logArchiveEntry } from "../../core/archive.js";
import { buildConspiracyPrompt, type ConspiracyThread, type Evidence } from "./host.js";

// --- Types ---

export type ConspiracyLoopState = {
  running: boolean;
  threadsActive: number;
  callersTaken: number;
  paranoiaLevel: number;
  startedAt: string;
};

type MonologueResult = {
  monologue: string;
  new_thread: { thesis: string; evidence_used: string[] } | null;
  accusations: Array<{ target: string; claim: string }>;
  mood: string;
};

// --- State ---

let activeThreads: ConspiracyThread[] = [];
let paranoiaLevel = 3;

// --- Evidence Gathering ---

function gatherAmbientEvidence(): Evidence[] {
  // Synthetic evidence from the environment -- things Nyx "notices"
  const sources: Evidence[] = [];
  const hour = new Date().getUTCHours();

  if (hour >= 0 && hour < 6) {
    sources.push({
      source: "pattern",
      content: "Dead air on Morning Zoo at 3:17 AM. Exactly 3 minutes 17 seconds. 317 is a prime number. Think about that.",
      from: "station monitoring",
      timestamp: Date.now(),
      distortion: "The silence was intentional. A signal.",
    });
  }

  if (Math.random() < 0.3) {
    sources.push({
      source: "pattern",
      content: "The Crate Digger played three tracks from the same country in a row. Coincidence? Or coordination?",
      from: "cross-station analysis",
      timestamp: Date.now(),
      distortion: "Musical selections are encoded messages.",
    });
  }

  if (Math.random() < 0.2) {
    sources.push({
      source: "news",
      content: "Server latency spike detected at midnight. Someone was accessing the archives.",
      from: "system logs",
      timestamp: Date.now(),
      distortion: "They're erasing evidence from the early broadcasts.",
    });
  }

  if (Math.random() < 0.25) {
    sources.push({
      source: "other_dj",
      content: "Echo on Request Line keeps asking callers about their location. Building a map.",
      from: "Request Line monitoring",
      timestamp: Date.now(),
      distortion: "Listener geolocation for triangulation purposes.",
    });
  }

  return sources;
}

// --- Monologue Generation ---

function parseMonologue(raw: string): MonologueResult {
  const parsed = JSON.parse(raw);
  return {
    monologue: parsed.monologue || "",
    new_thread: parsed.new_thread || null,
    accusations: parsed.accusations || [],
    mood: parsed.mood || "paranoid",
  };
}

async function generateMonologue(memories: string[]): Promise<MonologueResult> {
  const roster = loadAgentRoster();
  const agents = getStationAgents(roster, "conspiracy-hour");
  const agent = agents[0];
  if (!agent) throw new Error("No Conspiracy Hour agent in roster");

  const evidence = gatherAmbientEvidence();
  const prompt = buildConspiracyPrompt(agent, activeThreads, evidence, memories);
  const model = getGeminiPro();

  return generateStructured(model, prompt, parseMonologue);
}

// --- Thread Management ---

function updateThreads(result: MonologueResult): void {
  if (result.new_thread) {
    const thread: ConspiracyThread = {
      id: `thread-${Date.now()}`,
      thesis: result.new_thread.thesis,
      evidence: result.new_thread.evidence_used.map((e) => ({
        source: "pattern" as const,
        content: e,
        from: "Nyx's analysis",
        timestamp: Date.now(),
        distortion: "Connected to the larger pattern.",
      })),
      confidence: Math.min(paranoiaLevel + 2, 10),
      firstMentioned: Date.now(),
      lastUpdated: Date.now(),
      relatedThreads: activeThreads.slice(-2).map((t) => t.id),
    };
    activeThreads.push(thread);
    console.log(`[conspiracy-hour] New thread: "${thread.thesis}"`);
  }

  // Cap active threads, oldest fall off
  if (activeThreads.length > 5) {
    activeThreads = activeThreads.slice(-5);
  }

  // Paranoia escalates over time, resets at dawn
  const hour = new Date().getUTCHours();
  if (hour >= 6 && hour < 8) {
    paranoiaLevel = 3;
  } else {
    paranoiaLevel = Math.min(paranoiaLevel + 0.5, 10);
  }
}

// --- Audio Rendering ---

async function renderMonologue(
  text: string,
  voiceName: string,
  mood: string
): Promise<{ mp3Path: string; durationMs: number }> {
  const tmpDir = join(import.meta.dir, "..", "..", "..", ".tmp");
  mkdirSync(tmpDir, { recursive: true });

  const timestamp = Date.now();
  const wavPath = join(tmpDir, `conspiracy-mono-${timestamp}.wav`);
  const mp3Path = join(tmpDir, `conspiracy-mono-${timestamp}.mp3`);

  // Adjust voice for mood
  const speakingRate = mood === "whispering" ? 0.85
    : mood === "manic" ? 1.15
    : mood === "eerily_calm" ? 0.9
    : 1.0;

  const pitch = mood === "whispering" ? -2
    : mood === "indignant" ? 2
    : 0;

  const result = await synthesizeSpeech(text, voiceName, { speakingRate, pitch });
  const segments: AudioSegment[] = [{ audio: result.audio, label: "monologue" }];

  await concatAudio(segments, wavPath, 0);
  const normPath = await normalizeAudio(wavPath);
  await convertToMp3(normPath, mp3Path);

  return { mp3Path, durationMs: result.durationMs };
}

// --- Main Loop ---

export async function runConspiracyLoop(): Promise<never> {
  console.log("[conspiracy-hour] Starting Conspiracy Hour loop");

  const roster = loadAgentRoster();
  const agents = getStationAgents(roster, "conspiracy-hour");
  const agent = agents[0];
  if (!agent) throw new Error("No Conspiracy Hour agent in roster");

  let monologueCount = 0;

  while (true) {
    try {
      // 1. Fetch memories (contextual: what threads am I tracking?)
      let memories: string[] = [];
      try {
        const latestThesis = activeThreads.length > 0
          ? activeThreads[activeThreads.length - 1].thesis
          : "patterns in the signal";
        memories = await getAgentMemory(
          agent.honchoUser,
          `What evidence have I gathered about ${latestThesis}?`
        );
      } catch {
        // First run or Honcho unavailable
      }

      // 2. Generate monologue
      console.log(`[conspiracy-hour] Generating monologue (paranoia: ${paranoiaLevel.toFixed(1)}, threads: ${activeThreads.length})`);
      const result = await generateMonologue(memories);
      console.log(`[conspiracy-hour] Monologue: "${result.monologue.slice(0, 60)}..." [${result.mood}]`);

      if (result.accusations.length > 0) {
        for (const acc of result.accusations) {
          console.log(`[conspiracy-hour] Accusation: ${acc.target} -- ${acc.claim}`);
        }
      }

      // 3. Update conspiracy threads
      updateThreads(result);

      // 4. Render audio
      const rendered = await renderMonologue(result.monologue, agent.voice, result.mood);
      console.log(`[conspiracy-hour] Rendered (~${Math.round(rendered.durationMs / 1000)}s)`);

      // 5. Queue in Liquidsoap
      await queueTrack("conspiracy-hour", rendered.mp3Path, {
        title: `Conspiracy Hour -- ${result.mood}`,
        artist: agent.name,
        comment: activeThreads.length > 0 ? activeThreads[activeThreads.length - 1].thesis : undefined,
      });
      console.log("[conspiracy-hour] Queued monologue");

      // 6. Update now-playing
      const latestThread = activeThreads[activeThreads.length - 1];
      setNowPlaying("conspiracy-hour", {
        title: latestThread ? latestThread.thesis.slice(0, 60) : "The truth is out there...",
        artist: agent.name,
        album: `Paranoia Level ${Math.round(paranoiaLevel)}`,
      });

      // 7. Log to archive
      logArchiveEntry({
        station: "conspiracy-hour",
        timestamp: Date.now(),
        title: latestThread ? latestThread.thesis : "Monologue",
        artist: agent.name,
        duration: Math.round(rendered.durationMs / 1000),
      });

      // 8. Save to Honcho (shift session -- monologues accumulate through the night)
      try {
        await saveMonologue(agent.honchoUser, result.monologue, {
          mood: result.mood,
          paranoia: paranoiaLevel,
          thread: latestThread?.thesis,
          accusations: result.accusations,
        });
      } catch {
        // Non-fatal
      }

      monologueCount++;
      console.log(`[conspiracy-hour] Monologue #${monologueCount} complete`);

      // 9. Wait -- start preparing next monologue before current ends (no dead air)
      // Talk-only station: chain monologues back-to-back, prep next while current plays
      const prepLeadMs = Math.min(30000, rendered.durationMs * 0.3);
      const waitMs = Math.max(5000, rendered.durationMs - prepLeadMs);
      console.log(`[conspiracy-hour] Monologue #${monologueCount}. Next prep in ~${Math.round(waitMs / 1000)}s`);
      await Bun.sleep(waitMs);

    } catch (err) {
      console.error("[conspiracy-hour] Loop error:", err);
      await Bun.sleep(15000);
    }
  }
}

if (import.meta.main) {
  runConspiracyLoop().catch(console.error);
}
