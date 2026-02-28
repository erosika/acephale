// Now-playing state -- in-memory per-station track info

// --- Types ---

export type NowPlaying = {
  station: string;
  title: string;
  artist: string;
  album?: string;
  year?: string;
  country?: string;
  startedAt: number;
  coverUrl?: string;
};

// --- State ---

const state = new Map<string, NowPlaying>();

// --- Public API ---

export function setNowPlaying(station: string, data: Omit<NowPlaying, "station" | "startedAt">): void {
  state.set(station, {
    ...data,
    station,
    startedAt: Date.now(),
  });
}

export function getNowPlaying(station: string): NowPlaying | null {
  return state.get(station) || null;
}

export function getAllNowPlaying(): Record<string, NowPlaying> {
  const result: Record<string, NowPlaying> = {};
  for (const [station, np] of state) {
    result[station] = np;
  }
  return result;
}

export function clearNowPlaying(station: string): void {
  state.delete(station);
}
