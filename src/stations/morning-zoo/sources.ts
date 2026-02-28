import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getEnv } from "../../core/config.js";

// --- Types ---

export type ContentSource = {
  type: "rss" | "hn" | "manual" | "prank" | "caller_recap";
  title: string;
  summary: string;
  url?: string;
  timestamp: number;
};

// --- RSS Feed Fetching ---

export async function fetchRSS(feedUrl: string, limit: number = 5): Promise<ContentSource[]> {
  const res = await fetch(feedUrl);
  if (!res.ok) throw new Error(`RSS fetch failed: ${res.status}`);

  const xml = await res.text();
  const items: ContentSource[] = [];

  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null && items.length < limit) {
    const block = match[1];
    const title = block.match(/<title><!\[CDATA\[(.*?)\]\]>|<title>(.*?)<\/title>/)?.[1]
      || block.match(/<title>(.*?)<\/title>/)?.[1]
      || "Untitled";
    const desc = block.match(/<description><!\[CDATA\[(.*?)\]\]>|<description>(.*?)<\/description>/)?.[1]
      || block.match(/<description>(.*?)<\/description>/)?.[1]
      || "";

    items.push({
      type: "rss",
      title: title.trim(),
      summary: desc.replace(/<[^>]+>/g, "").trim().slice(0, 500),
      url: block.match(/<link>(.*?)<\/link>/)?.[1]?.trim(),
      timestamp: Date.now(),
    });
  }

  return items;
}

// --- Hacker News ---

export async function fetchHackerNews(limit: number = 5): Promise<ContentSource[]> {
  const res = await fetch("https://hacker-news.firebaseio.com/v0/topstories.json");
  if (!res.ok) throw new Error(`HN fetch failed: ${res.status}`);

  const ids = (await res.json()) as number[];
  const sources: ContentSource[] = [];

  for (const id of ids.slice(0, limit)) {
    const itemRes = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
    if (!itemRes.ok) continue;
    const item = (await itemRes.json()) as { title: string; url?: string; score: number };

    sources.push({
      type: "hn",
      title: item.title,
      summary: `HN score: ${item.score}`,
      url: item.url,
      timestamp: Date.now(),
    });
  }

  return sources;
}

// --- Manual Drops ---

export function loadManualSources(): ContentSource[] {
  const dir = getEnv("SOURCES_DIR", "./sources");
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".txt") || f.endsWith(".md"));
  } catch {
    return [];
  }

  return files.map((f) => {
    const content = readFileSync(join(dir, f), "utf-8");
    const firstLine = content.split("\n")[0].replace(/^#\s*/, "").trim();
    return {
      type: "manual" as const,
      title: firstLine || f,
      summary: content.slice(0, 500),
      timestamp: Date.now(),
    };
  });
}

// --- Aggregate ---

export async function gatherSources(
  rssFeeds?: string[],
  includeHN?: boolean
): Promise<ContentSource[]> {
  const sources: ContentSource[] = [];

  sources.push(...loadManualSources());

  if (rssFeeds && rssFeeds.length > 0) {
    const rssResults = await Promise.allSettled(rssFeeds.map((url) => fetchRSS(url, 3)));
    for (const result of rssResults) {
      if (result.status === "fulfilled") sources.push(...result.value);
    }
  }

  if (includeHN) {
    try {
      sources.push(...await fetchHackerNews(5));
    } catch { /* non-fatal */ }
  }

  return sources;
}
