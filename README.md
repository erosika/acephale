# Acephale Radio

Autonomous multi-channel AI radio station. Persistent AI agents generate live talk shows, DJ sets, conspiracy monologues, and generative ambient music around the clock. Listeners tune in with a rotary dial, hear static between stations, and can call in live.

**[Listen live](https://erosika.github.io/acephale/)**

## Stations

| Station | Mount | Host | Description |
|---------|-------|------|-------------|
| The Morning Zoo | `/zoo` | Buzz + Val | Two co-hosts who bicker about everything. Buzz is obnoxiously enthusiastic; Val is contemptuous and deadpan. |
| Crate Digger | `/crate` | Crate | Obsessive music nerd pulling tracks from Radiooooo. Lectures lovingly about context, labels, and session musicians. |
| Conspiracy Hour | `/conspiracy` | Nyx | Late-night paranoid monologues over dark Lyria ambient. Builds cross-session conspiracy threads, accuses other DJs. |
| Request Line | `/request` | Echo | The people's DJ. Takes live voice calls, remembers every caller, plays requests via Radiooooo. |

## Stack

- **Runtime**: Bun + TypeScript
- **LLM**: Gemini 2.5 Pro (scripts, monologues) + Gemini 2.0 Flash (steering, transcription)
- **TTS**: Google Cloud TTS (Chirp 3 HD voices: Aoede, Leda, Puck, Charon, Kore)
- **Music Generation**: Lyria RealTime (48kHz stereo PCM via WebSocket)
- **Music Curation**: Radiooooo API (decade/country/mood discovery)
- **Memory**: Honcho SDK v2 (persistent per-station sessions, per-agent peers)
- **Streaming**: Liquidsoap request queues + Icecast2
- **Audio**: ffmpeg (fades, normalization, mixing, MP3 encoding)
- **Server**: Elysia (API, stream proxy, WebSocket call-in)
- **Frontend**: Vanilla JS, SVG rotary dials, Web Audio API static noise engine

## Setup

```bash
cp .env.example .env
# Fill in: GEMINI_API_KEY, GEMINI_AI_STUDIO_KEY, GOOGLE_CLOUD_TTS_KEY, HONCHO_API_KEY

bun install

# Start streaming infrastructure
docker compose up -d

# Start everything (server + all station loops)
bun run all
```

## Architecture

Each station runs an independent loop: generate content (LLM) -> render speech (TTS) -> mix with music/ambient (ffmpeg) -> queue into Liquidsoap (telnet) -> stream via Icecast.

Agents are Honcho-persisted identities that accumulate memory across cycles. Each station gets a persistent session; each agent is a peer within that session. Callers are added as dynamic peers when they phone in.

The frontend connects to same-origin stream proxies (`/stream/:mount`) and uses Web Audio API to generate white noise between stations. A rotary tuning dial maps dial position to station frequency; hysteresis locking snaps to stations within tolerance.

### Key Directories

```
src/
  core/         -- shared: gemini, tts, audio, stream, honcho, lyria, calls
  stations/     -- per-station loop + host prompt (morning-zoo, crate-digger, conspiracy-hour, request-line)
  server/       -- Elysia HTTP/WS server + admin routes
  player/       -- frontend (index.html, style.css)
config/
  agents.toml   -- agent roster (name, personality, voice, honcho_user)
  liquidsoap/   -- per-station .liq configs
  icecast/      -- custom icecast.xml (low-latency buffers)
```

## Agent Roster

| Agent | Voice | Station | Honcho Peer |
|-------|-------|---------|-------------|
| Buzz | Aoede | Morning Zoo | `buzz` |
| Val | Leda | Morning Zoo | `val` |
| Crate | Puck | Crate Digger | `crate` |
| Nyx | Charon | Conspiracy Hour | `nyx` |
| Echo | Kore | Request Line | `echo` |
| Aura | Fenrir | The Generator (stub) | `aura` |

## Frontend

The player uses a rotary dial metaphor. Drag the tuning knob to scan the frequency band -- static noise fills the gaps between stations. Lock onto a station to hear the stream. Four themes: Midnight, Phosphor, Void, Sakura.

Deployable separately from the backend via `?api=` query parameter:
```
https://erosika.github.io/acephale/?api=http://your-server:3131
```

## License

MIT
