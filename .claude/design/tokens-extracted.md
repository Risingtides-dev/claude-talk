# Claude Desktop Design Tokens (Extracted)

**Source:** `/Applications/Claude.app/Contents/Resources/app.asar`
**Version:** Claude Desktop 1.4758.0
**Token timestamp comment in source:** `Values taken from claude.ai on 2025-10-17T02:46:12.721Z`

These are the actual production tokens shipped in Claude Desktop, copied directly from the bundled CSS. HSL components are space-separated (Tailwind v3 format) — wrap in `hsl()` to use, e.g. `hsl(var(--bg-100))`.

---

## Colors — Light theme (`:root`)

```css
/* Brand & accents */
--accent-brand:    15 63.1% 59.6%;
--brand-000:       15 54.2% 51.2%;
--brand-100:       15 54.2% 51.2%;
--brand-200:       15 63.1% 59.6%;
--brand-900:        0 0%    0%;

/* Pro accent (purple) */
--accent-pro-000: 251 34.2% 33.3%;
--accent-pro-100: 251 40%   45.1%;
--accent-pro-200: 251 61%   72.2%;
--accent-pro-900: 253 33.3% 91.8%;

/* Info accent (blue) */
--accent-000: 210 73.7% 40.2%;
--accent-100: 210 70.9% 51.6%;
--accent-200: 210 70.9% 51.6%;
--accent-900: 211 72%   90%;

/* Surfaces */
--bg-000:   0  0%    100%;
--bg-100:  48 33.3%  97.1%;
--bg-200:  53 28.6%  94.5%;
--bg-300:  48 25%    92.2%;
--bg-400:  50 20.7%  88.6%;
--bg-500:  50 20.7%  88.6%;

/* Borders (light theme uses near-black at low opacity) */
--border-100: 30 3.3% 11.8%;
--border-200: 30 3.3% 11.8%;
--border-300: 30 3.3% 11.8%;
--border-400: 30 3.3% 11.8%;

/* Status */
--danger-000:  0 58.6% 34.1%;
--danger-100:  0 56.2% 45.4%;
--danger-200:  0 56.2% 45.4%;
--danger-900:  0 50%   95%;
--success-000: 125 100% 18%;
--success-100: 103 72.3% 26.9%;
--success-200: 103 72.3% 26.9%;
--success-900:  86 45.1% 90%;

/* Foreground on color (for text on accent backgrounds) */
--oncolor-100:  0  0%   100%;
--oncolor-200: 60  6.7% 97.1%;
--oncolor-300: 60  6.7% 97.1%;

/* Text */
--text-000: 60 2.6% 7.6%;
--text-100: 60 2.6% 7.6%;
--text-200: 60 2.5% 23.3%;
--text-300: 60 2.5% 23.3%;
--text-400: 51 3.1% 43.7%;
--text-500: 51 3.1% 43.7%;

/* Legacy direct hex (for title-bar overlay sync) */
--claude-foreground-color: black;
--claude-background-color: #faf9f5;
--claude-secondary-color:  #737163;
--claude-border:           #706b5740;
--claude-border-300:       #706b5740;
--claude-border-300-more:  #706b57a6;
--claude-text-100:         #29261b;
--claude-text-200:         #3d3929;
--claude-text-400:         #656358;
--claude-description-text: #535146;
```

## Colors — Dark theme (`.darkTheme`)

```css
--accent-brand:    15 63.1% 59.6%;
--brand-000:       15 54.2% 51.2%;
--brand-100:       15 63.1% 59.6%;
--brand-200:       15 63.1% 59.6%;
--brand-900:        0 0%    0%;

--accent-pro-000: 251 84.6% 74.5%;
--accent-pro-100: 251 40.2% 54.1%;
--accent-pro-200: 251 40%   45.1%;
--accent-pro-900: 250 25.3% 19.4%;

--accent-000: 210 65.5% 67.1%;
--accent-100: 210 70.9% 51.6%;
--accent-200: 210 70.9% 51.6%;
--accent-900: 210 55.9% 24.6%;

/* Surfaces — note the order: bg-000 is lighter than bg-300 here */
--bg-000: 60  2.1% 18.4%;
--bg-100: 60  2.7% 14.5%;
--bg-200: 30  3.3% 11.8%;
--bg-300: 60  2.6%  7.6%;
--bg-400:  0  0%    0%;
--bg-500:  0  0%    0%;

/* Borders flip to off-white in dark mode */
--border-100: 51 16.5% 84.5%;
--border-200: 51 16.5% 84.5%;
--border-300: 51 16.5% 84.5%;
--border-400: 51 16.5% 84.5%;

--danger-000: 0 98.4% 75.1%;
--danger-100: 0 67%   59.6%;
--danger-200: 0 67%   59.6%;
--danger-900: 0 46.5% 27.8%;

--success-000: 97 59.1% 46.1%;
--success-100: 97 75%   32.9%;
--success-200: 97 75%   32.9%;
--success-900: 127 100% 13.9%;

--text-000: 48 33.3% 97.1%;
--text-100: 48 33.3% 97.1%;
--text-200: 50  9%   73.7%;
--text-300: 50  9%   73.7%;
--text-400: 48  4.8% 59.2%;
--text-500: 48  4.8% 59.2%;

/* Legacy hex (dark) */
--claude-foreground-color: white;
--claude-background-color: #262624;
--claude-secondary-color:  #a6a39a;
--claude-border:           #eaddd81a;
--claude-border-300:       #6c6a6040;
--claude-border-300-more:  #6c6a6094;
--claude-text-100:         #f5f4ef;
--claude-text-200:         #e5e5e2;
--claude-text-400:         #b8b5a9;
--claude-text-500:         #a6a39b;
--claude-description-text: #ceccc5;
```

## Brand named colors (`:root`)

```css
--white:      0  0%    100%;
--black:      0  0%      0%;
--kraft:     25 49.7%  66.5%;  /* paper / kraft tone */
--book-cloth: 15 52.3% 58%;    /* deep clay/red */
--manilla:   40 54%    82.9%;  /* warm cream */
--clay:      15 63.1% 59.6%;   /* the signature Claude orange */
--claude-accent-clay: #d97757; /* same, as direct hex */
```

---

## Typography

**Font stacks (verbatim from bundle):**

```css
--font-sans:  Anthropic Sans, ui-sans-serif, system-ui, sans-serif,
              "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol",
              "Noto Color Emoji";

--font-serif: Anthropic Serif, ui-serif, Georgia, Cambria,
              "Times New Roman", Times, serif;

--font-mono:  ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
              "Liberation Mono", "Courier New", monospace;
```

**Font files (extracted to `.claude/design/`):**

- `AnthropicSans-Roman-Variable-DCEzLfgm.ttf` — UI / interface text
- `AnthropicSans-Italic-Variable-Dqj5mHDM.ttf` — italic UI
- `AnthropicSerif-Roman-Variable-D05ngSTe.ttf` — assistant body text
- `AnthropicSerif-Italic-Variable-B9Ik5ODi.ttf` — italic body

> **Licensing note:** these are Anthropic's own typefaces. Confirm acceptable internal use vs. needing a public-safe fallback (`ui-sans-serif`, `Georgia`) before any redistribution.

**Smoothing (from base styles):**

```css
-webkit-font-smoothing: antialiased;
text-rendering: optimizeLegibility;
```

---

## Spacing & dimensions

The main UI loads from claude.ai at runtime, so most layout values aren't in the local bundle. From the local title-bar + buddy-window CSS:

**Border radii in active use:**
```css
--radius-xs:  0.25rem;   /*  4px */
--radius-sm:  0.3125rem; /*  5px */
--radius-md:  0.375rem;  /*  6px — most common */
--radius-lg:  0.5rem;    /*  8px */
--radius-xl:  1rem;      /* 16px — used for buddy-stick card */
--radius-pill: 9999px;
```

**Common heights from local bundle:**
- Inputs / row height: `2rem` (32px), `2.25rem` (36px)
- Avatar / icon: `1rem` (16px)
- Buttons: `45px` (one-off), `3rem` (48px), `4rem` (64px)

**Buddy window (sidebar-style) reference dimensions:**
- Card: `width: 115px; padding: 15px 19px 0;`
- Inner panel: `77px × 134px`

> **TODO at runtime:** verify the actual sidebar width (Cmd+Opt+I dev tools on the running app, inspect the project list rail). Local bundle doesn't declare it.

---

## Buddy palette (compact direct-hex set)

A separate, simpler palette used in the buddy window — useful as a sanity-check that confirms the canonical Claude colors:

```css
--cream:       #f4f3ee;  /* warmer than bg-100, use for paper feel */
--clay:        #d97757;  /* primary brand */
--clay-hover:  #c86848;
--ink:         #2d2d2d;  /* text-on-cream */
--ink-dim:     #6b6862;
--line:        rgba(45, 45, 45, .1);  /* dividers */
--ok:          #2d7a3e;
--err:         #b33a3a;
```

---

## App chrome / window region

```css
.nc-no-drag { -webkit-app-region: no-drag; }
.nc-drag    { -webkit-app-region: drag;    }
```

(Electron-only; not needed for our web UI but documents how Desktop wires its title bar.)

---

## Mapping our voice-agent UI to these tokens

| UI region                | Light                | Dark                 |
|--------------------------|----------------------|----------------------|
| App background           | `bg-100` (#faf9f5-ish) | `bg-100` (#262624 area) |
| Sidebar surface          | `bg-200`             | `bg-200`             |
| Sidebar row hover        | `bg-300`             | `bg-300`             |
| Active session row       | `bg-400` + clay accent stripe | same             |
| Conversation pane        | `bg-000`             | `bg-000`             |
| Primary text             | `text-100`           | `text-100`           |
| Secondary / metadata     | `text-300`           | `text-300`           |
| Muted / timestamps       | `text-400`           | `text-400`           |
| Brand actions (mic, send)| `clay` / `brand-200` | `clay` / `brand-200` |
| Borders                  | `border-300`         | `border-300`         |
| Code blocks (in turns)   | `bg-200` + `font-mono` | `bg-200` + `font-mono` |
| Assistant body text font | `Anthropic Serif`    | `Anthropic Serif`    |
| UI / sidebar font        | `Anthropic Sans`     | `Anthropic Sans`     |
| Code font                | `ui-monospace` stack | `ui-monospace` stack |

This mapping deliberately mirrors Desktop so a session is visually indistinguishable between the two surfaces.
