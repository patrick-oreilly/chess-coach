import { NextResponse } from "next/server";
import { Chess } from "chess.js";
import { getDb, type PuzzleCandidate, type PuzzleRecord } from "@/lib/db";
import { stockfish } from "@/lib/stockfish";

const BOX_INTERVAL_DAYS: Record<number, number> = {
  0: 0,
  1: 1,
  2: 3,
  3: 7,
  4: 21,
};

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    action: "check_move" | "record_result";
    puzzleId: string;
    fen?: string;
    moveUci?: string;
    solved?: boolean;
  };

  const db = getDb();
  const puzzle = db
    .prepare("SELECT * FROM puzzles WHERE id = ?")
    .get(body.puzzleId) as PuzzleRecord | undefined;

  if (!puzzle) {
    return NextResponse.json({ error: "Puzzle not found" }, { status: 404 });
  }

  // Live check whether an alternative move on the first step is within 0.3 pawns (30 cp) of best
  if (body.action === "check_move" && body.moveUci) {
    const candidates = JSON.parse(puzzle.candidates_json || "[]") as PuzzleCandidate[];
    const bestCp = candidates[0]?.cp ?? puzzle.eval_before_cp;

    if (body.moveUci === puzzle.best_move_uci) {
      return NextResponse.json({
        accepted: true,
        isExactBest: true,
        cpDiff: 0,
        continuationUci: JSON.parse(puzzle.solution_line_uci || "[]"),
        continuationSan: JSON.parse(puzzle.solution_line_san || "[]"),
      });
    }

    const matched = candidates.find((c) => c.uci === body.moveUci);
    if (matched && bestCp - matched.cp <= 30) {
      return NextResponse.json({
        accepted: true,
        isExactBest: false,
        cpDiff: bestCp - matched.cp,
        continuationUci: matched.pvUci,
        continuationSan: matched.pvSan,
      });
    }

    // Evaluate the user's move position directly with Stockfish if not in top-3 cache
    const chess = new Chess(body.fen || puzzle.target_fen);
    const from = body.moveUci.slice(0, 2);
    const to = body.moveUci.slice(2, 4);
    const promotion = body.moveUci.length > 4 ? body.moveUci[4] : undefined;
    const m = chess.move({ from, to, promotion });
    if (!m) {
      return NextResponse.json({ accepted: false, cpDiff: 999 });
    }

    const evAfter = await stockfish.evaluate(chess.fen(), { movetimeMs: 65, multiPv: 1 });
    const cpUser = puzzle.user_color === "white" ? evAfter.cpWhite : -evAfter.cpWhite;
    const cpDiff = Math.max(0, bestCp - cpUser);

    if (cpDiff <= 30) {
      const replyUci = evAfter.lines[0]?.pvUci ?? [];
      return NextResponse.json({
        accepted: true,
        isExactBest: false,
        cpDiff,
        continuationUci: [body.moveUci, ...replyUci.slice(0, 3)],
        continuationSan: [m.san],
      });
    }

    return NextResponse.json({
      accepted: false,
      cpDiff,
    });
  }

  // Record puzzle outcome and update spaced repetition schedule
  const today = new Date().toISOString().slice(0, 10);
  const solved = Boolean(body.solved);
  const nextBox = solved ? Math.min(4, puzzle.box + 1) : 0;
  const intervalDays = BOX_INTERVAL_DAYS[nextBox] ?? 1;
  const nextDue = solved ? addDays(today, intervalDays) : today;

  db.prepare(
    `UPDATE puzzles
     SET box = ?,
         due_date = ?,
         attempts = attempts + 1,
         successes = successes + ?,
         last_reviewed_at = ?
     WHERE id = ?`
  ).run(nextBox, nextDue, solved ? 1 : 0, new Date().toISOString(), puzzle.id);

  const updated = db
    .prepare("SELECT * FROM puzzles WHERE id = ?")
    .get(puzzle.id) as PuzzleRecord;

  return NextResponse.json({ puzzle: updated, intervalDays });
}
