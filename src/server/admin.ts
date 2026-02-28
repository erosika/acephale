import { Elysia, t } from "elysia";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { getEnv } from "../core/config.js";

export const adminRoutes = new Elysia({ prefix: "" })
  .post(
    "/sources",
    ({ body }) => {
      const dir = getEnv("SOURCES_DIR", "./sources");
      const filename = `drop-${Date.now()}.txt`;
      const content = body.url
        ? `# ${body.title || "Dropped Link"}\n${body.url}\n\n${body.notes || ""}`
        : body.text || "";

      writeFileSync(join(dir, filename), content);
      return { ok: true, filename };
    },
    {
      body: t.Object({
        url: t.Optional(t.String()),
        title: t.Optional(t.String()),
        text: t.Optional(t.String()),
        notes: t.Optional(t.String()),
      }),
    }
  )

  .post(
    "/mood",
    ({ body }) => {
      console.log(`[admin] Mood override: ${body.mood}`);
      return { ok: true, mood: body.mood };
    },
    {
      body: t.Object({
        mood: t.String(),
        duration_minutes: t.Optional(t.Number()),
      }),
    }
  )

  .post(
    "/agents",
    ({ body }) => {
      console.log(`[admin] New agent: ${body.name}`);
      return { ok: true, agent: body.name };
    },
    {
      body: t.Object({
        name: t.String(),
        personality: t.String(),
        voice: t.Optional(t.String()),
        station: t.Optional(t.String()),
      }),
    }
  )

  .post(
    "/breaking",
    ({ body }) => {
      console.log(`[admin] Breaking news: ${body.headline}`);
      return { ok: true, headline: body.headline };
    },
    {
      body: t.Object({
        headline: t.String(),
        details: t.Optional(t.String()),
      }),
    }
  )

  .post(
    "/prank",
    ({ body }) => {
      console.log(`[admin] Prank trigger: ${body.aggressor} -> ${body.target} (${body.type})`);
      return { ok: true, prank: body };
    },
    {
      body: t.Object({
        type: t.String(),
        aggressor: t.String(),
        target: t.String(),
      }),
    }
  );
