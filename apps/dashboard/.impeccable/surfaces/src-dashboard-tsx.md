---
version: 1
slug: "src-dashboard-tsx"
primary_target: "src/dashboard.tsx"
related_targets: ["src/style.css","index.html"]
---

# Surface brief: LongiBot dashboard (apps/dashboard)

Mode: Operate. All seven authenticated screens, login and 404.

Audience and job: mods operating live, mostly from a phone at night; longii_ configuring off-stream. First job: see what needs a human and act in two taps or fewer.

Constraints: behavior, API, harden confirmations, clarify copy and the longibot avatar stay. shadcn components stay, restyled through tokens. Every touch target 44px or more. WCAG 2.2 AA. Anti-goal confirmed by the user: losing operational readability; the world never hides a state.

## Direction contract

THESIS: The panel as an inked manga page: every job is a panel, and what needs a human breaks the grid. It refuses the stacked grey cards of the stock admin.

OWN-WORLD: Inked page: ink ground #111110, panel stock #1B1A17, 3px paper-colored (#EDE8DC) panel borders with black gutters, screentone dot fields in grey, one red #E0443C for urgent and danger only. Dela Gothic One for titles and numbers, Zen Kaku Gothic New for text. Win is a solid paper panel with ink text, loss is red, remake is screentone, in progress is outline.

STORY: The mod opens the panel, reads the splash panel, taps its action, sees the live prediction and resolves it safely, and leaves knowing the night's record and the queue.

FIRST VIEWPORT: Phone: compact top bar (avatar, LongiBot, «En vivo» or «Sin directo»; no stream time, by user decision on 2026-11-19 since the state snapshot carries no stream start); the splash panel full-width, tilted about -1deg with speed lines, title in Dela Gothic, its action button 44px; below, the live prediction panel with Sí and No side by side; then the record and queue as two half panels; bottom tab bar. Desktop: left rail with brand, nav, identity; the same panels on a two-column grid.

FORM: La viñeta (manga page), my top-ranked grounded candidate, chosen as the pick card; inked dark variant requested by the user. seed:c1a7baee56d806b2

SIGNATURE: The splash panel. When nothing needs attention it settles into a calm panel reading "Todo en orden"; when something does, it tilts, gains speed lines and the red tag.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
