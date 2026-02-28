import type { AgentConfig } from "../../core/config.js";
import { getStationAgents } from "../../core/config.js";

// --- Types ---

export type ZooHost = AgentConfig & {
  memories: string[];
};

// --- Host Selection ---

export function getZooHosts(roster: AgentConfig[]): AgentConfig[] {
  return getStationAgents(roster, "morning-zoo");
}

export function buildHostContext(host: ZooHost): string {
  const memoryBlock = host.memories.length > 0
    ? `\nPrevious context and opinions:\n${host.memories.map((m) => `- ${m}`).join("\n")}`
    : "";

  return [
    `Name: ${host.name}`,
    `Role: ${host.role}`,
    `Personality: ${host.personality}`,
    memoryBlock,
  ].filter(Boolean).join("\n");
}
