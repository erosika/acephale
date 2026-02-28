import { Elysia } from "elysia";
import { adminRoutes } from "./admin.js";
import { STATIONS, type StationId } from "../core/config.js";
import { getStatus, type Channel } from "../core/stream.js";
import { getCallQueue, enqueueCall } from "../core/callin.js";

const ACTIVE_CHANNELS: Channel[] = ["morning-zoo", "crate-digger", "conspiracy-hour", "request-line"];

const app = new Elysia()
  .get("/health", () => ({ status: "ok", timestamp: new Date().toISOString() }))

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

  .get("/stations/:id/callers", ({ params }) => {
    const queue = getCallQueue(params.id as StationId);
    return {
      station: params.id,
      waiting: queue.waiting.length,
      active: queue.active ? { id: queue.active.id, state: queue.active.state } : null,
    };
  })

  .post("/stations/:id/callin", ({ params, body }) => {
    const station = params.id as StationId;
    const listenerId = (body as { listenerId: string }).listenerId || `anon-${Date.now()}`;
    const queued = enqueueCall(station, listenerId);
    return { queued, station, listenerId };
  })

  .use(adminRoutes)

  .listen(parseInt(process.env.PORT || "3131", 10));

console.log(`[server] Acephale Radio running at http://localhost:${app.server?.port}`);

export { app };
