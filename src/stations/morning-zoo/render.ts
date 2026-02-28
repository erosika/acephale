import { join } from "node:path";
import { mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { synthesizeSpeech, type SynthesisResult } from "../../core/tts.js";
import { concatAudio, normalizeAudio, convertToMp3, generateSilence, type AudioSegment } from "../../core/audio.js";
import type { AgentConfig } from "../../core/config.js";
import type { EpisodeScript } from "./script.js";

// --- Types ---

export type RenderedEpisode = {
  mp3Path: string;
  wavPath: string;
  durationMs: number;
  lineCount: number;
};

// --- Rendering ---

const TTS_CONCURRENCY = 4;

async function synthesizeAll(
  lines: Array<{ speaker: string; text: string; ssml_hints?: string }>,
  roster: AgentConfig[]
): Promise<SynthesisResult[]> {
  const results: SynthesisResult[] = new Array(lines.length);

  // Process in batches to avoid overwhelming the API
  for (let i = 0; i < lines.length; i += TTS_CONCURRENCY) {
    const batch = lines.slice(i, i + TTS_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((line) => {
        const agent = roster.find((a) => a.name === line.speaker);
        const voiceName = agent?.voice || "Puck";
        return synthesizeSpeech(line.text, voiceName, {
          ssml: !!line.ssml_hints,
        });
      })
    );
    for (let j = 0; j < batchResults.length; j++) {
      results[i + j] = batchResults[j];
    }
  }

  return results;
}

export async function renderEpisode(
  script: EpisodeScript,
  roster: AgentConfig[],
  outputDir: string
): Promise<RenderedEpisode> {
  mkdirSync(outputDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const baseName = `zoo-${timestamp}`;
  const wavPath = join(outputDir, `${baseName}.wav`);
  const mp3Path = join(outputDir, `${baseName}.mp3`);

  const spokenLines = script.lines.filter((l) => !l.text.startsWith("[MUSIC:"));

  // Synthesize all lines in parallel batches
  console.log(`[morning-zoo] Synthesizing ${spokenLines.length} lines (concurrency: ${TTS_CONCURRENCY})`);
  const ttsResults = await synthesizeAll(spokenLines, roster);

  // Assemble segments in order with gaps
  const segments: AudioSegment[] = [];
  let totalDurationMs = 0;
  let prevSpeaker: string | null = null;

  for (let i = 0; i < spokenLines.length; i++) {
    const line = spokenLines[i];
    const result = ttsResults[i];

    if (prevSpeaker !== null) {
      const sameSpeaker = line.speaker === prevSpeaker;
      const gapMs = sameSpeaker ? 250 : 700;
      const silPath = join(outputDir, `sil-${Date.now()}-${i}.wav`);
      await generateSilence(gapMs, silPath);
      segments.push({ audio: readFileSync(silPath), label: `gap-${gapMs}ms` });
      totalDurationMs += gapMs;
      try { unlinkSync(silPath); } catch {}
    }

    segments.push({
      audio: result.audio,
      label: `${line.speaker}: ${line.text.slice(0, 40)}...`,
    });

    totalDurationMs += result.durationMs;
    prevSpeaker = line.speaker;
  }

  await concatAudio(segments, wavPath, 0);
  const normPath = await normalizeAudio(wavPath);
  await convertToMp3(normPath, mp3Path);

  return { mp3Path, wavPath: normPath, durationMs: totalDurationMs, lineCount: script.lines.length };
}
