import { readFileSync } from "node:fs";
import { join } from "node:path";

// --- Types ---

export type StationId =
  | "morning-zoo"
  | "crate-digger"
  | "conspiracy-hour"
  | "request-line"
  | "static";

export type AgentRole = "host" | "co-host";

export type AgentConfig = {
  id: string;
  name: string;
  station: StationId;
  role: AgentRole;
  personality: string;
  voice: string;
  honchoUser: string;
};

export type ScheduleEvent = {
  time: string;
  durationMinutes: number;
  mood: string;
  label: string;
};

export const STATIONS: Record<StationId, { name: string; format: string }> = {
  "morning-zoo": { name: "The Morning Zoo", format: "talk + pop music" },
  "crate-digger": { name: "The Crate Digger", format: "deep-cut music + commentary" },
  "conspiracy-hour": { name: "The Conspiracy Hour", format: "late-night talk + ambient" },
  "request-line": { name: "The Request Line", format: "listener-driven music + chat" },
  "static": { name: "Static", format: "interstitial noise + bleed" },
};

// --- Env ---

const REQUIRED_ENV = [
  "GEMINI_API_KEY",
] as const;

const OPTIONAL_ENV = [
  "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_TTS_API_KEY",
  "HONCHO_API_KEY",
  "HONCHO_BASE_URL",
  "ICECAST_HOST",
  "ICECAST_PORT",
  "ICECAST_SOURCE_PASSWORD",
  "LIQUIDSOAP_TELNET_PORT_ZOO",
  "LIQUIDSOAP_TELNET_PORT_CRATE",
  "LIQUIDSOAP_TELNET_PORT_CONSPIRACY",
  "LIQUIDSOAP_TELNET_PORT_REQUEST",
  "EPISODE_INTERVAL_MINUTES",
  "SOURCES_DIR",
  "RADIOOOOO_SESSION_ID",
] as const;

export function loadEnv(): Record<string, string> {
  const missing: string[] = [];
  for (const key of REQUIRED_ENV) {
    if (!process.env[key]) missing.push(key);
  }
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }

  const env: Record<string, string> = {};
  for (const key of [...REQUIRED_ENV, ...OPTIONAL_ENV]) {
    if (process.env[key]) env[key] = process.env[key]!;
  }
  return env;
}

export function getEnv(key: string, fallback?: string): string {
  const val = process.env[key] || fallback;
  if (!val) throw new Error(`Missing env var: ${key}`);
  return val;
}

// --- TOML Parser (minimal) ---

function parseToml(content: string): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  let currentSection = "";

  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      result[currentSection] = result[currentSection] || {};
      continue;
    }

    const kvMatch = line.match(/^(\w+)\s*=\s*"(.*)"\s*$/);
    if (kvMatch && currentSection) {
      result[currentSection][kvMatch[1]] = kvMatch[2];
    }
  }

  return result;
}

function parseScheduleToml(content: string): ScheduleEvent[] {
  const events: ScheduleEvent[] = [];
  let current: Partial<ScheduleEvent> = {};

  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    if (line === "[[events]]") {
      if (current.time) events.push(current as ScheduleEvent);
      current = {};
      continue;
    }

    const strMatch = line.match(/^(\w+)\s*=\s*"(.*)"\s*$/);
    if (strMatch) {
      const [, key, val] = strMatch;
      if (key === "time" || key === "mood" || key === "label") {
        current[key] = val;
      }
      continue;
    }

    const numMatch = line.match(/^(\w+)\s*=\s*(\d+)\s*$/);
    if (numMatch) {
      const [, key, val] = numMatch;
      if (key === "duration_minutes") {
        current.durationMinutes = parseInt(val, 10);
      }
    }
  }

  if (current.time) events.push(current as ScheduleEvent);
  return events;
}

// --- Loaders ---

const CONFIG_DIR = join(import.meta.dir, "..", "..", "config");

export function loadAgentRoster(configDir?: string): AgentConfig[] {
  const dir = configDir || CONFIG_DIR;
  const content = readFileSync(join(dir, "agents.toml"), "utf-8");
  const parsed = parseToml(content);

  return Object.entries(parsed).map(([id, fields]) => ({
    id,
    name: fields.name || id,
    station: (fields.station || "static") as StationId,
    role: (fields.role || "host") as AgentRole,
    personality: fields.personality || "",
    voice: fields.voice || "",
    honchoUser: fields.honcho_user || id,
  }));
}

export function getStationAgents(roster: AgentConfig[], station: StationId): AgentConfig[] {
  return roster.filter((a) => a.station === station);
}

export function loadSchedule(configDir?: string): ScheduleEvent[] {
  const dir = configDir || CONFIG_DIR;
  const content = readFileSync(join(dir, "schedule.toml"), "utf-8");
  return parseScheduleToml(content);
}
