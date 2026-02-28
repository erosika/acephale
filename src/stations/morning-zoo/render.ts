import { join } from "node:path";
import { mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { synthesizeSpeech } from "../../core/tts.js";
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

  const segments: AudioSegment[] = [];
  let totalDurationMs = 0;
  let prevSpeaker: string | null = null;

  const spokenLines = script.lines.filter((l) => !l.text.startsWith("[MUSIC:"));

  for (let i = 0; i < spokenLines.length; i++) {
    const line = spokenLines[i];
    const agent = roster.find((a) => a.name === line.speaker);
    const voiceName = agent?.voice || "en-US-Chirp3-HD-Puck";

    const result = await synthesizeSpeech(line.text, voiceName, {
      ssml: !!line.ssml_hints,
    });

    // Insert gap before this segment (not before the first one)
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

  // Concatenate with no additional gaps (gaps are already in segments)
  await concatAudio(segments, wavPath, 0);
  const normPath = await normalizeAudio(wavPath);
  await convertToMp3(normPath, mp3Path);

  return { mp3Path, wavPath: normPath, durationMs: totalDurationMs, lineCount: script.lines.length };
}
