# 1.F4 // CHESS COACH

A local-first **Swiss Brutalist chess telemetry instrument**, Stockfish 18 + DeepSeek post-mortem analyzer, spaced-repetition blunder drill deck, and opening repertoire leak matrix (`1.f4` Bird's Opening & `1...d6` Pirc Defense).

## Architecture & Capabilities

- **`01 / POST-MORTEM` (Game Review)**:
  - Full-bleed 3-zone Swiss Brutalist hairline matrix (`01 / ARCHIVE INDEX`, `02 / INSTRUMENT STAGE`, `03 / TELEMETRY & SCORE`).
  - Toggle between `SINGLE` board and `SPLIT DIFF` (side-by-side comparison of your played move vs. Stockfish 18's best continuation).
  - Topographic Win-Equity Ridge (`EvalGraph.tsx`) with contour lines, diagonal-hatched blunder cliff wedges, and square telemetry markers.
  - Per-move clock telemetry (`%clk`) flagging impulsive blunders (`RUSHED ≤4S`).
- **`02 / DRILL DECK` (Spaced-Repetition Blunder Trainer)**:
  - Interactive Chessground drill deck built automatically from your own in-game blunders and mistakes.
  - Multi-PV Stockfish verification (accepts top engine moves and close alternatives within 0.3 pawns) with Leitner Box 1–5 scheduling.
- **`03 / LEAK MATRIX` (Cross-Game Pattern & Repertoire Audit)**:
  - Tracks win rates, accuracy, and worst variations across your White (`1.f4` Bird's Opening) and Black (`1...d6` Pirc / Modern) repertoire.
  - Breaks down recurring tactical/positional motifs, error rates by game phase, and rushed vs. deliberate move accuracy.

## Getting Started

```bash
npm install
npm run dev
```

Open **[http://localhost:3005](http://localhost:3005)**.

### Requirements
- **Node.js 22.5+ / 24+** (uses built-in `node:sqlite` for zero-dependency local persistence).
- **Stockfish** (`brew install stockfish` on macOS, or set `STOCKFISH_PATH` in `.env.local`).
- **DeepSeek API Key** (optional — configure via `.env.local` or the in-app `API KEY` drawer for natural-language grandmaster explanations; falls back to deterministic Stockfish coaching automatically).
