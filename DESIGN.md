---
name: LongiBot
description: Panel de administración del canal de longii_ para el streamer y sus mods, entintado como una página de manga para la noche.
colors:
  ink: "#111110"
  stock: "#1b1a17"
  stock-raised: "#24221e"
  accent-stock: "#2c2a25"
  tone: "#5f5b53"
  paper-dim: "#a8a296"
  panel-line: "#d9d3c5"
  paper: "#ede8dc"
  red: "#ee5a4f"
typography:
  display:
    fontFamily: "Dela Gothic One, Zen Kaku Gothic New, sans-serif"
    fontSize: "clamp(1.75rem, 1.2rem + 1.6vw, 2.5rem)"
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: "0em"
  headline:
    fontFamily: "Dela Gothic One, Zen Kaku Gothic New, sans-serif"
    fontSize: "clamp(1.5rem, 1.1rem + 1.4vw, 2.125rem)"
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: "0em"
  title:
    fontFamily: "Dela Gothic One, Zen Kaku Gothic New, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: "0em"
  numeral:
    fontFamily: "Dela Gothic One, Zen Kaku Gothic New, sans-serif"
    fontSize: "2rem"
    fontWeight: 400
    lineHeight: 1
    fontFeature: "tnum"
  body:
    fontFamily: "Zen Kaku Gothic New, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Zen Kaku Gothic New, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 700
    lineHeight: 1.4
  code:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.875em"
rounded:
  panel: "2px"
  base: "0.25rem"
spacing:
  gutter-phone: "0.75rem"
  gutter: "1rem"
  stack: "1.25rem"
  page-top: "2.25rem"
  target-phone: "2.75rem"
components:
  button-primary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    typography: "{typography.label}"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.paper}"
    rounded: "{rounded.panel}"
  button-outline-hover:
    backgroundColor: "{colors.stock-raised}"
  button-destructive:
    backgroundColor: "transparent"
    textColor: "{colors.red}"
    rounded: "{rounded.panel}"
  panel:
    backgroundColor: "{colors.stock}"
    textColor: "{colors.paper}"
    rounded: "{rounded.panel}"
  splash-tag-alert:
    backgroundColor: "{colors.red}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    padding: "0.3rem 0.75rem 0.35rem"
  splash-tag-calm:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    padding: "0.3rem 0.75rem 0.35rem"
  state-live:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    padding: "0.05rem 0.5rem"
  state-pending:
    backgroundColor: "transparent"
    textColor: "{colors.paper-dim}"
    typography: "{typography.label}"
    padding: "0.05rem 0.5rem"
  state-alert:
    backgroundColor: "transparent"
    textColor: "{colors.red}"
    typography: "{typography.label}"
    padding: "0.05rem 0.5rem"
  record-win:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    size: "2.25rem"
  record-loss:
    backgroundColor: "{colors.red}"
    textColor: "{colors.ink}"
    size: "2.25rem"
  navlink:
    backgroundColor: "transparent"
    textColor: "{colors.paper-dim}"
    rounded: "{rounded.panel}"
    height: "2.5rem"
  navlink-active:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
  input:
    backgroundColor: "transparent"
    textColor: "{colors.paper}"
    rounded: "{rounded.panel}"
---

# Design System: LongiBot

## Overview

**Creative North Star: "La viñeta"**

The dashboard is an inked manga page printed in reverse for night use. Every job sits in its own panel: dark stock framed in a heavy paper-colored line, separated by black gutters. The page is calm and orderly until something needs a human; then one panel breaks the grid. It tilts, gains speed lines, and carries a red caption box. That break is the whole signature, and it only means one thing.

The system is dark only. The mods operate it from a phone at night, mid-stream, so legibility outranks atmosphere: the world never hides a state, and every state reads through form as well as color (solid, dashed, screentone, red). Ornament is limited to devices a manga page already has: frames, gutters, caption boxes, screentone, speed lines. Shadcn/ui components remain underneath, restyled through tokens and attribute selectors rather than replaced.

It refuses the stacked grey cards of a stock admin panel. Nothing floats on soft shadows; panels sit flat on the page, held by their frames.

**Key Characteristics:**
- Dark only: ink ground, dark stock panels, paper-colored ink for text and frames.
- 3px panel frames with nearly square corners (2px) and black gutters between panels.
- One red, for urgent and dangerous things only.
- State grammar by form: solid paper, dashed outline, screentone, red.
- Two faces: a heavy display gothic for titles and numbers, a quiet gothic for text.
- One signature: the splash panel, tilted with speed lines when something needs a human, settled and untilted when all is in order.

## Colors

A near-monochrome warm ink-and-paper palette with a single red that interrupts it.

### Primary
- **Paper** (paper): the ink of this reversed page. All primary text, the primary button fill, the active nav item and active tab (inverted: ink text on paper), the "win" record cell, the live state chip, the calm caption box, the focus ring and the selection highlight.

### Secondary
- **Alarm Red** (red): urgent and dangerous only. The alert caption box, the emphasized word in the alert splash title, loss record cells, alert state chips, destructive buttons (outlined, red text), and the on-air dot while the stream is live. Tuned up from the contract's #E0443C, which measured about 4.1:1 as small text on the stock, below AA; this value clears AA on stock and ink.

### Neutral
- **Ink** (ink): the page ground and the gutters; the background of the rail, top bar and tab bar; text on paper and red fills.
- **Panel Stock** (stock): the fill of every panel and the «Más» sheet.
- **Raised Stock** (stock-raised): popovers, inline confirmations, toast, outline-button hover, the background behind inline `code`.
- **Accent Stock** (accent-stock): shadcn secondary and accent surfaces (hover rows, sidebar accent).
- **Screentone Grey** (tone): the dot color of the screentone field (1.1px dots on a 6px grid) and scrollbars; also the remake record cell.
- **Faded Ink** (paper-dim): secondary text, inactive nav and tab labels, pending and done state text, the off-air dot.
- **Panel Line** (panel-line): every frame: panels, rail and bar edges, outline buttons, record cells, state chips, the splash caption box edge. Slightly dimmer than the text paper to cut the glare of 3px frames at night; text stays full paper.
- Hairline borders and input strokes use paper at 16% and 30% alpha (`rgb(237 232 220 / 16%)`, `/ 30%`).

### Named Rules
**The One Red Rule.** Red means urgent or dangerous: an alert, a loss, a destructive action, a live broadcast. It never decorates, never marks a section, never appears on a calm screen except the on-air dot.

**The Reversed Ink Rule.** Paper is ink here. Emphasis and "active" are shown by inverting to a solid paper fill with ink text, not by a new hue.

## Typography

**Display Font:** Dela Gothic One (with Zen Kaku Gothic New, sans-serif)
**Body Font:** Zen Kaku Gothic New (with system-ui, sans-serif)
**Label/Mono Font:** monospace (ui-monospace, SFMono-Regular, Menlo) for chat commands inside `<code>` only

**Character:** Dela Gothic One is the lettering of manga titles and sound effects: heavy, compact, loud. Zen Kaku Gothic New is the dialogue: plain, even, readable at night on a phone. Weights: 400 for Dela (it has one), 400 and 700 for Zen Kaku.

### Hierarchy
- **Display** (Dela 400, clamp(1.75rem, 1.2rem + 1.6vw, 2.5rem), 1.1): page titles. Drops to 1.375rem on compact phone page heads.
- **Headline** (Dela 400, clamp(1.5rem, 1.1rem + 1.4vw, 2.125rem), 1.1): the splash panel title.
- **Title** (Dela 400, 1.125rem, 1.3): panel titles; 1rem in phone half panels. Field legends use Dela at 1rem.
- **Numeral** (Dela 400, 2rem, 1, tabular): tallies (the night's record, queue counts). Record cells use Dela at 1rem.
- **Body** (Zen Kaku 400, 1rem, 1.6): all text. Page intros cap at 62ch and use `text-wrap: pretty`.
- **Label** (Zen Kaku 700, 0.8125rem): state chips, caption boxes, on-air indicator. Buttons, nav items and tabs are Zen Kaku 700. No uppercase, no tracking.

### Named Rules
**The Lettering Rule.** Dela Gothic One is for titles, numbers and legends only. It never sets a sentence of running text, a button or a label.

**The Chat Command Rule.** Monospace appears only for literal chat commands inside `<code>`, on raised stock with a 2px corner.

## Layout

Desktop is a two-column shell: a sticky left rail (15.5rem, full viewport height, ink, closed by a 3px panel-line edge) holding brand, on-air indicator, navigation and identity (pinned to the bottom); and a main column capped at 76rem with 2.25rem top padding, fluid side padding clamp(1.25rem, 4vw, 3.5rem) and 4rem bottom.

Inside main, content stacks with a 1.25rem gap. Panels sit on a two-column page grid with 1rem gutters like a manga spread; full-width panels span both columns. Forms cap at 52rem, inline confirmations at 36rem, resolve buttons at 30rem.

At 850px and below the rail disappears. A sticky top bar (avatar, LongiBot, on-air) closed by a 3px line sits above; a fixed bottom tab bar with four equal tabs (Resumen, Recordatorios, Predictions, Más) closes the page, respecting the safe-area inset. «Más» opens a framed sheet above the tab bar with the remaining sections and identity. Gutters tighten to 0.75rem, main gap to 1rem, and panels go full width except designated half panels (the night's record and the queue sit side by side). Every interactive element on the phone is at least 44px (2.75rem); tabs are 3.75rem tall.

**The 44px Rule.** On the phone, buttons, inputs, selects, checkbox rows and nav items are never shorter than 2.75rem.

## Elevation & Depth

Flat. Panels carry no shadow; depth comes from the frame and the gutter, exactly as on a printed page. Tonal steps (ink, stock, raised stock) separate ground, panel and overlay.

### Shadow Vocabulary
- **Floating overlay** (`box-shadow: 0 10px 28px rgb(0 0 0 / 55%)`): the toast only.
- **Sheet** (`box-shadow: 0 -12px 32px rgb(0 0 0 / 60%)`): the phone «Más» sheet, lifting it off the page above the tab bar.
- **On-air halo** (`box-shadow: 0 0 0 3px rgb(238 90 79 / 25%)`): ring around the live dot.

### Named Rules
**The Frame, Not Shadow Rule.** Anything that sits on the page is held by its frame. Shadows exist only for things that float above the page (toast, sheet).

## Shapes

Nearly square everywhere: panels, buttons, inputs, selects, checkboxes, confirmations and the toast use a 2px corner. The shadcn `--radius` base (0.25rem) only governs vendored internals. Round shapes are limited to the avatar and the on-air dot.

Frames carry the hierarchy: 3px for panels, rail and bar edges, the toast and the sheet; 4px for the alert splash panel; 2px for buttons, inputs, record cells, chips and confirmations; 1.5px for record cells in phone half panels. Dashed lines mean pending or provisional: pending chips, in-progress record cells, inline confirmations, the separator above secondary splash items.

## Components

### Buttons
Inked and decisive; a button is either a solid paper slab or a framed outline.
- **Shape:** nearly square (2px), Zen Kaku 700.
- **Primary:** solid paper fill, ink text. Used for the main action of a panel and the splash action.
- **Outline:** transparent with a 2px panel-line frame; hover fills with raised stock.
- **Destructive:** transparent with a 2px red frame and red text; hover tints red at 14%. Destructive is never a solid red slab.
- **Resolve outcomes:** one button per prediction outcome, side by side (min 9rem each, 3rem tall, 1rem text). The first outcome is solid paper, the other outlined, so they never read as twins.
- **Focus:** paper ring (`--ring`).

### Chips (state words)
- **Style:** Zen Kaku 700 at 0.8125rem, 2px frame, no corner radius beyond the panel default.
- **State:** live is solid paper with ink text; pending is a dashed frame in faded ink; alert is a red frame with red text; done is a hairline frame in faded ink. Tone comes from the shared state-to-tone mapping, never chosen ad hoc.

### Cards / Containers (panels)
- **Corner Style:** 2px.
- **Background:** panel stock.
- **Shadow Strategy:** none (see Elevation & Depth).
- **Border:** 3px panel line.
- **Footer:** no divider, no tinted background.

### Inputs / Fields
- **Style:** 2px stroke at paper 30% alpha, transparent fill, 2px corner; paper caret. Checkboxes share the 2px frame and grow to 1.375rem on the phone.
- **Focus:** paper ring.

### Navigation
- **Desktop rail:** items are 2.5rem tall, Zen Kaku 700 in faded ink with a 1.1rem line icon; hover lifts to paper text on stock; the active item inverts to a solid paper slab with ink text.
- **Phone:** top bar plus bottom tab bar; the active tab (or the open «Más» tab) inverts to solid paper with ink text, and while «Más» is open the current tab steps back.
- **On-air indicator:** a small dot plus "En vivo" or "Sin directo"; red with a halo when live, faded ink when not.

### Record (ficha)
A row of 2.25rem framed cells set in Dela. Win is solid paper, loss is solid red, remake is screentone, a game in progress is a dashed outline. The tally above sits in the numeral style.

### Inline Confirmation
Irreversible actions confirm in place: a dashed 2px panel-line frame on raised stock, holding the consequence and the confirm and cancel buttons.

### Toast
A single live region pinned bottom-center (above the tab bar on the phone): raised stock, 3px frame, Zen Kaku 700. It stays in the DOM and fades and slides in when it gets text.

### The Splash Panel (signature)
The first panel of Resumen, spanning the full width.
- **Alert** (something needs a human): 4px frame, rotated -0.8deg (-0.6deg on the phone), speed lines radiating from the upper right corner (a repeating conic gradient of paper at 11%, masked clear around its origin), a red caption box tucked into the top-left corner of the frame with a warning icon and "Necesita atención", the title in the headline style with the key word in red, one solid primary action, and further items listed under a dashed separator. It enters once with a short slam (0.45s, scale 1.035 to 1, `cubic-bezier(.16, 1, .3, 1)`), disabled under reduced motion.
- **Calm** (nothing pending): untilted, 3px frame, a paper caption box reading "Todo en orden" with a check, and screentone fading in from the open right side behind a stock gradient so it never sits under text.
- Login and 404 use the calm panel; the alert form is reserved for real attention.

**The Splash Rule.** Tilt, speed lines and the red caption box mean "needs a human" and appear nowhere else in the product.

## Do's and Don'ts

### Do:
- **Do** frame every panel with a 3px panel-line border and a 2px corner, on panel stock, separated by ink gutters.
- **Do** show every state by form as well as color: solid paper (win, live), red (loss, alert), screentone (remake), dashed (pending, in progress).
- **Do** invert to solid paper with ink text for the active nav item, active tab and primary action.
- **Do** keep screentone in open areas, never under text.
- **Do** confirm irreversible actions inline in a dashed panel before they run.
- **Do** keep every phone target at 44px (2.75rem) or more.
- **Do** disable the slam entrance and transitions under `prefers-reduced-motion`.

### Don't:
- **Don't** use red for anything that is not urgent or dangerous (the on-air dot is the one exception).
- **Don't** tilt, add speed lines or use the red caption box outside the alert splash panel.
- **Don't** put soft drop shadows on panels; only the toast and the phone sheet float.
- **Don't** set running text, buttons or labels in Dela Gothic One.
- **Don't** add a light theme; this system is dark only.
- **Don't** round panels, buttons or inputs beyond 2px.
- **Don't** fill destructive buttons with solid red; they are outlined.
