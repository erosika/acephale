import { join } from "node:path";
import { writeFileSync, mkdirSync, unlinkSync } from "node:fs";

// --- Types ---

export type AudioSegment = {
  audio: Buffer;
  label?: string;
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

export async function convertToMp3(input: string, output?: string): Promise<string> {
  const out = output || input.replace(/\.wav$/, ".mp3");
  await runFfmpeg([
    "-i", input,
    "-codec:a", "libmp3lame",
    "-b:a", "192k",
    out,
  ]);
  return out;
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
