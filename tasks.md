# Tasks

Ordered build plan. Each phase ends with a verifiable checkpoint.

## Phase 0 — Scaffold
- [x] Spike confirms SDK can list/resume Desktop sessions on disk
- [ ] Create Next.js + TS app at project root (`/Users/risingtidesdev/voice agent`)
- [ ] Install: `@anthropic-ai/claude-agent-sdk`, `ws`, `@types/ws`
- [ ] Add Anthropic Sans/Serif TTFs from `.claude/design/` to `public/fonts/`
- [ ] Wire CSS variables from extracted tokens; load fonts via `@font-face`
- [ ] Verify: `npm run dev` boots, page loads at `localhost:3000`

## Phase 1 — Session bridge
- [ ] `/api/projects` GET → enumerate `~/.claude/projects/*`, return `[{ encodedCwd, cwd, sessionCount, lastModified }]`
- [ ] `/api/sessions` GET → for each project, call `listSessions({ cwd })`, return flat list with cwd attached
- [ ] `/api/sessions/[id]` GET (with `cwd` query param) → call `getSessionMessages`, return parsed turns
- [ ] cwd canonicalization helper using `fs.realpathSync.native`
- [ ] Verify: hit each endpoint, see real data from existing sessions

## Phase 2 — Sidebar UI
- [ ] Sidebar component, ~280px wide, dark/light token-driven
- [ ] Sort toggle: `[ By date | By project ]`, persisted in localStorage, default by date
- [ ] Session row: summary (one line, truncated), project name, relative time
- [ ] Click row → routes to `/session/[id]?cwd=...`
- [ ] Active row highlighted with clay accent stripe
- [ ] Verify: sidebar shows real recent sessions, clicking changes URL

## Phase 3 — Conversation pane (read-only first)
- [ ] Render user turns and assistant turns from `getSessionMessages` payload
- [ ] User turns: indented, sans, secondary text color
- [ ] Assistant turns: full-width, serif, primary text color
- [ ] Tool calls: render as one-line collapsed `Read auth.ts` style entries
- [ ] Auto-scroll to bottom; pause auto-scroll if user scrolls up
- [ ] Verify: open existing session, transcript renders correctly

## Phase 4 — Send messages (streaming)
- [ ] WebSocket route `/api/chat` accepts `{ sessionId, cwd, prompt, source: 'text' | 'voice' }`
- [ ] Server spawns `query({ resume, cwd, prompt })` and streams message events back
- [ ] When `source: 'voice'`, server wraps prompt with voice-formatting instruction (per-turn only, never global)
- [ ] Client: input box at bottom, submit → opens WS, streams tokens into pane
- [ ] On stream end, refetch session messages so any tool-use entries are in sync
- [ ] Verify: type "hi", see response stream, open Desktop → same session has the new turn

## Phase 5 — Voice in
- [ ] Big mic button at bottom of conversation pane
- [ ] Hold-to-talk: `mousedown`/`keydown(⌥Space)` → start MediaRecorder, release → POST blob to `/api/stt`
- [ ] `/api/stt`: write blob to temp wav, spawn `mlx_whisper`, return text
- [ ] Transcript flows directly into the WS chat with `voiceMode: true`
- [ ] Mic visual states: idle / recording / processing / speaking
- [ ] Verify: hold mic, speak, release → see transcript → see Claude reply

## Phase 6 — Voice out
- [ ] Sentence buffer on streaming tokens; speak each completed sentence via `speechSynthesis`
- [ ] Speaker interface (`speak(text)`, `cancel()`); concrete `WebSpeechSpeaker`
- [ ] Voice picker (system voices) in a small toggle
- [ ] Click anywhere or start talking → cancel TTS, engage mic
- [ ] Voice-mode TL;DR rule active by default; "go on" continues
- [ ] Verify: full voice loop end-to-end

## Phase 7 — Polish
- [ ] Theme toggle (light / dark / system)
- [ ] Project-name resolution (encoded cwd → readable name)
- [ ] Empty states (no sessions, no projects, error)
- [ ] Concurrency warning if session JSONL modified < 30s ago by something else
- [ ] Keyboard: `Cmd+K` to focus sidebar search, `⌥Space` hold-to-talk, `Esc` cancel TTS

## Verification checklist (end of MVP)

1. Sidebar lists existing sessions across all projects ✓
2. Click a Desktop-created session → full transcript renders ✓
3. Send a message → streams in, JSONL grows ✓
4. Open Claude Desktop → same chat is there with new turn ✓
5. Hold-to-talk → STT → reply streams + TTS speaks first sentence ✓
6. Light/dark theme works, fonts render correctly ✓
