import { getGeminiPro, generateStructured } from "../../core/gemini.js";
import type { ContentSource } from "./sources.js";
import { buildHostContext, type ZooHost } from "./hosts.js";

// --- Types ---

export type ScriptLine = {
  speaker: string;
  text: string;
  emotion: string;
  ssml_hints?: string;
};

export type EpisodeScript = {
  title: string;
  topic: string;
  speakers: string[];
  lines: ScriptLine[];
};

// --- Script Generation ---

function buildPrompt(
  hosts: ZooHost[],
  sources: ContentSource[],
  lineCount: number
): string {
  const hostBlock = hosts.map((h) => buildHostContext(h)).join("\n---\n");

  const sourceBlock = sources
    .map((s) => `[${s.type}] ${s.title}: ${s.summary}`)
    .join("\n");

  return `You are writing a dialogue script for "The Morning Zoo" on Acephale Radio.
This is a talk show with two co-hosts who bicker about everything.
Between talk segments, they introduce pop songs from Radiooooo.

## Hosts
${hostBlock}

## Today's Content
${sourceBlock}

## Instructions
- Generate a natural, entertaining dialogue of exactly ${lineCount} lines
- The hosts DISAGREE about almost everything. One is obnoxiously enthusiastic, the other is contemptuous.
- Include: bickering, callbacks to previous episodes, teasing each other, reacting to content
- They should reference other stations on Acephale Radio (Crate Digger, Conspiracy Hour, Request Line)
- They might plan or discuss pranks on other DJs
- Keep each line conversational (1-3 sentences max)
- Include moments where one host introduces a song: "[MUSIC: artist - title, decade, country]"

Respond with JSON:
{
  "title": "episode title",
  "topic": "main topic discussed",
  "speakers": ["host names"],
  "lines": [
    { "speaker": "name", "text": "what they say", "emotion": "enthusiastic|contemptuous|amused|annoyed|scheming|deadpan" }
  ]
}`;
}

function parseScript(raw: string): EpisodeScript {
  const parsed = JSON.parse(raw);
  if (!parsed.lines || !Array.isArray(parsed.lines)) {
    throw new Error("Invalid script: missing lines array");
  }

  return {
    title: parsed.title || "Untitled Episode",
    topic: parsed.topic || "",
    speakers: parsed.speakers || [],
    lines: parsed.lines.map((line: Record<string, string>) => ({
      speaker: line.speaker || "Unknown",
      text: line.text || "",
      emotion: line.emotion || "neutral",
      ssml_hints: line.ssml_hints,
    })),
  };
}

export async function generateScript(
  hosts: ZooHost[],
  sources: ContentSource[],
  lineCount: number = 12
): Promise<EpisodeScript> {
  const model = getGeminiPro();
  const prompt = buildPrompt(hosts, sources, lineCount);
  return generateStructured(model, prompt, parseScript);
}
