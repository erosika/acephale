// Radiooooo API client -- TypeScript port of radio5 Ruby gem
// https://github.com/ocvit/radio5
// 95% of functionality requires no authentication.

// --- Types ---

export type Decade = 1900 | 1910 | 1920 | 1930 | 1940 | 1950 | 1960 | 1970 | 1980 | 1990 | 2000 | 2010 | 2020;
export type Mood = "slow" | "fast" | "weird";

export type RadioooooTrack = {
  id: string;
  title: string;
  artist: string;
  album: string;
  year: number;
  country: string;
  decade: Decade;
  label: string;
  length: number;
  audioUrl: string;
  audioUrlOgg: string;
  coverUrl: string;
};

export type RadioooooQuery = {
  decade: Decade;
  countries?: string[];
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
const API_URL = `${BASE_URL}/api`;

export const ALL_DECADES: Decade[] = [
  1900, 1910, 1920, 1930, 1940, 1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020,
];

// --- API Client ---

export async function randomTrack(query: RadioooooQuery): Promise<RadioooooTrack | null> {
  const params: Record<string, string> = {
    decade: query.decade.toString(),
  };

  if (query.moods && query.moods.length > 0) {
    params.moods = query.moods.join(",");
  }
  if (query.countries && query.countries.length > 0) {
    params.countries = query.countries.join(",");
  }

  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${API_URL}/radio/play?${qs}`, {
    headers: { "Accept": "application/json" },
  });

  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Radiooooo API error: ${res.status}`);
  }

  const data = await res.json() as Record<string, unknown>;
  const links = (data.links || {}) as Record<string, string>;

  return {
    id: String(data.id || ""),
    title: String(data.title || "Unknown"),
    artist: String(data.artist || "Unknown"),
    album: String(data.album || ""),
    year: Number(data.year || query.decade),
    country: String(data.country || ""),
    decade: query.decade,
    label: String(data.label || ""),
    length: Number(data.length || 0),
    audioUrl: String(links.mp3 || data.audio_url || ""),
    audioUrlOgg: String(links.ogg || ""),
    coverUrl: String(data.cover || data.image || ""),
  };
}

export async function countriesForDecade(decade: Decade): Promise<CountryMoods[]> {
  const res = await fetch(`${API_URL}/radio/countries?decade=${decade}`, {
    headers: { "Accept": "application/json" },
  });

  if (!res.ok) throw new Error(`Radiooooo countries error: ${res.status}`);
  const data = await res.json() as Record<string, string[]>;

  return Object.entries(data).map(([country, moods]) => ({
    country,
    moods: moods as Mood[],
  }));
}

export async function getIslands(): Promise<Island[]> {
  const res = await fetch(`${API_URL}/islands`, {
    headers: { "Accept": "application/json" },
  });

  if (!res.ok) throw new Error(`Radiooooo islands error: ${res.status}`);
  const data = await res.json() as Array<Record<string, string>>;

  return data.map((island) => ({
    id: String(island.id || ""),
    name: String(island.name || ""),
    description: String(island.description || ""),
  }));
}

export async function downloadTrack(audioUrl: string): Promise<Buffer> {
  const res = await fetch(audioUrl);
  if (!res.ok) throw new Error(`Track download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
