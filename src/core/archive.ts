// Station archive -- JSONL manifest tracking what played when

import { appendFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

// --- Types ---

export type ArchiveEntry = {
  station: string;
  timestamp: number;
  title: string;
  artist: string;
  year?: string;
  country?: string;
  duration?: number;
  archiveFile?: string;
};

// --- Config ---

const ARCHIVE_DIR = join(import.meta.dir, "..", "..", "archive");
const MANIFEST_PATH = join(ARCHIVE_DIR, "manifest.jsonl");

// --- Public API ---

export function logArchiveEntry(entry: ArchiveEntry): void {
  mkdirSync(dirname(MANIFEST_PATH), { recursive: true });
  appendFileSync(MANIFEST_PATH, JSON.stringify(entry) + "\n");
}

export function getArchiveEntries(opts?: {
  station?: string;
  since?: number;
  limit?: number;
}): ArchiveEntry[] {
  if (!existsSync(MANIFEST_PATH)) return [];

  const raw = readFileSync(MANIFEST_PATH, "utf-8");
  let entries: ArchiveEntry[] = raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ArchiveEntry);

  if (opts?.station) {
    entries = entries.filter((e) => e.station === opts.station);
  }
  if (opts?.since) {
    entries = entries.filter((e) => e.timestamp >= opts.since!);
  }

  // Most recent first
  entries.sort((a, b) => b.timestamp - a.timestamp);

  if (opts?.limit) {
    entries = entries.slice(0, opts.limit);
  }

  return entries;
}
