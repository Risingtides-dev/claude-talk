# Design Tokens

Source of truth: `.claude/design/tokens-extracted.md` (raw extraction from Claude Desktop bundle).
This file is the cleaned, ready-to-use subset for this app.

## Color (HSL components, wrap with `hsl(var(--name))`)

### Light (`:root`)

| Token             | Value                | Use                                |
|-------------------|----------------------|------------------------------------|
| `--bg-000`        | `0 0% 100%`          | Conversation pane                  |
| `--bg-100`        | `48 33.3% 97.1%`     | App background                     |
| `--bg-200`        | `53 28.6% 94.5%`     | Sidebar                            |
| `--bg-300`        | `48 25% 92.2%`       | Sidebar row hover                  |
| `--bg-400`        | `50 20.7% 88.6%`     | Active session row                 |
| `--text-100`      | `60 2.6% 7.6%`       | Primary text                       |
| `--text-300`      | `60 2.5% 23.3%`      | Secondary                          |
| `--text-400`      | `51 3.1% 43.7%`      | Muted (timestamps, metadata)       |
| `--border-300`    | `30 3.3% 11.8%` @ low alpha | Dividers                    |
| `--clay`          | `15 63.1% 59.6%`     | Brand action (mic, send)           |
| `--accent-100`    | `210 70.9% 51.6%`    | Info accent                        |
| `--danger-100`    | `0 56.2% 45.4%`      | Errors                             |
| `--success-100`   | `103 72.3% 26.9%`    | OK                                 |

### Dark (`.darkTheme`)

| Token             | Value                | Use                                |
|-------------------|----------------------|------------------------------------|
| `--bg-000`        | `60 2.1% 18.4%`      | Conversation pane                  |
| `--bg-100`        | `60 2.7% 14.5%`      | App background                     |
| `--bg-200`        | `30 3.3% 11.8%`      | Sidebar                            |
| `--bg-300`        | `60 2.6% 7.6%`       | Sidebar row hover                  |
| `--bg-400`        | `0 0% 0%`            | Active session row                 |
| `--text-100`      | `48 33.3% 97.1%`     | Primary text                       |
| `--text-300`      | `50 9% 73.7%`        | Secondary                          |
| `--text-400`      | `48 4.8% 59.2%`      | Muted                              |
| `--border-300`    | `51 16.5% 84.5%` @ low alpha | Dividers                    |
| `--clay`          | `15 63.1% 59.6%`     | Brand action                       |

### Direct hex (legacy, used for chrome sync)

```
--cream: #f4f3ee
--clay-hex: #d97757
--clay-hover: #c86848
--ink: #2d2d2d
--ink-dim: #6b6862
```

## Typography

```css
--font-sans:  'Anthropic Sans', ui-sans-serif, system-ui, sans-serif;
--font-serif: 'Anthropic Serif', ui-serif, Georgia, serif;
--font-mono:  ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
```

| Element                    | Font     | Size           |
|----------------------------|----------|----------------|
| Sidebar row                | sans     | 13px / 1.4     |
| Session title strip        | sans     | 14px / 1.4     |
| User turn text             | sans     | 15px / 1.5     |
| Assistant body text        | serif    | 16px / 1.6     |
| Code blocks                | mono     | 13px / 1.5     |
| Tool-call summary          | mono     | 12px / 1.4     |

## Spacing

```
4 / 6 / 8 / 12 / 16 / 20 / 24 / 32 / 48 px
```

## Radii

```
--radius-xs:   4px
--radius-sm:   5px
--radius-md:   6px   /* default */
--radius-lg:   8px
--radius-xl:   16px
--radius-pill: 9999px
```

## Layout

| Region              | Size                         |
|---------------------|------------------------------|
| Sidebar             | 280px wide                   |
| Conversation pad    | 24px sides, 32px top/bottom  |
| Mic button          | 64px circle, centered        |
| Top strip           | 44px tall                    |

## Motion

```
--ease-standard: cubic-bezier(.4, 0, .2, 1);
--dur-fast:    120ms;
--dur-medium:  200ms;
--dur-slow:    320ms;
```

Mic state transitions use `--dur-medium` with `--ease-standard`.
