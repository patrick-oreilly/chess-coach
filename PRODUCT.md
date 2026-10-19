# Chess Coach — Product Context

## Purpose
A local-first personal chess post-mortem analyzer, spaced-repetition blunder trainer, and repertoire leak detector built for Patrick O'Reilly (`patrickoreilly2`).

## Core Mechanism
1. Syncs rated games from Chess.com's public API, extracting move-by-move PGNs and `%clk` timestamps.
2. Evaluates every ply locally via UCI Stockfish (`/opt/homebrew/bin/stockfish`), computing Lichess win-probability swings, multi-PV candidate moves, tactical motifs (`bad_trade`, `hanging_piece`, `fork_or_tactic`, `mate_threat`, `king_safety`, `opening_drift`, `positional`), and clock impulse flags (`rushed` ≤4s vs `time_trouble` ≤60s).
3. Enriches turning points with DeepSeek (`deepseek-chat`) coaching commentary and extracts every user mistake/blunder (≥12% win-probability drop) into a local SQLite (`node:sqlite`) spaced-repetition drill deck (`1d → 3d → 7d → 21d`).
