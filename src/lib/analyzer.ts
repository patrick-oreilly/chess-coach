import { Chess } from "chess.js";
import {
  getDb,
  getSetting,
  type ClockFlag,
  type GamePhase,
  type GameRecord,
  type MistakeMotif,
  type MoveClassification,
  type MoveRecord,
  type PuzzleCandidate,
} from "./db";
import { stockfish } from "./stockfish";
import { buildDeterministicNote, generateGameCoachCommentary } from "./coach";

export type ChessComRawGame = {
  url: string;
  pgn?: string;
  time_control: string;
  end_time: number;
  rated: boolean;
  time_class: "bullet" | "blitz" | "rapid" | "daily";
  rules?: string;
  accuracies?: { white?: number; black?: number };
  white: { username: string; rating: number; result: string };
  black: { username: string; rating: number; result: string };
  eco?: string;
};

const WIN_RESULTS = new Set(["win"]);
const DRAW_RESULTS = new Set([
  "agreed",
  "repetition",
  "stalemate",
  "insufficient",
  "50move",
  "timevsinsufficient",
]);

export function cpToWinProbWhite(cpWhite: number): number {
  const clamped = Math.max(-4000, Math.min(4000, cpWhite));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * clamped)) - 1);
}

function parseClockSeconds(clkStr: string): number | null {
  const parts = clkStr.trim().split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return null;
}

function extractClocksFromPgn(pgn: string): (number | null)[] {
  const body = pgn.replace(/^\[[^\]]*\]\s*/gm, "");
  const matches = [...body.matchAll(/\[%clk\s+([0-9:.]+)\]/g)];
  return matches.map((m) => parseClockSeconds(m[1]));
}

export function decodeOpeningName(pgn: string, ecoUrl?: string): string {
  const match = pgn.match(/^\[ECOUrl\s+"([^"]+)"\]/m);
  const rawUrl = match?.[1] || ecoUrl || "";
  const slug = rawUrl.split("/openings/")[1];
  if (!slug) return "Unclassified Opening";
  return slug
    .replace(/-/g, " ")
    .replace(/\b(\d+)\s+([a-hNBRQKO])/g, "$1.$2")
    .trim();
}

function detectPhase(fen: string, moveNumber: number): GamePhase {
  if (moveNumber <= 10) return "opening";
  const boardPart = fen.split(" ")[0];
  const weights: Record<string, number> = { q: 9, r: 5, b: 3, n: 3 };
  let totalNonPawnMaterial = 0;
  for (const ch of boardPart.toLowerCase()) {
    if (weights[ch]) totalNonPawnMaterial += weights[ch];
  }
  return totalNonPawnMaterial <= 26 ? "endgame" : "middlegame";
}

function uciLineToSan(fen: string, uciMoves: string[], maxPlies = 5): string[] {
  const chess = new Chess(fen);
  const sanMoves: string[] = [];
  for (const uci of uciMoves.slice(0, maxPlies)) {
    if (uci.length < 4) break;
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.length > 4 ? uci[4] : undefined;
    try {
      const m = chess.move({ from, to, promotion });
      if (!m) break;
      sanMoves.push(m.san);
    } catch {
      break;
    }
  }
  return sanMoves;
}

function formatLineWithNumbers(fen: string, sanMoves: string[]): string {
  if (sanMoves.length === 0) return "";
  const parts = fen.split(" ");
  let turn = parts[1] === "b" ? "black" : "white";
  let moveNum = Number(parts[5]) || 1;
  const tokens: string[] = [];
  sanMoves.forEach((san, idx) => {
    if (turn === "white") {
      tokens.push(`${moveNum}.${san}`);
      turn = "black";
    } else {
      tokens.push(idx === 0 ? `${moveNum}...${san}` : san);
      turn = "white";
      moveNum += 1;
    }
  });
  return tokens.join(" ");
}

function detectMistakeMotif(params: {
  moveNumber: number;
  phase: GamePhase;
  playedSan: string;
  playedUci: string;
  evalBeforeCp: number;
  evalAfterCp: number;
  refutationSan: string[];
}): MistakeMotif {
  const { moveNumber, phase, playedSan, playedUci, evalBeforeCp, evalAfterCp, refutationSan } = params;
  if (Math.abs(evalBeforeCp) >= 7000 || Math.abs(evalAfterCp) >= 7000) {
    return "mate_threat";
  }
  const destSquare = playedUci.slice(2, 4);
  const oppFirstSan = refutationSan[0] || "";
  const oppSecondSan = refutationSan[1] || "";

  // If the user captured something (or moved to a square) and opponent immediately captures on that same square winning material
  if (playedSan.includes("x") && oppFirstSan.includes(`x${destSquare}`)) {
    return "bad_trade";
  }
  // If opponent immediately captures a piece without it being a recapture trade
  if (oppFirstSan.includes("x")) {
    return "hanging_piece";
  }
  // If opponent's reply gives check or sets up a capture on the next turn (fork, pin, discovered attack)
  if (oppFirstSan.includes("+") || oppSecondSan.includes("x") || oppSecondSan.includes("+")) {
    return "fork_or_tactic";
  }
  if (phase === "opening" && moveNumber <= 10) {
    return "opening_drift";
  }
  if (/^[fgh]/.test(playedSan) && moveNumber <= 22) {
    return "king_safety";
  }
  return "positional";
}

export async function fetchRecentChessComGames(
  username: string,
  limit = 25,
  timeClassFilter: string = "rapid"
): Promise<ChessComRawGame[]> {
  const userLower = username.toLowerCase();
  const archRes = await fetch(`https://api.chess.com/pub/player/${userLower}/games/archives`, {
    headers: { "User-Agent": "chess-coach/0.1.0" },
  });
  if (!archRes.ok) {
    throw new Error(`Could not load Chess.com archives for ${username} (HTTP ${archRes.status})`);
  }
  const { archives } = (await archRes.json()) as { archives: string[] };
  const recentArchives = archives.slice(-3).reverse();
  const collected: ChessComRawGame[] = [];

  for (const url of recentArchives) {
    const res = await fetch(url, { headers: { "User-Agent": "chess-coach/0.1.0" } });
    if (!res.ok) continue;
    const { games } = (await res.json()) as { games: ChessComRawGame[] };
    const sorted = [...games].sort((a, b) => b.end_time - a.end_time);
    for (const g of sorted) {
      if (!g.pgn) continue;
      if (g.rules && g.rules !== "chess") continue;
      if (!g.rated) continue;
      if (timeClassFilter !== "all" && g.time_class !== timeClassFilter) continue;
      collected.push(g);
      if (collected.length >= limit) return collected;
    }
  }
  return collected;
}

export async function analyzeAndStoreGame(
  rawGame: ChessComRawGame,
  username: string
): Promise<GameRecord | null> {
  const db = getDb();
  const gameId = rawGame.url.split("/").pop() || String(rawGame.end_time);

  const existing = db.prepare("SELECT * FROM games WHERE id = ?").get(gameId) as GameRecord | undefined;
  if (existing) return existing;

  const pgn = rawGame.pgn || "";
  const chess = new Chess();
  try {
    chess.loadPgn(pgn);
  } catch {
    return null;
  }

  const history = chess.history({ verbose: true });
  if (history.length < 4) return null;

  const clocks = extractClocksFromPgn(pgn);
  const userLower = username.toLowerCase();
  const userColor: "white" | "black" =
    rawGame.white.username.toLowerCase() === userLower ? "white" : "black";
  const playerSide = userColor === "white" ? rawGame.white : rawGame.black;
  const oppSide = userColor === "white" ? rawGame.black : rawGame.white;

  const result: "win" | "loss" | "draw" = WIN_RESULTS.has(playerSide.result)
    ? "win"
    : DRAW_RESULTS.has(playerSide.result)
      ? "draw"
      : "loss";
  const method = result === "win" ? oppSide.result : playerSide.result;
  const openingName = decodeOpeningName(pgn, rawGame.eco);
  const gameDate = new Date(rawGame.end_time * 1000).toISOString().slice(0, 10);

  // Evaluate initial position + position after each ply
  const startFen = history[0].before;
  const fens = [startFen, ...history.map((m) => m.after)];
  const evals = [];
  for (const fen of fens) {
    const ev = await stockfish.evaluate(fen, { movetimeMs: 38, multiPv: 1 });
    evals.push(ev);
  }

  const moveRecords: MoveRecord[] = [];
  const puzzleCandidatesByPly = new Map<
    number,
    {
      candidates: PuzzleCandidate[];
      solutionUci: string[];
      solutionSan: string[];
      refutationSan: string[];
    }
  >();

  let prevWhiteClock: number | null = null;
  let prevBlackClock: number | null = null;

  for (let i = 0; i < history.length; i++) {
    const h = history[i];
    const ply = i + 1;
    const moveNumber = Math.floor(i / 2) + 1;
    const color: "white" | "black" = h.color === "w" ? "white" : "black";
    const uci = `${h.from}${h.to}${h.promotion ?? ""}`;
    const clk = clocks[i] ?? null;

    let timeSpent: number | null = null;
    if (clk !== null) {
      const prev = color === "white" ? prevWhiteClock : prevBlackClock;
      if (prev !== null && prev >= clk) {
        timeSpent = Math.max(0, prev - clk);
      }
      if (color === "white") prevWhiteClock = clk;
      else prevBlackClock = clk;
    }

    const evBefore = evals[i];
    const evAfter = evals[i + 1];

    const evalBeforeUserCp = userColor === "white" ? evBefore.cpWhite : -evBefore.cpWhite;
    const evalAfterUserCp = userColor === "white" ? evAfter.cpWhite : -evAfter.cpWhite;

    const wpBeforeWhite = cpToWinProbWhite(evBefore.cpWhite);
    const wpAfterWhite = cpToWinProbWhite(evAfter.cpWhite);

    const wpBeforeMover = color === "white" ? wpBeforeWhite : 100 - wpBeforeWhite;
    const wpAfterMover = color === "white" ? wpAfterWhite : 100 - wpAfterWhite;

    let bestMoveUci = evBefore.bestMoveUci || uci;
    let bestLineUci = evBefore.lines[0]?.pvUci ?? [bestMoveUci];
    let winProbDrop = uci === bestMoveUci ? 0 : Math.max(0, wpBeforeMover - wpAfterMover);

    // If this was the user's move and dropped significant equity, run a deeper MultiPV=3 pass
    let refutationSan: string[] = uciLineToSan(h.after, evAfter.lines[0]?.pvUci ?? [], 4);
    if (color === userColor && winProbDrop >= 9) {
      const deepBefore = await stockfish.evaluate(h.before, { movetimeMs: 85, multiPv: 3 });
      bestMoveUci = deepBefore.bestMoveUci || bestMoveUci;
      bestLineUci = deepBefore.lines[0]?.pvUci ?? bestLineUci;
      if (uci === bestMoveUci) {
        winProbDrop = 0;
      } else {
        const deepWpWhite = cpToWinProbWhite(deepBefore.cpWhite);
        const deepWpMover = color === "white" ? deepWpWhite : 100 - deepWpWhite;
        winProbDrop = Math.max(0, deepWpMover - wpAfterMover);
      }

      const candidates: PuzzleCandidate[] = deepBefore.lines.map((line) => {
        const firstUci = line.pvUci[0] || bestMoveUci;
        const sanArr = uciLineToSan(h.before, line.pvUci, 5);
        const cpMover = color === "white" ? line.cpWhite : -line.cpWhite;
        return {
          uci: firstUci,
          san: sanArr[0] || firstUci,
          cp: cpMover,
          pvUci: line.pvUci.slice(0, 5),
          pvSan: sanArr,
        };
      });

      const solSan = uciLineToSan(h.before, bestLineUci, 5);
      puzzleCandidatesByPly.set(ply, {
        candidates,
        solutionUci: bestLineUci.slice(0, 5),
        solutionSan: solSan,
        refutationSan,
      });
    }

    const bestSanArr = uciLineToSan(h.before, bestLineUci, 4);
    const bestMoveSan = bestSanArr[0] || h.san;
    const bestLineSan = formatLineWithNumbers(h.before, bestSanArr);

    let classification: MoveClassification = "good";
    if (uci === bestMoveUci || winProbDrop <= 1.8) {
      classification = "best";
    } else if (winProbDrop >= 20) {
      classification = "blunder";
    } else if (winProbDrop >= 11.5) {
      classification = "mistake";
    } else if (winProbDrop >= 6) {
      classification = "inaccuracy";
    }

    const phase = detectPhase(h.before, moveNumber);
    let clockFlag: ClockFlag = "normal";
    if (clk !== null && clk <= 60) {
      clockFlag = "time_trouble";
    } else if (timeSpent !== null && timeSpent <= 4 && (clk ?? 300) >= 150) {
      clockFlag = "rushed";
    }

    const motif: MistakeMotif | null =
      classification === "blunder" || classification === "mistake" || classification === "inaccuracy"
        ? detectMistakeMotif({
            moveNumber,
            phase,
            playedSan: h.san,
            playedUci: uci,
            evalBeforeCp: evalBeforeUserCp,
            evalAfterCp: evalAfterUserCp,
            refutationSan,
          })
        : null;

    moveRecords.push({
      game_id: gameId,
      ply,
      move_number: moveNumber,
      color,
      san: h.san,
      uci,
      fen_before: h.before,
      fen_after: h.after,
      clock_seconds: clk,
      time_spent_seconds: timeSpent,
      eval_before_cp: evalBeforeUserCp,
      eval_after_cp: evalAfterUserCp,
      win_prob_before: color === userColor ? wpBeforeMover : 100 - wpBeforeMover,
      win_prob_after: color === userColor ? wpAfterMover : 100 - wpAfterMover,
      win_prob_drop: Number(winProbDrop.toFixed(2)),
      best_move_uci: bestMoveUci,
      best_move_san: bestMoveSan,
      best_line_san: bestLineSan,
      classification,
      phase,
      motif,
      clock_flag: clockFlag,
      coach_note: null,
    });
  }

  const userMoves = moveRecords.filter((m) => m.color === userColor);
  const blunders = userMoves.filter((m) => m.classification === "blunder").length;
  const mistakes = userMoves.filter((m) => m.classification === "mistake").length;
  const inaccuracies = userMoves.filter((m) => m.classification === "inaccuracy").length;

  const avgDrop =
    userMoves.length > 0
      ? userMoves.reduce((acc, m) => acc + m.win_prob_drop, 0) / userMoves.length
      : 0;
  const providedAcc =
    userColor === "white" ? rawGame.accuracies?.white : rawGame.accuracies?.black;
  const accuracy =
    typeof providedAcc === "number"
      ? Number(providedAcc.toFixed(1))
      : Number(Math.max(35, Math.min(99.4, 100 - avgDrop * 2.15)).toFixed(1));

  const keyMistakes = userMoves
    .filter((m) => m.classification === "blunder" || m.classification === "mistake")
    .sort((a, b) => b.win_prob_drop - a.win_prob_drop)
    .slice(0, 5);

  const coachResult = await generateGameCoachCommentary({
    userColor,
    userRating: playerSide.rating,
    opponentName: oppSide.username,
    opponentRating: oppSide.rating,
    openingName,
    result,
    method,
    accuracy,
    blunders,
    mistakes,
    keyMistakes,
  });

  for (const m of userMoves) {
    if (coachResult.moveNotes[m.ply]) {
      m.coach_note = coachResult.moveNotes[m.ply];
    } else if (
      m.classification === "blunder" ||
      m.classification === "mistake" ||
      m.classification === "inaccuracy"
    ) {
      m.coach_note = buildDeterministicNote(m);
    }
  }

  const analyzedAt = new Date().toISOString();
  const todayStr = analyzedAt.slice(0, 10);

  const insertGame = db.prepare(`
    INSERT OR REPLACE INTO games (
      id, url, end_time, date, time_class, rated, user_color, user_rating,
      opponent_name, opponent_rating, result, method, eco, opening_name,
      pgn, accuracy, blunders, mistakes, inaccuracies, coach_summary, analyzed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMove = db.prepare(`
    INSERT OR REPLACE INTO moves (
      game_id, ply, move_number, color, san, uci, fen_before, fen_after,
      clock_seconds, time_spent_seconds, eval_before_cp, eval_after_cp,
      win_prob_before, win_prob_after, win_prob_drop, best_move_uci,
      best_move_san, best_line_san, classification, phase, motif, clock_flag, coach_note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertPuzzle = db.prepare(`
    INSERT OR IGNORE INTO puzzles (
      id, game_id, ply, move_number, user_color, fen_start, opponent_move_uci,
      opponent_move_san, target_fen, played_move_uci, played_move_san,
      best_move_uci, best_move_san, solution_line_uci, solution_line_san,
      candidates_json, eval_before_cp, eval_after_cp, win_prob_drop, motif,
      phase, clock_flag, time_spent_seconds, opening_name, opponent_name,
      game_date, coach_explanation, box, due_date, attempts, successes, last_reviewed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, 0, NULL)
  `);

  db.exec("BEGIN");
  try {
    insertGame.run(
      gameId,
      rawGame.url,
      rawGame.end_time,
      gameDate,
      rawGame.time_class,
      rawGame.rated ? 1 : 0,
      userColor,
      playerSide.rating,
      oppSide.username,
      oppSide.rating,
      result,
      method,
      rawGame.eco ?? null,
      openingName,
      pgn,
      accuracy,
      blunders,
      mistakes,
      inaccuracies,
      coachResult.summary,
      analyzedAt
    );

    for (const m of moveRecords) {
      insertMove.run(
        m.game_id,
        m.ply,
        m.move_number,
        m.color,
        m.san,
        m.uci,
        m.fen_before,
        m.fen_after,
        m.clock_seconds,
        m.time_spent_seconds,
        m.eval_before_cp,
        m.eval_after_cp,
        m.win_prob_before,
        m.win_prob_after,
        m.win_prob_drop,
        m.best_move_uci,
        m.best_move_san,
        m.best_line_san,
        m.classification,
        m.phase,
        m.motif,
        m.clock_flag,
        m.coach_note
      );

      if (
        m.color === userColor &&
        (m.classification === "blunder" || m.classification === "mistake") &&
        m.win_prob_drop >= 12 &&
        m.best_move_uci !== m.uci
      ) {
        const prevMove = m.ply > 1 ? moveRecords[m.ply - 2] : null;
        const deepInfo = puzzleCandidatesByPly.get(m.ply);
        const solUci = deepInfo?.solutionUci ?? [m.best_move_uci];
        const solSan = deepInfo?.solutionSan ?? [m.best_move_san];
        const cands: PuzzleCandidate[] = deepInfo?.candidates ?? [
          {
            uci: m.best_move_uci,
            san: m.best_move_san,
            cp: m.eval_before_cp,
            pvUci: solUci,
            pvSan: solSan,
          },
        ];

        insertPuzzle.run(
          `${gameId}-${m.ply}`,
          gameId,
          m.ply,
          m.move_number,
          userColor,
          prevMove ? prevMove.fen_before : m.fen_before,
          prevMove ? prevMove.uci : null,
          prevMove ? prevMove.san : null,
          m.fen_before,
          m.uci,
          m.san,
          m.best_move_uci,
          m.best_move_san,
          JSON.stringify(solUci),
          JSON.stringify(solSan),
          JSON.stringify(cands),
          m.eval_before_cp,
          m.eval_after_cp,
          m.win_prob_drop,
          m.motif ?? "positional",
          m.phase,
          m.clock_flag,
          m.time_spent_seconds,
          openingName,
          oppSide.username,
          gameDate,
          m.coach_note ?? buildDeterministicNote(m),
          todayStr
        );
      }
    }

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return db.prepare("SELECT * FROM games WHERE id = ?").get(gameId) as GameRecord;
}

export async function syncRecentGames(opts: {
  limit?: number;
  timeClass?: string;
} = {}): Promise<{ syncedNew: number; totalAnalyzed: number }> {
  const username = getSetting("CHESSCOM_USERNAME", "patrickoreilly2");
  const limit = opts.limit ?? 25;
  const timeClass = opts.timeClass ?? "rapid";
  const rawGames = await fetchRecentChessComGames(username, limit, timeClass);
  const db = getDb();

  let syncedNew = 0;
  for (const g of rawGames) {
    const gameId = g.url.split("/").pop() || String(g.end_time);
    const exists = db.prepare("SELECT id FROM games WHERE id = ?").get(gameId);
    if (!exists) {
      const stored = await analyzeAndStoreGame(g, username);
      if (stored) syncedNew += 1;
    }
  }

  const { count } = db.prepare("SELECT COUNT(*) as count FROM games").get() as { count: number };
  return { syncedNew, totalAnalyzed: count };
}
