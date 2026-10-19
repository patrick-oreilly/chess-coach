import { NextResponse } from "next/server";
import { getDb, type GameRecord, type MoveRecord } from "@/lib/db";
import { generateGameCoachCommentary } from "@/lib/coach";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const db = getDb();
  const game = db.prepare("SELECT * FROM games WHERE id = ?").get(id) as GameRecord | undefined;
  if (!game) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 });
  }
  const moves = db
    .prepare("SELECT * FROM moves WHERE game_id = ? ORDER BY ply ASC")
    .all(id) as MoveRecord[];
  return NextResponse.json({ game, moves });
}

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const db = getDb();
  const game = db.prepare("SELECT * FROM games WHERE id = ?").get(id) as GameRecord | undefined;
  if (!game) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 });
  }

  const moves = db
    .prepare("SELECT * FROM moves WHERE game_id = ? ORDER BY ply ASC")
    .all(id) as MoveRecord[];

  const keyMistakes = moves
    .filter(
      (m) =>
        m.color === game.user_color &&
        (m.classification === "blunder" || m.classification === "mistake")
    )
    .sort((a, b) => b.win_prob_drop - a.win_prob_drop)
    .slice(0, 5);

  const coachResult = await generateGameCoachCommentary({
    userColor: game.user_color,
    userRating: game.user_rating,
    opponentName: game.opponent_name,
    opponentRating: game.opponent_rating,
    openingName: game.opening_name,
    result: game.result,
    method: game.method,
    accuracy: game.accuracy,
    blunders: game.blunders,
    mistakes: game.mistakes,
    keyMistakes,
  });

  db.prepare("UPDATE games SET coach_summary = ? WHERE id = ?").run(coachResult.summary, id);
  const updateMove = db.prepare("UPDATE moves SET coach_note = ? WHERE game_id = ? AND ply = ?");
  const updatePuzzle = db.prepare(
    "UPDATE puzzles SET coach_explanation = ? WHERE game_id = ? AND ply = ?"
  );

  for (const [plyStr, note] of Object.entries(coachResult.moveNotes)) {
    const ply = Number(plyStr);
    updateMove.run(note, id, ply);
    updatePuzzle.run(note, id, ply);
  }

  const updatedGame = db.prepare("SELECT * FROM games WHERE id = ?").get(id) as GameRecord;
  const updatedMoves = db
    .prepare("SELECT * FROM moves WHERE game_id = ? ORDER BY ply ASC")
    .all(id) as MoveRecord[];

  return NextResponse.json({
    game: updatedGame,
    moves: updatedMoves,
    usedLlm: coachResult.usedLlm,
  });
}
