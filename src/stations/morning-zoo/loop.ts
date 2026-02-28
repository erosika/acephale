import { join } from "node:path";
import { loadAgentRoster, getEnv } from "../../core/config.js";
import { getAgentMemory, saveZooEpisode } from "../../core/honcho.js";
import { queueTrack } from "../../core/stream.js";
import { getZooHosts, type ZooHost } from "./hosts.js";
import { gatherSources } from "./sources.js";
import { generateScript, type EpisodeScript } from "./script.js";
import { renderEpisode, type RenderedEpisode } from "./render.js";
import { pickNextCall, processCallVoice, type CallRequest } from "../../core/calls.js";
import { mixVoiceOverMusic } from "../../core/audio.js";

// --- Types ---

export type EpisodeResult = {
  script: EpisodeScript;
  rendered: RenderedEpisode;
  timestamp: string;
};

// --- Episode Pipeline ---

export async function generateEpisode(call?: CallRequest): Promise<EpisodeResult> {
  const timestamp = new Date().toISOString();
  console.log(`[morning-zoo] Starting episode generation at ${timestamp}`);

  // 1. Load hosts
  const roster = loadAgentRoster();
  const hosts = getZooHosts(roster);
  console.log(`[morning-zoo] Hosts: ${hosts.map((h) => h.name).join(", ")}`);

  // 2. Fetch memories
  const hostsWithMemory: ZooHost[] = await Promise.all(
    hosts.map(async (host) => {
      let memories: string[] = [];
      try {
        memories = await getAgentMemory(host.honchoUser);
      } catch {
        console.log(`[morning-zoo] No memories for ${host.name} (first episode?)`);
      }
      return { ...host, memories };
    })
  );

  // 3. Gather content sources
  const sources = await gatherSources(undefined, true);
  if (call) {
    sources.push({
      title: "Listener Call In",
      summary: `Someone just called into the show and said: "${call.text}"`,
      type: "listener_call",
      timestamp: Date.now()
    });
  }
  console.log(`[morning-zoo] Gathered ${sources.length} content sources`);

  // 4. Generate script
  const script = await generateScript(hostsWithMemory, sources, 16);
  console.log(`[morning-zoo] Script: "${script.title}" (${script.lines.length} lines)`);

  // 5. Render audio
  const episodesDir = join(import.meta.dir, "..", "..", "..", "episodes");
  let rendered = await renderEpisode(script, roster, episodesDir);
  console.log(`[morning-zoo] Rendered: ${rendered.mp3Path} (~${Math.round(rendered.durationMs / 1000)}s)`);

  // 5b. Prepend Caller Voice if present
  if (call) {
    const callerVoice = await processCallVoice(call);
    const tmpDir = join(import.meta.dir, "..", "..", "..", ".tmp");
    const finalMp3 = join(tmpDir, `zoo-with-caller-${Date.now()}.mp3`);
    
    // We can just concat them: callerVoice -> brief silence -> rendered episode
    const { concatAudio, generateSilence, convertToMp3, normalizeAudio } = await import("../../core/audio.js");
    const { readFileSync, unlinkSync } = await import("node:fs");
    
    const silPath = join(tmpDir, `zoo-sil-${Date.now()}.wav`);
    await generateSilence(1500, silPath);
    
    // The rendered episode is currently mp3, but concatAudio needs WAVs/Buffers.
    // Wait, concatAudio takes { audio: Buffer }... We might need to mixVoiceOverMusic or just concat.
    // Actually, `mixVoiceOverMusic` has a delay argument. If we just want the caller then the episode...
    // Let's use ffmpeg concat demuxer via a simple spawn since rendered is mp3.
    const { runFfmpeg } = await import("../../core/audio.js");
    // Convert caller to MP3 so we can concat MP3s
    const callerMp3 = join(tmpDir, `zoo-caller-${Date.now()}.mp3`);
    await convertToMp3(callerVoice.wavPath, callerMp3);

    // Concat callerMp3 and rendered.mp3Path
    const listPath = join(tmpDir, `zoo-concat-${Date.now()}.txt`);
    const { writeFileSync } = await import("node:fs");
    writeFileSync(listPath, `file '${callerMp3}'\nfile '${rendered.mp3Path}'`);

    await runFfmpeg(["-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", finalMp3]);

    try { unlinkSync(silPath); } catch {}
    try { unlinkSync(callerVoice.wavPath); } catch {}
    try { unlinkSync(callerMp3); } catch {}
    try { unlinkSync(listPath); } catch {}
    try { unlinkSync(rendered.mp3Path); } catch {} // remove original

    rendered.mp3Path = finalMp3;
    rendered.durationMs += callerVoice.durationMs + 1000;
  }

  // 6. Save transcript to Honcho -- one session, each line attributed to correct peer
  try {
    const peerMap: Record<string, string> = {};
    for (const host of hostsWithMemory) {
      peerMap[host.name] = host.honchoUser;
    }
    await saveZooEpisode(peerMap, script.title, script.topic, script.lines);
  } catch (err) {
    console.log(`[morning-zoo] Failed to save episode memory: ${err}`);
  }

  return { script, rendered, timestamp };
}

// --- Queue + Loop ---

export async function queueEpisode(result: EpisodeResult): Promise<void> {
  try {
    await queueTrack("morning-zoo", result.rendered.mp3Path);
    console.log(`[morning-zoo] Queued episode in liquidsoap`);
  } catch (err) {
    console.log(`[morning-zoo] Failed to queue (liquidsoap not running?): ${err}`);
  }
}

export async function runLoop(): Promise<void> {
  const intervalMinutes = parseInt(getEnv("EPISODE_INTERVAL_MINUTES", "15"), 10);
  console.log(`[morning-zoo] Starting episode loop (interval: ${intervalMinutes}min)`);

  let episodeCount = 0;
  let consecutiveFailures = 0;

  while (true) {
    try {
      // 0. Check for calls
      const call = pickNextCall("morning-zoo");
      if (call) {
        console.log(`[morning-zoo] Processing call from ${call.type === 'user_voice' ? 'real user' : 'AI'}...`);
        try {
          const { saveCall } = await import("../../core/honcho.js");
          await saveCall("morning-zoo", call.id, call.text);
        } catch (err) {
          console.error(`[morning-zoo] Failed to save call to Honcho:`, err);
        }
      }

      const result = await generateEpisode(call || undefined);
      await queueEpisode(result);
      episodeCount++;
      consecutiveFailures = 0;

      // Start prepping next episode before this one finishes -- no dead air
      const prepLeadMs = Math.min(30000, result.rendered.durationMs * 0.4);
      const waitMs = Math.max(5000, result.rendered.durationMs - prepLeadMs);
      console.log(`[morning-zoo] Episode #${episodeCount} queued (~${Math.round(result.rendered.durationMs / 1000)}s). Next prep in ~${Math.round(waitMs / 1000)}s`);
      await Bun.sleep(waitMs);
    } catch (err) {
      consecutiveFailures++;
      const backoffMs = Math.min(5 * 60_000, 30_000 * consecutiveFailures);
      console.error(`[morning-zoo] Episode generation failed (attempt ${consecutiveFailures}, retry in ${Math.round(backoffMs / 1000)}s):`, err);
      await Bun.sleep(backoffMs);
    }
  }
}

if (import.meta.main) {
  runLoop().catch(console.error);
}
