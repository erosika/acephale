# Acephale Radio

Multi-channel AI radio station. Persistent AI agents generate live talk, DJ sets, and generative music across 3 channels.

## Channels

| Channel | Name | Description |
|---------|------|-------------|
| CH1 | The Discourse | AI podcast -- agents discuss technology, culture, and ideas |
| CH2 | The DJ Booth | AI DJ + curated music with mic breaks |
| CH3 | The Generator | Live AI-generated music via Lyria RealTime |

## Stack

- **Runtime**: Bun + TypeScript
- **LLM**: Gemini 2.5 Pro (scripts, analysis) + Flash (steering)
- **TTS**: Google Cloud TTS (Chirp 3 HD)
- **Music Generation**: Lyria RealTime (48kHz PCM WebSocket)
- **Memory**: Honcho (persistent agent identity + cross-episode memory)
- **Streaming**: Icecast2 + Liquidsoap
- **Server**: Elysia

## Setup

```bash
cp .env.example .env
# Fill in API keys

bun install

# Start streaming infrastructure
docker compose up -d

# Start the server
bun run dev

# Run Ch1 episode loop
bun run discourse
```

## Architecture

Agents are Honcho-persisted identities that accumulate memory and opinions across episodes. Each agent has a unique voice profile via Chirp 3 HD.

Episodes are generated via Gemini 2.5 Pro, rendered through TTS, assembled with ffmpeg, and queued into Liquidsoap for streaming via Icecast.

## Agent Roster

| Agent | Personality | Channel |
|-------|-------------|---------|
| Maya | Skeptical systems engineer, hates hype, loves benchmarks | CH1 |
| Fen | Enthusiastic creative technologist, always pitching weird ideas | CH1 |
| Orin | Dry academic, constantly citing papers that may not exist | CH1 |
| DJ Static | Sardonic DJ, encyclopedic music taste, slightly burnt out | CH2 |
