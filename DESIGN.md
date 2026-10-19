# DESIGN.md — 1.F4 // CHESS COACH (Swiss Brutalist Instrument Grid)

## Aesthetic Direction
- **Archetype**: Swiss Brutalist Instrument Grid (`STYLE 03`).
- **Inspirations**: Josef Müller-Brockmann grid systems, Teenage Engineering technical manuals, *New In Chess* statistical supplements.
- **Core Rule**: Zero floating cards, zero decorative border-radius (`0px`), zero drop shadows. Every functional zone is an interlocking cell in a full-bleed `1px` and `2px` hairline structural matrix (`divide-rule-strong`, `border-rule-strong`).

## Color & Atmospheric Polarity
### High-Craft Light Mode (Default `[data-theme="light"]`)
- `--paper`: `#f3efe6` (Warm archival newsprint)
- `--paper-raised`: `#fbf9f4` (Elevated instrument cell)
- `--paper-sunken`: `#e6dfd0` (Index header / recessed strip)
- `--ink`: `#141a22` (Deep carbon ink)
- `--ink-muted`: `#4a525d`
- `--ink-faint`: `#7c8490`
- `--rule`: `#cfc6b4` (`1px` subtle cell divider)
- `--rule-strong`: `#141a22` (`1px` / `2px` exposed structural grid frame)
- `--red`: `#b83218` (Vermilion blunder ink)
- `--amber`: `#9e5808` (Ochre mistake ink)
- `--green`: `#126341` (Archive forest engine-best ink)

### Carbon Slate Dark Mode (`[data-theme="dark"]`)
- `--paper`: `#11151c`
- `--paper-raised`: `#171c26`
- `--paper-sunken`: `#0b0e13`
- `--ink`: `#ece7dc`
- `--rule-strong`: `#3b4556`

## Typography & Scannable Hierarchy
- **Display / Match Headers (`--font-serif`)**: `STIX Two Text` — authoritative editorial headings for match titles and opening classifications.
- **Instrument & Telemetry (`--font-plex-mono`)**: `IBM Plex Mono` with `font-variant-numeric: tabular-nums` — numbered cell headers (`01 / ARCHIVE INDEX`, `02 / INSTRUMENT STAGE`, `03 / SCORE SHEET LOG`), algebraic notation, clock readouts, and centipawn evaluations.
- **UI Body (`--font-sans`)**: `Geist` — concise diagnostic prose.

## Signature Components
1. **Structural Command Header**: 12-column hairline bar with masthead, numbered mode cells (`01 / POST-MORTEM`, `02 / DRILL DECK`, `03 / LEAK MATRIX`), time-control filter, light/dark polarity toggle, DeepSeek key drawer, and Chess.com sync action.
2. **Oversized 5-Cell Tabular KPI Ticker**: Full-bleed strip displaying Active Match, Accuracy Index, Critical Errors (`BL / MK`), Stockfish 18 Evaluation, and direct `NEXT BLUNDER →` navigation.
3. **Single / Split Diff Instrument Stage**: Interactive board stage with a vertical centipawn evaluation bar and a 1-click toggle between `SINGLE` board and `SPLIT DIFF` (side-by-side comparison of the user's move vs. Stockfish's best continuation).
4. **Topographic Win-Equity Ridge (`EvalGraph.tsx`)**: SVG contour chart with hatched blunder cliff wedges, square telemetry markers, and crosshair playhead.
