# Claude Talk

Voice-first web UI for Claude Code sessions. Runs locally on your Mac, talks to the same JSONL session files Claude Desktop reads, and exposes the same conversations on your phone via Tailscale.

## Stack

- Next.js 16 + React 19 (TypeScript)
- `@anthropic-ai/claude-agent-sdk` — drives the agent loop, reads/writes `~/.claude/projects/*.jsonl`
- mlx-whisper (local) for STT
- Pocket TTS (local) for voice cloning + playback
- Web Audio API for serial sentence playback
- Tailscale Funnel for mobile access over HTTPS

## Run locally

```bash
cd web
npm install
npm run dev
```

Server boots at `http://127.0.0.1:3000`.

## License

Personal project. Not affiliated with Anthropic.
