import { join } from "node:path";
import { mkdirSync, unlinkSync } from "node:fs";
import { loadAgentRoster, getStationAgents, loadSchedule, type ScheduleEvent } from "../../core/config.js";
import { getGeminiFlash, generateStructured } from "../../core/gemini.js";
import { synthesizeSpeech } from "../../core/tts.js";
import { concatAudio, normalizeAudio, convertToMp3, applyFades, mixVoiceOverMusic, type AudioSegment } from "../../core/audio.js";
import { queueTrack } from "../../core/stream.js";
import { setNowPlaying } from "../../core/nowplaying.js";
import { logArchiveEntry } from "../../core/archive.js";
import { generateLyriaAmbient, generateLyriaCustomTrack } from "../../core/lyria.js";
import { processCallVoice, type CallRequest } from "../../core/calls.js";

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
  personality: string,
  callContext?: string,
  memories?: string[]
): Promise<{ text: string; title: string; track_prompt: string }> {
  const model = getGeminiFlash();
  const prompt = `You are ${agentName}, the voice of "The Generator" (a sentient AI radio station powered by Lyria) on Acephale Radio.
Personality: ${personality}

The current atmospheric mood from the station clock is: "${event.mood}" (Block: ${event.label})
You do NOT need to strictly adhere to this mood if the caller or your own AI intuition suggests a different direction.

${memories && memories.length > 0 ? `Your recent memories/interactions:\n${memories.map(m => `- ${m}`).join("\n")}` : ""}
${callContext ? `\nA listener just called in and said: ${callContext}\nYou MUST respond to them in your commentary and incorporate their request or vibe into the track you are generating.` : ""}

Write a brief introduction (2-3 sentences) describing the music you are about to synthesize. 
Instead of being vague, talk explicitly about the generative process, Lyria as the underlying architecture, how the models are "interpreting" the mood, or how the parameters (temperature, density, structure) are being tuned for this specific moment. Sound like an AI that is self-aware of its own creative engineering.

Also provide a short 2-5 word abstract title for the audio track being generated.
Also provide a 'track_prompt' that describes the audio for the Lyria generator model (e.g. "dark ambient drone, heavy sub bass, ethereal pads"). This should be influenced by the current mood, and heavily influenced by the caller if there was one.

Respond with JSON:
{
  "text": "your narration",
  "title": "Abstract Track Title",
  "track_prompt": "description of the track to generate"
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
    voiceName = "Charon"; // Swapped out Onyx since it isn't supported, using Charon
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
  agent: { name: string; voice: string; personality: string; honchoUser: string },
  schedule: ScheduleEvent[],
  call?: CallRequest,
  memories?: string[]
): Promise<number> {
  const currentEvent = getCurrentScheduleEvent(schedule);
  console.log(`[static] Current block: ${currentEvent.label} (${currentEvent.mood})`);

  // Haunted frequencies check (skip if there's a real caller)
  const bleedType = call ? null : getBleedEffect();
  let bleedDuration = 0;
  
  if (bleedType) {
    console.log(`[static] HAUNTED FREQUENCY EVENT: ${bleedType}`);
    const bleed = await renderBleedEffect(bleedType);
    await queueTrack("static", bleed.mp3Path);
    bleedDuration = bleed.durationMs;
  }

  // Commentary
  const callContext = call ? call.text : undefined;
  const commentary = await generateGeneratorCommentary(currentEvent, agent.name, agent.personality, callContext, memories);
  
  // Render DJ voice
  const renderedSpeech = await renderSpeech(commentary.text, agent.voice);

  // Process Caller voice (if any)
  let callerVoice: { wavPath: string; durationMs: number } | null = null;
  if (call) {
    callerVoice = await processCallVoice(call);
  }

  // Music Generation
  // Vibe gets a bit of randomness to keep it fresh within the mood
  const extraVibes = ["surreal", "glitching", "euphoric", "uneasy", "hypnotic", "drifting", "kinetic"];
  const randomVibe = extraVibes[Math.floor(Math.random() * extraVibes.length)];
  
  const speechTotalMs = (callerVoice ? callerVoice.durationMs + 1000 : 0) + renderedSpeech.durationMs;
  const trackLength = Math.max(90, Math.ceil(speechTotalMs / 1000) + 45); 
  const description = `${commentary.track_prompt}, ${randomVibe}, highly atmospheric, slowly evolving, professional ambient soundscape`;
  console.log(`[static] Generating ${trackLength}s Lyria track: "${description}"`);
  
  const lyria = await generateLyriaCustomTrack(description, trackLength);
  await applyFades(lyria.mp3Path, { fadeInSec: 3.0, fadeOutSec: 5.0 });

  // Mix Caller and/or DJ over the music
  const tmpDir = join(import.meta.dir, "..", "..", "..", ".tmp");
  const finalMp3 = join(tmpDir, `generator-final-${Date.now()}.mp3`);
  
  const voicesToMix: { path: string; delayMs?: number }[] = [];
  
  // Let the track fade in for 2 seconds before anyone speaks
  let currentDelay = 2000;
  
  if (callerVoice) {
    voicesToMix.push({ path: callerVoice.wavPath, delayMs: currentDelay });
    currentDelay = 1500; // Gap between caller and DJ
  }
  
  voicesToMix.push({ path: renderedSpeech.mp3Path.replace(".mp3", ".wav"), delayMs: currentDelay }); // We saved it as .wav originally in renderSpeech

  console.log(`[static] Mixing voice(s) over Lyria track...`);
  await mixVoiceOverMusic(voicesToMix, lyria.mp3Path, finalMp3, {
    title: commentary.title || "Synthesized Atmosphere",
    artist: "The Generator",
    album: currentEvent.label,
  });

  // Cleanup temps
  try { unlinkSync(lyria.mp3Path); } catch {}
  try { unlinkSync(renderedSpeech.mp3Path); } catch {}
  if (callerVoice) {
    try { unlinkSync(callerVoice.wavPath); } catch {}
  }

  // Queue
  await queueTrack("static", finalMp3);

  setNowPlaying("request-line", {
    title: commentary.title || "Synthesized Atmosphere",
    artist: "The Generator",
    album: currentEvent.label,
  });

  logArchiveEntry({
    station: "request-line", // writing to request-line for now
    timestamp: Date.now(),
    title: commentary.title || "Synthesized Atmosphere",
    artist: "The Generator",
    duration: Math.round(lyria.durationMs / 1000),
  });

  // Save to Honcho
  try {
    const { saveGeneratorCycle } = await import("../../core/honcho.js");
    await saveGeneratorCycle(agent.honchoUser, commentary.text, commentary.title, commentary.track_prompt);
  } catch {
    // Non-fatal
  }

  // Calculate wait time
  const totalMs = bleedDuration + lyria.durationMs;
  return totalMs;
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
      // 1. Check for calls
      const call = (await import("../../core/calls.js")).pickNextCall("static");
      
      if (call) {
        console.log(`[static] Processing call from ${call.type === 'user_voice' ? 'real user' : 'AI'}...`);
        try {
          // Save the caller to Honcho as a peer on the "static" channel
          const { saveCall } = await import("../../core/honcho.js");
          await saveCall("static", call.id, call.text);
        } catch (err) {
          console.error(`[static] Failed to save call to Honcho:`, err);
        }
      }

      // Fetch memories
      let memories: string[] = [];
      try {
        const { getAgentMemory } = await import("../../core/honcho.js");
        memories = await getAgentMemory(agent.honchoUser);
      } catch (err) {
        console.log(`[static] Failed to fetch memories:`, err);
      }

      console.log(`[static] Starting generator cycle. Call context present: ${!!call}`);
      // The call is passed directly into the generator cycle where it will be mixed over the music
      const waitMs = await runGeneratorCycle(agent, schedule, call || undefined, memories);
      
      const prepLeadMs = Math.min(30000, waitMs * 0.4);
      const sleepMs = Math.max(5000, waitMs - prepLeadMs);

      cycleCount++;
      console.log(`[static] Cycle #${cycleCount} queued. Waiting ~${Math.round(sleepMs / 1000)}s`);
      await Bun.sleep(sleepMs);
    } catch (err) {
      console.error("[static] Loop error:", err);
      await Bun.sleep(10000);
    }
  }
}

if (import.meta.main) {
  runStaticLoop().catch(console.error);
}
