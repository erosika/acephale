import { join } from "node:path";
import { loadAgentRoster, getEnv } from "../../core/config.js";
import { getAgentMemory, saveZooEpisode } from "../../core/honcho.js";
import { queueTrack } from "../../core/stream.js";
import { getZooHosts, type ZooHost } from "./hosts.js";
import { gatherSources } from "./sources.js";
import { generateScript, type EpisodeScript } from "./script.js";
import { renderEpisode, type RenderedEpisode } from "./render.js";

// --- Types ---

export type EpisodeResult = {
  script: EpisodeScript;
  rendered: RenderedEpisode;
  timestamp: string;
};

// --- Episode Pipeline ---

export async function generateEpisode(): Promise<EpisodeResult> {
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
  console.log(`[morning-zoo] Gathered ${sources.length} content sources`);

  // 4. Generate script
  const script = await generateScript(hostsWithMemory, sources, 16);
  console.log(`[morning-zoo] Script: "${script.title}" (${script.lines.length} lines)`);

  // 5. Render audio
  const episodesDir = join(import.meta.dir, "..", "..", "..", "episodes");
  const rendered = await renderEpisode(script, roster, episodesDir);
  console.log(`[morning-zoo] Rendered: ${rendered.mp3Path} (~${Math.round(rendered.durationMs / 1000)}s)`);

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
      const result = await generateEpisode();
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
