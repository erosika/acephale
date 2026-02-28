import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { synthesizeSpeech, type SynthesisResult } from "../../core/tts.js";
import {
  concatAudio, normalizeAudio, convertToMp3, generateSilence,
  runFfmpeg, probeDuration, type AudioSegment,
} from "../../core/audio.js";
import { randomTrack, downloadTrack, type Decade } from "../../core/radiooooo.js";
import { generateLyriaCustomTrack } from "../../core/lyria.js";
import type { AgentConfig } from "../../core/config.js";
import type { EpisodeScript, ScriptLine } from "./script.js";

// --- Types ---

export type RenderedEpisode = {
  mp3Path: string;
  wavPath: string;
  durationMs: number;
  lineCount: number;
};

// --- Constants ---

const TTS_CONCURRENCY = 4;
const MUSIC_CLIP_SECONDS = 30;

// --- Music Sourcing ---

function parseMusicMarker(
  text: string
): { artist: string; title: string; decade: Decade; country: string } | null {
  const match = text.match(
    /\[MUSIC:\s*(.+?)\s*[-\u2013\u2014]\s*(.+?),\s*(\d{4})s?,\s*([A-Za-z]{2,3})\s*\]/i
  );
  if (!match) return null;
  const decadeRaw = parseInt(match[3]);
  const decade = (Math.floor(decadeRaw / 10) * 10) as Decade;
  return {
    artist: match[1].trim(),
    title: match[2].trim(),
    decade,
    country: match[4].trim().toUpperCase(),
  };
}

/** Convert any audio to episode WAV format (24kHz mono 16-bit), trim + fade. Returns actual duration in ms. */
async function toEpisodeWav(
  input: string,
  output: string,
  maxSeconds?: number
): Promise<number> {
  const inputDuration = await probeDuration(input);
  const duration = maxSeconds ? Math.min(inputDuration, maxSeconds) : inputDuration;
  if (duration <= 0) throw new Error(`Input has no duration: ${input}`);

  const fadeIn = 1;
  const fadeOut = Math.min(3, duration * 0.3);
  const fadeOutStart = Math.max(0, duration - fadeOut);

  const args = ["-i", input];
  if (maxSeconds) args.push("-t", maxSeconds.toString());
  args.push(
    "-af", `afade=t=in:st=0:d=${fadeIn},afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeOut.toFixed(3)}`,
    "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le",
    output
  );
  await runFfmpeg(args);
  return duration * 1000;
}

async function sourceMusicClip(
  text: string,
  tmpDir: string
): Promise<{ audio: Buffer; label: string; durationMs: number } | null> {
  const marker = parseMusicMarker(text);
  if (!marker) {
    console.log(`[morning-zoo] Could not parse music marker: ${text}`);
    return null;
  }

  mkdirSync(tmpDir, { recursive: true });
  const stamp = Date.now();

  // Try Radiooooo -- first decade+country, then decade only
  for (const query of [
    { decades: [marker.decade] as Decade[], country: marker.country },
    { decades: [marker.decade] as Decade[] },
  ]) {
    try {
      const track = await randomTrack(query);
      if (track?.audioUrl) {
        console.log(
          `[morning-zoo] Radiooooo: "${track.artist} - ${track.title}" (${track.year}, ${track.country})`
        );
        const mp3Buf = await downloadTrack(track.audioUrl);
        const rawMp3 = join(tmpDir, `music-raw-${stamp}.mp3`);
        writeFileSync(rawMp3, mp3Buf);

        const clipWav = join(tmpDir, `music-clip-${stamp}.wav`);
        const durationMs = await toEpisodeWav(rawMp3, clipWav, MUSIC_CLIP_SECONDS);
        try { unlinkSync(rawMp3); } catch {}

        const { existsSync, readFileSync } = await import("node:fs");
        if (!existsSync(clipWav)) {
          throw new Error(`Radiooooo clip generation failed, file not found at ${clipWav}`);
        }

        const audio = readFileSync(clipWav);
        try { unlinkSync(clipWav); } catch {}

        return {
          audio,
          label: `MUSIC: ${track.artist} - ${track.title} (${track.year})`,
          durationMs,
        };
      }
    } catch (err) {
      console.log(`[morning-zoo] Radiooooo failed (${query.country || "any country"}): ${err}`);
    }
  }

  // Fallback: Lyria
  try {
    console.log(`[morning-zoo] Lyria fallback for "${marker.artist} - ${marker.title}"`);
    const result = await generateLyriaCustomTrack(
      `${marker.decade}s pop in the style of ${marker.artist}, like "${marker.title}"`,
      MUSIC_CLIP_SECONDS
    );
    const clipWav = join(tmpDir, `music-clip-${stamp}.wav`);
    const durationMs = await toEpisodeWav(result.mp3Path, clipWav, MUSIC_CLIP_SECONDS);
    try { unlinkSync(result.mp3Path); } catch {}

    const { existsSync, readFileSync } = await import("node:fs");
    if (!existsSync(clipWav)) {
      throw new Error(`Lyria clip generation failed, file not found at ${clipWav}`);
    }

    const audio = readFileSync(clipWav);
    try { unlinkSync(clipWav); } catch {}

    return {
      audio,
      label: `MUSIC (Lyria): ${marker.artist} style`,
      durationMs,
    };
  } catch (err) {
    console.log(`[morning-zoo] Lyria fallback also failed: ${err}`);
  }

  return null;
}

// --- TTS ---

async function synthesizeAll(
  lines: Array<{ speaker: string; text: string; ssml_hints?: string }>,
  roster: AgentConfig[]
): Promise<SynthesisResult[]> {
  const results: SynthesisResult[] = new Array(lines.length);

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
  const tmpDir = join(outputDir, "..", ".tmp");

  // Categorize lines into speech vs music
  const speechEntries: Array<{ idx: number; line: ScriptLine }> = [];
  const musicEntries: Array<{ idx: number; line: ScriptLine }> = [];

  for (let i = 0; i < script.lines.length; i++) {
    const line = script.lines[i];
    if (line.text.startsWith("[MUSIC:")) {
      musicEntries.push({ idx: i, line });
    } else {
      speechEntries.push({ idx: i, line });
    }
  }

  // Synthesize speech + source music in parallel
  console.log(
    `[morning-zoo] Rendering: ${speechEntries.length} speech lines, ${musicEntries.length} music clips`
  );

  const [ttsResults, musicResults] = await Promise.all([
    synthesizeAll(speechEntries.map((s) => s.line), roster),
    Promise.all(musicEntries.map(async (m) => {
      const result = await sourceMusicClip(m.line.text, tmpDir);
      // Ensure file exists by forcing a tiny delay
      await new Promise(r => setTimeout(r, 100));
      return result;
    })),
  ]);

  // Build lookup maps by original line index
  const speechByIdx = new Map<number, SynthesisResult>();
  speechEntries.forEach((s, i) => speechByIdx.set(s.idx, ttsResults[i]));

  const musicByIdx = new Map<number, { audio: Buffer; label: string; durationMs: number } | null>();
  musicEntries.forEach((m, i) => musicByIdx.set(m.idx, musicResults[i]));

  // Assemble segments in script order
  const segments: AudioSegment[] = [];
  let totalDurationMs = 0;
  let prevSpeaker: string | null = null;
  let prevWasMusic = false;

  for (let i = 0; i < script.lines.length; i++) {
    const line = script.lines[i];
    const isMusic = musicByIdx.has(i);

    // Gap between segments
    if (i > 0) {
      const gapMs = isMusic || prevWasMusic
        ? 1000
        : line.speaker === prevSpeaker ? 250 : 700;
      const silPath = join(tmpDir, `sil-${Date.now()}-${i}.wav`);
      await generateSilence(gapMs, silPath);
      const { existsSync } = await import("node:fs");
      // Check for ENOENT safely inside loop
      if (existsSync(silPath)) {
        segments.push({ audio: readFileSync(silPath), label: `gap-${gapMs}ms` });
      } else {
        console.warn(`[morning-zoo] WARNING: generated silence file missing: ${silPath}`);
      }
      totalDurationMs += gapMs;
      try { unlinkSync(silPath); } catch {}
    }

    if (isMusic) {
      const clip = musicByIdx.get(i);
      if (clip) {
        segments.push({ audio: clip.audio, label: clip.label });
        totalDurationMs += clip.durationMs;
      }
      prevWasMusic = true;
      prevSpeaker = null;
    } else {
      const result = speechByIdx.get(i);
      if (result) {
        segments.push({
          audio: result.audio,
          label: `${line.speaker}: ${line.text.slice(0, 40)}...`,
        });
        totalDurationMs += result.durationMs;
      }
      prevWasMusic = false;
      prevSpeaker = line.speaker;
    }
  }

  await concatAudio(segments, wavPath, 0);
  const normPath = await normalizeAudio(wavPath);
  await convertToMp3(normPath, mp3Path);

  return { mp3Path, wavPath: normPath, durationMs: totalDurationMs, lineCount: script.lines.length };
}
