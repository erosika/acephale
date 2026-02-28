// Crate Digger loop -- continuous music + commentary
// Crate pulls deep cuts from Radiooooo, introduces each track with context,
// drifts between decades/countries thematically.

import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { loadAgentRoster, getStationAgents } from "../../core/config.js";
import { getGeminiFlash, generateStructured } from "../../core/gemini.js";
import { getAgentMemory, saveDig } from "../../core/honcho.js";
import { synthesizeSpeech } from "../../core/tts.js";
import { concatAudio, normalizeAudio, convertToMp3, applyFades, mixVoiceOverMusic, type AudioSegment } from "../../core/audio.js";
import { randomTrack, downloadAndTagTrack, countriesForDecade, type RadioooooTrack, type Decade, type Mood, ALL_DECADES, ALL_MOODS } from "../../core/radiooooo.js";
import { queueTrack } from "../../core/stream.js";
import { setNowPlaying } from "../../core/nowplaying.js";
import { logArchiveEntry } from "../../core/archive.js";
import { pickNextCall, processCallVoice, type CallRequest } from "../../core/calls.js";
import { buildDiggerPrompt, type TrackIntroduction } from "./digger.js";

// --- Types ---

export type CrateDiggerLoopState = {
  running: boolean;
  currentDecade: Decade;
  currentMood: Mood;
  tracksPlayed: number;
  regionsVisited: string[];
  startedAt: string;
};

// --- Decade/Country Selection ---

const DECADE_WEIGHTS: Record<Decade, number> = {
  1900: 1, 1910: 1, 1920: 2, 1930: 3, 1940: 4, 1950: 6,
  1960: 8, 1970: 10, 1980: 8, 1990: 6, 2000: 4, 2010: 3, 2020: 2,
};

function pickWeightedDecade(): Decade {
  const entries = Object.entries(DECADE_WEIGHTS) as [string, number][];
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let r = Math.random() * total;
  for (const [decade, weight] of entries) {
    r -= weight;
    if (r <= 0) return parseInt(decade) as Decade;
  }
  return 1970;
}

function pickMood(): Mood {
  // Crate Digger leans toward slow and weird
  const roll = Math.random();
  if (roll < 0.4) return "slow";
  if (roll < 0.7) return "weird";
  return "fast";
}

async function pickCountryForDecade(decade: Decade, mood: Mood): Promise<string | undefined> {
  try {
    const countries = await countriesForDecade(decade);
    const matching = countries.filter((c) => c.moods.includes(mood));
    if (matching.length === 0) return undefined;
    return matching[Math.floor(Math.random() * matching.length)].country;
  } catch {
    return undefined;
  }
}

// --- Commentary Generation ---

function parseIntroduction(raw: string): TrackIntroduction {
  const parsed = JSON.parse(raw);
  return {
    track: parsed.track || {},
    intro: parsed.intro || parsed.commentary || "",
    context: parsed.context || "",
    emotion: parsed.emotion || "reverent",
  };
}

async function generateCommentary(
  track: RadioooooTrack,
  memories: string[],
  callContext?: string
): Promise<{ text: string; emotion: string }> {
  const roster = loadAgentRoster();
  const agents = getStationAgents(roster, "crate-digger");
  const agent = agents[0];
  if (!agent) throw new Error("No Crate Digger agent in roster");

  const prompt = buildDiggerPrompt(agent, track, memories, callContext);
  const model = getGeminiFlash();

  const result = await generateStructured(model, prompt + `

Respond with JSON:
{
  "intro": "your introduction for the track (2-3 sentences)",
  "context": "historical/cultural context",
  "emotion": "reverent|excited|defensive|scholarly"
}`, parseIntroduction);

  const text = [result.intro, result.context].filter(Boolean).join(" ");
  return { text, emotion: result.emotion };
}

// --- Audio Rendering ---

async function renderCommentary(
  text: string,
  voiceName: string
): Promise<{ mp3Path: string; durationMs: number }> {
  const tmpDir = join(import.meta.dir, "..", "..", "..", ".tmp");
  mkdirSync(tmpDir, { recursive: true });

  const timestamp = Date.now();
  const wavPath = join(tmpDir, `crate-commentary-${timestamp}.wav`);
  const mp3Path = join(tmpDir, `crate-commentary-${timestamp}.mp3`);

  const result = await synthesizeSpeech(text, voiceName);
  const segments: AudioSegment[] = [{ audio: result.audio, label: "commentary" }];

  await concatAudio(segments, wavPath, 0);
  const normPath = await normalizeAudio(wavPath);
  await convertToMp3(normPath, mp3Path);

  return { mp3Path, durationMs: result.durationMs };
}

// --- Main Loop ---

export async function runCrateDiggerLoop(): Promise<never> {
  console.log("[crate-digger] Starting Crate Digger loop");

  const roster = loadAgentRoster();
  const agents = getStationAgents(roster, "crate-digger");
  const agent = agents[0];
  if (!agent) throw new Error("No Crate Digger agent in roster");

  let tracksPlayed = 0;
  const regionsVisited: string[] = [];

  while (true) {
    try {
      // 0. Check for calls
      const call = pickNextCall("crate-digger");
      
      if (call) {
        console.log(`[crate-digger] Processing call from ${call.type === 'user_voice' ? 'real user' : 'AI'}...`);
        try {
          const { saveCall } = await import("../../core/honcho.js");
          await saveCall("crate-digger", call.id, call.text);
        } catch (err) {
          console.error(`[crate-digger] Failed to save call to Honcho:`, err);
        }
      }

      // 1. Pick parameters
      const decade = pickWeightedDecade();
      const mood = pickMood();
      const country = await pickCountryForDecade(decade, mood);
      console.log(`[crate-digger] Digging: ${decade}s, ${mood}, ${country || "worldwide"}`);

      // 2. Fetch track from Radiooooo
      const track = await randomTrack({ decades: [decade], country, moods: [mood] });
      if (!track || !track.audioUrl) {
        console.log("[crate-digger] No track found, retrying with different params");
        await Bun.sleep(3000);
        continue;
      }
      console.log(`[crate-digger] Found: "${track.title}" by ${track.artist} (${track.year}, ${track.country})`);

      // 3. Fetch agent memories (contextual query about what we're about to play)
      let memories: string[] = [];
      try {
        memories = await getAgentMemory(
          agent.honchoUser,
          `What do I know about ${track.country} music from the ${decade}s?`
        );
      } catch {
        // First run or Honcho unavailable
      }

      // 4. Generate commentary
      const callContext = call ? call.text : undefined;
      const commentary = await generateCommentary(track, memories, callContext);
      console.log(`[crate-digger] Commentary: "${commentary.text.slice(0, 60)}..." [${commentary.emotion}]`);

      // 5. Render commentary audio
      const rendered = await renderCommentary(commentary.text, agent.voice);
      console.log(`[crate-digger] Commentary rendered (~${Math.round(rendered.durationMs / 1000)}s)`);

      // 6. Process Caller voice (if any)
      let callerVoice: { wavPath: string; durationMs: number } | null = null;
      if (call) {
        callerVoice = await processCallVoice(call);
      }

      // 7. Download and tag track
      const taggedPath = await downloadAndTagTrack(track, "Acephale Radio -- Crate Digger");
      console.log(`[crate-digger] Track tagged: ${taggedPath}`);

      // Mix voices over track intro
      const tmpDir = join(import.meta.dir, "..", "..", "..", ".tmp");
      const finalMp3 = join(tmpDir, `crate-final-${Date.now()}.mp3`);
      
      const voicesToMix: { path: string; delayMs?: number }[] = [];
      let currentDelay = 2000; // Let music play for 2s first
      
      if (callerVoice) {
        voicesToMix.push({ path: callerVoice.wavPath, delayMs: currentDelay });
        currentDelay = 1500; // Gap between caller and DJ
      }
      
      voicesToMix.push({ path: rendered.mp3Path.replace(".mp3", ".wav"), delayMs: currentDelay });

      console.log(`[crate-digger] Mixing voices over Radiooooo track...`);
      await mixVoiceOverMusic(voicesToMix, taggedPath, finalMp3, {
        title: track.title,
        artist: track.artist,
        album: track.album || `${track.country} ${track.decade}s`,
        year: track.year,
        genre: `${track.country} ${track.mood}`,
      });

      // Cleanup temps
      const { unlinkSync } = await import("node:fs");
      try { unlinkSync(taggedPath); } catch {}
      try { unlinkSync(rendered.mp3Path); } catch {}
      if (callerVoice) {
        try { unlinkSync(callerVoice.wavPath); } catch {}
      }

      // 8. Queue mixed track
      await queueTrack("crate-digger", finalMp3);
      console.log("[crate-digger] Queued mixed track");

      // 8. Update now-playing
      setNowPlaying("crate-digger", {
        title: track.title,
        artist: track.artist,
        album: track.album,
        year: track.year,
        country: track.country,
        coverUrl: track.coverUrl,
      });

      // 9. Log to archive
      logArchiveEntry({
        station: "crate-digger",
        timestamp: Date.now(),
        title: track.title,
        artist: track.artist,
        year: track.year,
        country: track.country,
        duration: track.length || undefined,
      });

      // 10. Save to Honcho (shift session -- all digs accumulate)
      try {
        await saveDig(agent.honchoUser, commentary.text, {
          title: track.title,
          artist: track.artist,
          year: track.year,
          country: track.country,
          decade: String(decade),
          mood,
        });
      } catch {
        // Honcho save failure is non-fatal
      }

      tracksPlayed++;
      if (country && !regionsVisited.includes(country)) {
        regionsVisited.push(country);
      }

      // 11. Wait most of the track duration, then start preparing next
      // This ensures the next track is queued before the current one ends (no dead air)
      const trackDurationMs = (track.length || 180) * 1000;
      const totalMs = rendered.durationMs + trackDurationMs;
      // Start prepping next track 30s before current ends (or half, if short)
      const prepLeadMs = Math.min(30000, totalMs * 0.4);
      const waitMs = Math.max(5000, totalMs - prepLeadMs);
      console.log(`[crate-digger] Track #${tracksPlayed} (${regionsVisited.length} regions). Next prep in ~${Math.round(waitMs / 1000)}s`);
      await Bun.sleep(waitMs);

    } catch (err) {
      console.error("[crate-digger] Loop error:", err);
      await Bun.sleep(10000);
    }
  }
}

if (import.meta.main) {
  runCrateDiggerLoop().catch(console.error);
}
