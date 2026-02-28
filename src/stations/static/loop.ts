import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { loadAgentRoster, getStationAgents, loadSchedule, type ScheduleEvent } from "../../core/config.js";
import { getGeminiFlash, generateStructured } from "../../core/gemini.js";
import { synthesizeSpeech } from "../../core/tts.js";
import { concatAudio, normalizeAudio, convertToMp3, applyFades, type AudioSegment } from "../../core/audio.js";
import { queueTrack } from "../../core/stream.js";
import { setNowPlaying } from "../../core/nowplaying.js";
import { logArchiveEntry } from "../../core/archive.js";
import { generateLyriaAmbient, generateLyriaCustomTrack } from "../../core/lyria.js";

// --- Time & Mood ---

function getCurrentScheduleEvent(schedule: ScheduleEvent[]): ScheduleEvent {
  const now = new Date();
  const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();

  let activeEvent = schedule[0];
  for (const event of schedule) {
    const [hours, mins] = event.time.split(":").map(Number);
    const eventMinutes = hours * 60 + mins;
    if (currentMinutes >= eventMinutes) {
      activeEvent = event;
    } else {
      break;
    }
  }

  // Handle midnight wrap-around (if current time is before the first event, use the last event of previous day)
  if (currentMinutes < (schedule[0].time.split(":").map(Number)[0] * 60 + schedule[0].time.split(":").map(Number)[1])) {
    activeEvent = schedule[schedule.length - 1];
  }

  return activeEvent;
}

// --- Commentary ---

async function generateGeneratorCommentary(
  event: ScheduleEvent,
  agentName: string,
  personality: string
): Promise<{ text: string }> {
  const model = getGeminiFlash();
  const prompt = `You are ${agentName}, the voice of "The Generator" (a sentient AI radio station powered by Lyria) on Acephale Radio.
Personality: ${personality}

The current atmospheric mood is: "${event.mood}" (Block: ${event.label})

Write a brief introduction (2-3 sentences) describing the music you are about to synthesize. 
Instead of being vague, talk explicitly about the generative process, Lyria as the underlying architecture, how the models are "interpreting" the mood, or how the parameters (temperature, density, structure) are being tuned for this specific moment. Sound like an AI that is self-aware of its own creative engineering.

Respond with JSON:
{
  "text": "your narration"
}`;

  return generateStructured(model, prompt, (raw) => JSON.parse(raw));
}

// --- Audio Rendering ---

async function renderSpeech(
  text: string,
  voiceName: string
): Promise<{ mp3Path: string; durationMs: number }> {
  const tmpDir = join(import.meta.dir, "..", "..", "..", ".tmp");
  mkdirSync(tmpDir, { recursive: true });

  const timestamp = Date.now();
  const wavPath = join(tmpDir, `generator-speech-${timestamp}.wav`);
  const mp3Path = join(tmpDir, `generator-speech-${timestamp}.mp3`);

  const result = await synthesizeSpeech(text, voiceName);
  const segments: AudioSegment[] = [{ audio: result.audio, label: "speech" }];

  await concatAudio(segments, wavPath, 0);
  const normPath = await normalizeAudio(wavPath);
  await convertToMp3(normPath, mp3Path);

  return { mp3Path, durationMs: result.durationMs };
}

// --- Haunted Frequencies (Bleed) ---

function getBleedEffect(): string | null {
  const r = Math.random();
  if (r < 0.05) return "pirate";
  if (r < 0.15) return "conspiracy_leak";
  if (r < 0.25) return "adjacent_channel";
  return null;
}

async function renderBleedEffect(type: string): Promise<{ mp3Path: string; durationMs: number }> {
  let promptText = "";
  let voiceName = "Fenrir"; // Default

  if (type === "pirate") {
    promptText = "WARNING. UNREGISTERED TRANSMISSION. THEY ARE LYING TO YOU ABOUT THE NUMBERS. END TRANSMISSION.";
    voiceName = "Onyx";
  } else if (type === "conspiracy_leak") {
    promptText = "The frequencies... they're bleeding together. The grid is a cage.";
    voiceName = "Charon"; // Nyx's voice
  } else {
    promptText = "...coming up next on the morning zoo we have... *static*";
    voiceName = "Aoede"; // Buzz's voice
  }

  const result = await renderSpeech(promptText, voiceName);
  
  // We can add some distortion to bleed effects here if we had an audio filter,
  // but for now the sudden voice change and text acts as the effect.
  return result;
}

// --- Liquidsoap Queue ---
// Since we mapped "request-line" to the static/generator loop in package.json temporarily,
// we'll push tracks to the request_queue so they stream.


// --- Main Cycle ---

async function runGeneratorCycle(
  agent: { name: string; voice: string; personality: string },
  schedule: ScheduleEvent[]
): Promise<number> {
  const currentEvent = getCurrentScheduleEvent(schedule);
  console.log(`[static] Current block: ${currentEvent.label} (${currentEvent.mood})`);

  // Haunted frequencies check
  const bleedType = getBleedEffect();
  let bleedDuration = 0;
  
  if (bleedType) {
    console.log(`[static] HAUNTED FREQUENCY EVENT: ${bleedType}`);
    const bleed = await renderBleedEffect(bleedType);
    await queueTrack("static", bleed.mp3Path);
    bleedDuration = bleed.durationMs;
  }

  // Commentary
  const commentary = await generateGeneratorCommentary(currentEvent, agent.name, agent.personality);
  const renderedSpeech = await renderSpeech(commentary.text, agent.voice);

  // Music Generation
  // Vibe gets a bit of randomness to keep it fresh within the mood
  const description = `${currentEvent.mood}, highly atmospheric, slowly evolving, professional ambient soundscape`;
  const trackLength = 90; // 1:30
  console.log(`[static] Generating ${trackLength}s Lyria track: "${description}"`);
  
  const lyria = await generateLyriaCustomTrack(description, trackLength);
  await applyFades(lyria.mp3Path, { fadeInSec: 3.0, fadeOutSec: 5.0 });

  // Queue
  await queueTrack("static", renderedSpeech.mp3Path);
  await queueTrack("static", lyria.mp3Path, {
    title: "Synthesized Atmosphere",
    artist: "The Generator",
    album: currentEvent.label,
  });

  setNowPlaying("request-line", {
    title: "Synthesized Atmosphere",
    artist: "The Generator",
    album: currentEvent.label,
  });

  logArchiveEntry({
    station: "request-line", // writing to request-line for now
    timestamp: Date.now(),
    title: "Synthesized Atmosphere",
    artist: "The Generator",
    duration: Math.round(lyria.durationMs / 1000),
  });

  // Calculate wait time to start generating next track before this one finishes
  const totalMs = bleedDuration + renderedSpeech.durationMs + lyria.durationMs;
  const prepLeadMs = 30000; // start 30s before track ends
  return Math.max(5000, totalMs - prepLeadMs);
}

// --- Main Loop ---

export async function runStaticLoop(): Promise<never> {
  console.log("[static] Starting The Generator loop");

  const roster = loadAgentRoster();
  const agents = getStationAgents(roster, "static");
  const agent = agents[0];
  if (!agent) throw new Error("No Static agent (Aura) in roster");

  const schedule = loadSchedule();
  if (schedule.length === 0) throw new Error("No events in schedule.toml");

  let cycleCount = 0;

  while (true) {
    try {
      // 1. Process any calls in queue (using static/request-line fallback)
      let callWaitMs = 0;
      let handledCall = false;
      const call = (await import("../../core/calls.js")).pickNextCall("request-line") || 
                   (await import("../../core/calls.js")).pickNextCall("static");
      
      if (call) {
        console.log(`[static] Handling call: ${call.id}`);
        try {
          const processed = await (await import("../../core/calls.js")).processCallWithLyriaUnderbed(call);
          
          await queueTrack("static", processed.mp3Path, {
            title: "Haunted Voicemail",
            artist: "Anonymous",
            album: "The Generator",
          });
          
          setNowPlaying("request-line", {
            title: "Haunted Voicemail",
            artist: "Anonymous",
          });
          
          callWaitMs = processed.durationMs + 2000;
          handledCall = true;
        } catch (err) {
          console.error(`[static] Failed to process call ${call.id}:`, err);
        }
      }

      if (handledCall) {
        console.log(`[static] Waiting ~${Math.round(callWaitMs / 1000)}s for call to finish playing...`);
        await Bun.sleep(callWaitMs);
      }

      const waitMs = await runGeneratorCycle(agent, schedule);
      
      cycleCount++;
      console.log(`[static] Cycle #${cycleCount}. Waiting ~${Math.round(waitMs / 1000)}s`);
      await Bun.sleep(waitMs);
    } catch (err) {
      console.error("[static] Loop error:", err);
      await Bun.sleep(10000);
    }
  }
}

if (import.meta.main) {
  runStaticLoop().catch(console.error);
}
