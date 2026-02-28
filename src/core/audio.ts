import { join } from "node:path";
import { writeFileSync, mkdirSync, unlinkSync } from "node:fs";

// --- Types ---

export type AudioSegment = {
  audio: Buffer;
  label?: string;
};

export type TrackMetadata = {
  title?: string;
  artist?: string;
  album?: string;
  year?: string;
  genre?: string;
  comment?: string;
  station?: string;
};

// --- ffmpeg Helpers ---

async function runFfmpeg(args: string[]): Promise<void> {
  const proc = Bun.spawn(["ffmpeg", "-y", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`ffmpeg failed (exit ${exitCode}): ${stderr}`);
  }
}

export async function concatAudio(
  segments: AudioSegment[],
  output: string,
  gapMs: number = 500
): Promise<string> {
  const tmpDir = join(import.meta.dir, "..", "..", ".tmp");
  mkdirSync(tmpDir, { recursive: true });

  // Write each segment + silence gap as individual files
  const files: string[] = [];
  const listPath = join(tmpDir, `concat-${Date.now()}.txt`);

  for (let i = 0; i < segments.length; i++) {
    const segPath = join(tmpDir, `seg-${Date.now()}-${i}.wav`);
    writeFileSync(segPath, segments[i].audio);
    files.push(segPath);

    // Add silence between segments (not after last)
    if (i < segments.length - 1 && gapMs > 0) {
      const silPath = join(tmpDir, `sil-${Date.now()}-${i}.wav`);
      await generateSilence(gapMs, silPath);
      files.push(silPath);
    }
  }

  // Write ffmpeg concat list
  const listContent = files.map((f) => `file '${f}'`).join("\n");
  writeFileSync(listPath, listContent);

  await runFfmpeg(["-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", output]);

  // Cleanup tmp files
  for (const f of files) {
    try { unlinkSync(f); } catch { /* ignore */ }
  }
  try { unlinkSync(listPath); } catch { /* ignore */ }

  return output;
}

export async function normalizeAudio(input: string, output?: string): Promise<string> {
  const out = output || input.replace(/\.wav$/, "-norm.wav");
  await runFfmpeg([
    "-i", input,
    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
    out,
  ]);
  return out;
}

export async function convertToMp3(
  input: string,
  output?: string,
  metadata?: TrackMetadata
): Promise<string> {
  const out = output || input.replace(/\.wav$/, ".mp3");
  const args = ["-i", input, "-codec:a", "libmp3lame", "-b:a", "192k"];
  if (metadata) args.push(...metadataFlags(metadata));
  args.push(out);
  await runFfmpeg(args);
  return out;
}

export async function remuxWithMetadata(
  input: string,
  metadata: TrackMetadata,
  output?: string
): Promise<string> {
  const out = output || input.replace(/\.mp3$/, "-tagged.mp3");

  // Probe input to check if it's actually MP3 or needs re-encoding
  const probe = Bun.spawn(
    ["ffprobe", "-v", "quiet", "-show_entries", "stream=codec_name", "-of", "csv=p=0", input],
    { stdout: "pipe", stderr: "pipe" }
  );
  const probeOut = await new Response(probe.stdout).text();
  const isMP3 = probeOut.trim().split("\n").some((l) => l.trim() === "mp3");

  if (isMP3) {
    // Pure remux -- no re-encoding
    await runFfmpeg([
      "-i", input,
      "-codec", "copy",
      "-map_metadata", "-1",
      ...metadataFlags(metadata),
      out,
    ]);
  } else {
    // Re-encode to MP3 (input is M4A/AAC/OGG/etc)
    await runFfmpeg([
      "-i", input,
      "-vn",
      "-codec:a", "libmp3lame",
      "-b:a", "192k",
      ...metadataFlags(metadata),
      out,
    ]);
  }

  return out;
}

function metadataFlags(meta: TrackMetadata): string[] {
  const flags: string[] = [];
  if (meta.title) flags.push("-metadata", `title=${meta.title}`);
  if (meta.artist) flags.push("-metadata", `artist=${meta.artist}`);
  if (meta.album) flags.push("-metadata", `album=${meta.album}`);
  if (meta.year) flags.push("-metadata", `date=${meta.year}`);
  if (meta.genre) flags.push("-metadata", `genre=${meta.genre}`);
  if (meta.comment) flags.push("-metadata", `comment=${meta.comment}`);
  if (meta.station) flags.push("-metadata", `album_artist=${meta.station}`);
  return flags;
}

// --- Duration Probe ---

export async function probeDuration(input: string): Promise<number> {
  const proc = Bun.spawn(
    ["ffprobe", "-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", input],
    { stdout: "pipe", stderr: "pipe" }
  );
  const out = await new Response(proc.stdout).text();
  return parseFloat(out.trim()) || 0;
}

// --- Fade In/Out ---

export async function applyFades(
  input: string,
  opts: { fadeInSec?: number; fadeOutSec?: number } = {}
): Promise<string> {
  const fadeIn = opts.fadeInSec ?? 0;
  const fadeOut = opts.fadeOutSec ?? 0;
  if (fadeIn === 0 && fadeOut === 0) return input;

  const duration = await probeDuration(input);
  if (duration <= 0) return input;

  const filters: string[] = [];
  if (fadeIn > 0) {
    filters.push(`afade=t=in:st=0:d=${fadeIn}`);
  }
  if (fadeOut > 0) {
    const fadeStart = Math.max(0, duration - fadeOut);
    filters.push(`afade=t=out:st=${fadeStart.toFixed(3)}:d=${fadeOut}`);
  }

  const out = input.replace(/\.mp3$/, "-faded.mp3");
  await runFfmpeg([
    "-i", input,
    "-af", filters.join(","),
    "-codec:a", "libmp3lame",
    "-b:a", "192k",
    out,
  ]);

  // Replace original with faded version
  try { unlinkSync(input); } catch {}
  const { renameSync } = await import("node:fs");
  renameSync(out, input);
  return input;
}

export async function generateSilence(durationMs: number, output: string): Promise<string> {
  const seconds = durationMs / 1000;
  await runFfmpeg([
    "-f", "lavfi",
    "-i", `anullsrc=r=24000:cl=mono`,
    "-t", seconds.toString(),
    "-c:a", "pcm_s16le",
    output,
  ]);
  return output;
}
