// Call-in system -- Gemini Live bidirectional real-time audio
// Listeners press "call in" on current channel, enter a live conversation with the DJ.

import type { StationId, AgentConfig } from "./config.js";

// --- Types ---

export type CallState = "ringing" | "live" | "on_hold" | "ended";

export type Call = {
  id: string;
  station: StationId;
  listenerId: string;
  djAgent: string;
  state: CallState;
  startedAt: number;
  endedAt?: number;
  transcript: CallLine[];
};

export type CallLine = {
  speaker: "listener" | "dj";
  text: string;
  timestamp: number;
};

export type CallQueue = {
  station: StationId;
  waiting: string[];     // listener IDs
  active: Call | null;
  maxWait: number;       // max callers in queue
};

// --- Queue Management ---

const queues = new Map<StationId, CallQueue>();

export function getCallQueue(station: StationId): CallQueue {
  if (!queues.has(station)) {
    queues.set(station, {
      station,
      waiting: [],
      active: null,
      maxWait: 5,
    });
  }
  return queues.get(station)!;
}

export function enqueueCall(station: StationId, listenerId: string): boolean {
  const queue = getCallQueue(station);
  if (queue.waiting.length >= queue.maxWait) return false;
  if (queue.waiting.includes(listenerId)) return false;
  queue.waiting.push(listenerId);
  return true;
}

export function dequeueCall(station: StationId): string | null {
  const queue = getCallQueue(station);
  return queue.waiting.shift() || null;
}

export function startCall(
  station: StationId,
  listenerId: string,
  djAgent: AgentConfig
): Call {
  const call: Call = {
    id: `call-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    station,
    listenerId,
    djAgent: djAgent.id,
    state: "live",
    startedAt: Date.now(),
    transcript: [],
  };

  const queue = getCallQueue(station);
  queue.active = call;
  return call;
}

export function endCall(station: StationId): Call | null {
  const queue = getCallQueue(station);
  const call = queue.active;
  if (call) {
    call.state = "ended";
    call.endedAt = Date.now();
    queue.active = null;
  }
  return call;
}

export function holdCall(station: StationId): void {
  const queue = getCallQueue(station);
  if (queue.active) {
    queue.active.state = "on_hold";
  }
}

export function resumeCall(station: StationId): void {
  const queue = getCallQueue(station);
  if (queue.active && queue.active.state === "on_hold") {
    queue.active.state = "live";
  }
}

// --- Gemini Live Integration ---
// TODO: Implement bidirectional real-time audio via Gemini Live
// 1. Listener presses "call in" on current channel
// 2. Gemini Live handles real-time audio in both directions
// 3. DJ (Gemini) talks to caller in character
// 4. Other listeners hear the call broadcast live
// 5. DJ can put caller on hold, play a song, come back

export function buildCallSystemPrompt(dj: AgentConfig, memories: string[]): string {
  const memoryBlock = memories.length > 0
    ? `\nYour memories from previous shows:\n${memories.map((m) => `- ${m}`).join("\n")}`
    : "";

  return `You are ${dj.name}, a radio DJ on Acephale Radio's "${dj.station}" channel.
Personality: ${dj.personality}
${memoryBlock}

You are live on air and a listener has called in. Stay in character.
Be conversational, entertaining, and reactive. If they ask for music,
acknowledge the request and describe what you'll play.
Keep responses concise -- this is live radio, not a lecture.`;
}

export function _resetCallQueues(): void {
  queues.clear();
}
