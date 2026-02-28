import { Elysia } from "elysia";
import { staticPlugin } from "@elysiajs/static";
import { join } from "node:path";
import { adminRoutes } from "./admin.js";
import { STATIONS, type StationId } from "../core/config.js";
import { getStatus, skip, getQueue, type Channel } from "../core/stream.js";
import { getNowPlaying, getAllNowPlaying } from "../core/nowplaying.js";
import { getArchiveEntries } from "../core/archive.js";
import { addCall } from "../core/calls.js";
import { getGeminiFlash, transcribeAudio } from "../core/gemini.js";

const PLAYER_DIR = join(import.meta.dir, "..", "player");

const ACTIVE_CHANNELS: Channel[] = ["morning-zoo", "crate-digger", "conspiracy-hour", "request-line"];

const app = new Elysia()
  .use(staticPlugin({ assets: PLAYER_DIR, prefix: "/" }))
  .get("/", () => Bun.file(join(PLAYER_DIR, "index.html")))
  .get("/health", () => ({ status: "ok", timestamp: new Date().toISOString() }))
  .get("/favicon.ico", ({ set }) => { set.status = 204; return ""; })

  .get("/status", async () => {
    const channels: Record<string, { name: string; format: string; stream: string }> = {};
    for (const ch of ACTIVE_CHANNELS) {
      let stream = "offline";
      try { stream = await getStatus(ch); } catch { /* offline */ }
      channels[ch] = { ...STATIONS[ch], stream };
    }
    return { channels, timestamp: new Date().toISOString() };
  })

  .get("/stations", () => STATIONS)

  .get("/stations/:id/now", async ({ params }) => {
    const station = params.id as Channel;
    try {
      const status = await getStatus(station);
      return { station, ...STATIONS[station as StationId], status };
    } catch {
      return { station, status: "offline" };
    }
  })

  .get("/now-playing", () => getAllNowPlaying())

  .get("/stations/:id/now-playing", ({ params }) => {
    const np = getNowPlaying(params.id);
    return np || { station: params.id, title: "", artist: "", startedAt: 0 };
  })

  .get("/stations/:id/history", ({ params, query }) => {
    const limit = query.limit ? parseInt(String(query.limit), 10) : 20;
    const since = query.since ? parseInt(String(query.since), 10) : undefined;
    return getArchiveEntries({ station: params.id, since, limit });
  })

  .post("/stations/:id/skip", async ({ params }) => {
    const station = params.id as Channel;
    try {
      const result = await skip(station);
      return { ok: true, station, result };
    } catch (err) {
      return { ok: false, station, error: String(err) };
    }
  })

  .get("/stations/:id/queue", async ({ params }) => {
    const station = params.id as Channel;
    try {
      const queue = await getQueue(station);
      return { station, queue };
    } catch {
      return { station, queue: [] };
    }
  })

  .get("/archive", ({ query }) => {
    const station = query.station ? String(query.station) : undefined;
    const limit = query.limit ? parseInt(String(query.limit), 10) : 50;
    return getArchiveEntries({ station, limit });
  })

  .post("/call", async ({ body, set }) => {
    try {
      const { station, text } = body as { station: string; text: string };
      if (!station || !text) {
        set.status = 400;
        return { error: "Missing station or text" };
      }
      const id = addCall(station, text, "user");
      return { ok: true, id };
    } catch (err) {
      set.status = 500;
      return { error: String(err) };
    }
  })

  // WebSocket for live voice recording from frontend
  .ws("/ws/call", {
    open(ws) {
      Object.assign(ws.data, { chunks: [], station: "request-line" });
    },
    message(ws, message) {
      const data = ws.data as any;
      if (typeof message === "string") {
        try {
          const parsed = JSON.parse(message);
          if (parsed.station) data.station = parsed.station;
        } catch {}
      } else {
        // Binary audio chunk (webm)
        data.chunks.push(Buffer.from(message as ArrayBuffer));
      }
    },
    async close(ws) {
      const data = ws.data as any;
    console.log(`[ws] User finished recording. Concatenating ${data.chunks.length} chunks...`);
    if (data.chunks && data.chunks.length > 0) {
      try {
        const audioBuf = Buffer.concat(data.chunks);
        console.log(`[ws] Received voice call for ${data.station} (${audioBuf.length} bytes), sending to Gemini for transcription...`);
        const model = getGeminiFlash();
        // The frontend sends standard audio/webm
        const text = await transcribeAudio(model, audioBuf, "audio/webm");
        console.log(`[ws] Transcribed text: "${text}"`);
        if (text && text !== "[silence]") {
          const callId = addCall(data.station, text, "user_voice", audioBuf);
          console.log(`[ws] Call ${callId} fully registered to queue.`);
        } else {
          console.log(`[ws] Dropping call: Transcribed as silence or empty.`);
        }
      } catch (err) {
        console.error("[ws] Voice call processing failed:", err);
      }
    } else {
      console.log(`[ws] No audio chunks received from frontend.`);
    }
  }
  })

  // Proxy Icecast streams so browser stays on same origin (no CORS issues)
  .get("/stream/:mount", async ({ params, set }) => {
    const mounts: Record<string, string> = {
      zoo: "/zoo",
      crate: "/crate",
      conspiracy: "/conspiracy",
      request: "/request",
    };
    const mount = mounts[params.mount];
    if (!mount) {
      set.status = 404;
      return "Unknown mount";
    }
    const icecastHost = process.env.ICECAST_HOST || "localhost";
    const icecastPort = process.env.ICECAST_PORT || "8000";
    const url = `http://${icecastHost}:${icecastPort}${mount}`;
    console.log(`[stream-proxy] Connecting to ${url}`);
    try {
      const upstream = await fetch(url, {
        headers: { "Icy-MetaData": "0" },
      });
      if (!upstream.ok || !upstream.body) {
        console.error(`[stream-proxy] Upstream error: ${upstream.status}`);
        set.status = 502;
        return "Stream unavailable";
      }
      console.log(`[stream-proxy] Connected to ${mount}, streaming`);
      set.headers["content-type"] = "audio/mpeg";
      set.headers["cache-control"] = "no-cache, no-store";
      set.headers["connection"] = "keep-alive";
      return new Response(upstream.body);
    } catch (err) {
      console.error(`[stream-proxy] Fetch failed: ${err}`);
      set.status = 502;
      return "Stream unavailable";
    }
  })

  .use(adminRoutes)

  .listen(parseInt(process.env.PORT || "3131", 10));

console.log(`[server] Acephale Radio running at http://localhost:${app.server?.port}`);

export { app };
