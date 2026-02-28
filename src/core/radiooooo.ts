// Radiooooo API client -- TypeScript port of radio5 Ruby gem
// https://github.com/ocvit/radio5
// 95% of functionality requires no authentication.

// --- Types ---

export type Decade = 1900 | 1910 | 1920 | 1930 | 1940 | 1950 | 1960 | 1970 | 1980 | 1990 | 2000 | 2010 | 2020;
export type Mood = "slow" | "fast" | "weird";

export type RadioooooTrack = {
  id: string;
  uuid: string;
  title: string;
  artist: string;
  album: string;
  year: string;
  country: string;
  decade: Decade;
  mood: Mood;
  label: string;
  length: number;
  audioUrl: string;
  audioUrlOgg: string;
  coverUrl: string;
};

export type RadioooooQuery = {
  decades: Decade[];
  country?: string;       // ISO code, e.g. "FRA", "JPN"
  moods?: Mood[];
};

export type CountryMoods = {
  country: string;
  moods: Mood[];
};

export type Island = {
  id: string;
  name: string;
  description: string;
};

// --- Constants ---

const BASE_URL = "https://radiooooo.com";

export const ALL_DECADES: Decade[] = [
  1900, 1910, 1920, 1930, 1940, 1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020,
];

export const ALL_MOODS: Mood[] = ["slow", "fast", "weird"];

// --- Helpers ---

function stripTimeLimit(url: string): string {
  return url.replace(/#t=\d*,\d+/, "");
}

function parseTrack(data: Record<string, unknown>): RadioooooTrack {
  const links = (data.links || {}) as Record<string, string>;
  const cover = data.image || data.cover;
  const coverUrl = typeof cover === "string" ? cover
    : (cover && typeof cover === "object" && "full" in (cover as Record<string, unknown>))
      ? String((cover as Record<string, string>).full)
      : "";

  return {
    id: String(data._id || data.id || ""),
    uuid: String(data.uuid || ""),
    title: String(data.title || "Unknown"),
    artist: String(data.artist || "Unknown"),
    album: String(data.album || ""),
    year: String(data.year || ""),
    country: String(data.country || ""),
    decade: Number(data.decade || 0) as Decade,
    mood: String(data.mood || "slow").toLowerCase() as Mood,
    label: String(data.label || ""),
    length: Number(data.length || 0),
    audioUrl: stripTimeLimit(String(links.mpeg || links.mp3 || "")),
    audioUrlOgg: stripTimeLimit(String(links.ogg || "")),
    coverUrl: String(coverUrl),
  };
}

// --- API Client ---

export async function randomTrack(query: RadioooooQuery): Promise<RadioooooTrack | null> {
  const moods = (query.moods || ALL_MOODS).map((m) => m.toUpperCase());
  const body = {
    mode: "explore",
    isocodes: query.country ? [query.country] : [],
    decades: query.decades,
    moods,
  };

  const res = await fetch(`${BASE_URL}/play`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Radiooooo API error: ${res.status}`);
  }

  const data = await res.json() as Record<string, unknown>;
  return parseTrack(data);
}

export async function getTrack(trackId: string): Promise<RadioooooTrack | null> {
  const res = await fetch(`${BASE_URL}/track/play/${trackId}`, {
    headers: { "Accept": "application/json" },
  });

  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Radiooooo track error: ${res.status}`);
  }

  const data = await res.json() as Record<string, unknown>;
  return parseTrack(data);
}

export async function islandTrack(
  islandId: string,
  moods: Mood[] = ALL_MOODS
): Promise<RadioooooTrack | null> {
  const body = {
    mode: "islands",
    island: islandId,
    moods: moods.map((m) => m.toUpperCase()),
  };

  const res = await fetch(`${BASE_URL}/play`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Radiooooo island track error: ${res.status}`);
  }

  const data = await res.json() as Record<string, unknown>;
  return parseTrack(data);
}

export async function countriesForDecade(decade: Decade): Promise<CountryMoods[]> {
  const res = await fetch(`${BASE_URL}/country/mood?decade=${decade}`, {
    headers: { "Accept": "application/json" },
  });

  if (!res.ok) throw new Error(`Radiooooo countries error: ${res.status}`);
  const data = await res.json() as Record<string, string[]>;

  // API returns { Slow: [...], Fast: [...], Weird: [...] } -- normalize keys
  const byMood: Record<string, string[]> = {};
  for (const [key, countries] of Object.entries(data)) {
    byMood[key.toLowerCase()] = countries;
  }

  const countryMap = new Map<string, Mood[]>();
  for (const mood of ALL_MOODS) {
    for (const country of byMood[mood] || []) {
      if (!countryMap.has(country)) countryMap.set(country, []);
      countryMap.get(country)!.push(mood);
    }
  }

  return Array.from(countryMap.entries()).map(([country, moods]) => ({
    country,
    moods,
  }));
}

export async function getIslands(): Promise<Island[]> {
  const res = await fetch(`${BASE_URL}/islands`, {
    headers: { "Accept": "application/json" },
  });

  if (!res.ok) throw new Error(`Radiooooo islands error: ${res.status}`);
  const data = await res.json() as Array<Record<string, string>>;

  return data.map((island) => ({
    id: String(island._id || island.id || ""),
    name: String(island.name || ""),
    description: String(island.description || ""),
  }));
}

export async function downloadTrack(audioUrl: string): Promise<Buffer> {
  const res = await fetch(audioUrl);
  if (!res.ok) throw new Error(`Track download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function downloadAndTagTrack(
  track: RadioooooTrack,
  stationName?: string
): Promise<string> {
  const { remuxWithMetadata } = await import("./audio.js");
  const { join } = await import("node:path");
  const { writeFileSync, mkdirSync, unlinkSync } = await import("node:fs");

  const tmpDir = join(import.meta.dir, "..", "..", ".tmp");
  mkdirSync(tmpDir, { recursive: true });

  const buf = await downloadTrack(track.audioUrl);
  const rawPath = join(tmpDir, `raw-${Date.now()}-${track.id}.mp3`);
  writeFileSync(rawPath, buf);

  const taggedPath = join(tmpDir, `tagged-${Date.now()}-${track.id}.mp3`);
  await remuxWithMetadata(rawPath, {
    title: track.title,
    artist: track.artist,
    album: track.album || `Radiooooo ${track.country} ${track.decade}s`,
    year: track.year,
    genre: `${track.country} ${track.mood}`,
    comment: `Radiooooo ${track.country} ${track.decade}s`,
    station: stationName,
  }, taggedPath);

  try { unlinkSync(rawPath); } catch { /* ignore */ }
  return taggedPath;
}
