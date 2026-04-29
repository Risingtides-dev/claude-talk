# Voice Agent — PRD

A local web app on macOS that lets you have voice conversations with Claude Code. Sessions live in `~/.claude/projects/` — the same files Claude Desktop reads and writes — so a chat started in the web UI shows up in Desktop's Claude Code tab and vice versa.

## Goals

- Voice-first interaction with Claude Code on the Mac (hold-to-talk, hear responses spoken back, watch transcript stream)
- Full parity with Claude Desktop's Claude Code sessions on disk — open the same chat in either surface
- Same look-and-feel as Claude Desktop (extracted real design tokens, Anthropic Sans/Serif, light + dark)
- Local-only, no cloud, no remote service, no extra cost beyond Anthropic API usage

## Non-goals (v1)

- Phone / remote-mic clients
- Multi-user, auth, sharing
- Mobile responsive — the app assumes a desktop browser on the local Mac
- Simultaneous-driver concurrency with Desktop on the same active session (one driver at a time; reads are always safe)

## User flows

### Start a new session
1. Click `+ New` → pick a project (cwd) → session opens
2. Hold `⌥Space` (or click mic), speak, release → transcript appears as user turn
3. Claude streams response tokens to the conversation pane while TTS speaks the first 1–2 sentences (TL;DR rule)
4. Say "go on" → TTS continues with the rest of the response
5. Open Claude Desktop later → the session is in the Claude Code sidebar with full transcript

### Resume an existing session (created in Desktop or web)
1. Sidebar lists every session across every project (sorted by date by default, project toggle available)
2. Click a session → conversation pane renders the full transcript
3. Continue the conversation by voice or text — same JSONL grows

### Voice mode rules
- **TL;DR-first response**: When voice mode is active, Claude leads with a 1–2 sentence answer and waits for "go on" before reading details. Implemented via system prompt injection.
- **Interrupt**: Click anywhere or start talking → TTS cancels mid-sentence, mic engages
- **Tool calls are silent and collapsed**: TTS never narrates tool use. In voice mode, multiple tool calls in a single turn render as one thin "working…" pill (not one row per call). In text mode, each tool call is a single collapsed one-liner (`Read auth.ts`). Either way, expand-on-click is available but never automatic.

## System architecture

```
Browser (localhost:3000)
   ↕ WebSocket (streaming tokens)
Next.js dev server on Mac
   ├── REST: /api/sessions          → listSessions across all projects
   ├── REST: /api/sessions/:id      → getSessionMessages(id, cwd)
   ├── REST: /api/projects          → enumerate ~/.claude/projects/*
   ├── WS:   /api/chat              → query({ resume, prompt, cwd }) stream
   └── REST: /api/stt               → POST audio blob, returns transcript
Anthropic Agent SDK (v0.2.121, verified)
   └── reads/writes ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl
       (same files Claude Desktop reads/writes)
```

### Data model

We do not own a database. The source of truth is `~/.claude/projects/`. We use:
- `listSessions({ cwd })` to enumerate per-cwd
- `getSessionMessages(id, { cwd })` to render a transcript
- `query({ resume, cwd, prompt })` to send a turn (writes back to the same JSONL)

### cwd canonicalization

macOS symlinks `/tmp` → `/private/tmp`. The SDK normalizes via `realpath`. We canonicalize all cwd values with `fs.realpathSync.native` before lookups, otherwise `listSessions` and `resume` silently miss.

### Voice mode prompt rule (per-turn, STT-only)

Voice formatting guidance is injected **only** on user turns originating from the mic (STT). Typed turns are sent verbatim. This way when you reopen the session in Claude Desktop later, the JSONL contains a normal conversation — Desktop sees no global system-prompt rewrite, and follow-up assistant turns there aren't biased toward voice formatting.

Mechanism: when STT produces a transcript, we wrap it before sending:

```
[Voice mode — this message was spoken. Reply in plain prose suitable for TTS:
no headings, no bullet lists, no code blocks, no markdown. Lead with a 1–2
sentence direct answer; stop and wait. If I say "go on", continue with details.
Do not narrate tool calls.]

<user's transcribed text>
```

Typed turns from the same session get no wrapper. Same session, mixed surfaces, no contamination.

## STT / TTS

- **STT**: `mlx-whisper` (Whisper Large V3 Turbo) running locally as a subprocess. Audio blob from browser → `POST /api/stt` → temp wav → `mlx_whisper` CLI → text. ~400ms–1s for typical hold-to-talk clips.
- **TTS**: Web Speech API in the browser (`speechSynthesis.speak`). Apple voices, no install, no process to babysit. Sentence-by-sentence queueing as tokens stream so it speaks in near real-time.
- Both behind `Listener` and `Speaker` adapter interfaces so we can swap to Pocket TTS, Deepgram, ElevenLabs later by changing config.

## Design

Mirrors Claude Desktop's Claude Code tab. Real tokens extracted from `Claude.app/Contents/Resources/app.asar` (see `design-tokens.md`). Anthropic Sans (UI), Anthropic Serif (body), `ui-monospace` (code).

Layout:
- **Left sidebar (~280px)**: project sections (collapsible) or flat date list (toggle at top), session rows show auto-summary, click to open
- **Main pane**: conversation streaming, tool calls collapsed one-liners, big mic button at bottom
- **Top strip**: project name + session title, voice mode toggle, theme toggle

Light + dark themes both supported (system default).

## MVP scope (what ships first)

1. Sidebar lists sessions across all `~/.claude/projects/*`
2. Click a session → renders transcript
3. Type a message → streams response → JSONL grows
4. Open Desktop → see the same chat
5. Hold-to-talk mic → STT → send → TTS speaks reply

## Out of scope for v1

- Tool-call expansion UI (stays collapsed-only)
- File diff viewer
- Settings panel (uses sane defaults)
- Session rename/tag/delete UI (data model supports it; UI deferred)
- Search / filter
- Multi-window
- Wake word / always-listening
- Phone client

## Open risks

- **Concurrency with Desktop**: if Desktop is actively driving the same session and we send via SDK, behavior is undefined. v1 mitigation: best-effort warning if a session was modified within the last 30s. Long-term: file lock or coordination.
- **Anthropic Sans licensing**: fonts extracted from Desktop bundle. Local-only personal use is fine; do not ship/distribute. If needed, fall back to `ui-sans-serif`.
- **Desktop sidebar pixel parity**: main UI loads from claude.ai at runtime, so width/padding aren't in the local bundle. We use sensible values (~280px sidebar) that match the spirit. Pixel-perfect parity would require live dev-tools inspection.
