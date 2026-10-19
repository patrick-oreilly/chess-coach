import { NextResponse } from "next/server";
import { getDb, getSetting, type GameRecord, type MoveRecord, type PuzzleRecord } from "@/lib/db";
import { getPatternsReport } from "@/lib/patterns";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const timeClass = searchParams.get("timeClass") || "rapid";
  const selectedGameId = searchParams.get("gameId");

  const db = getDb();
  const games = (
    timeClass !== "all"
      ? db
          .prepare("SELECT * FROM games WHERE time_class = ? ORDER BY end_time DESC LIMIT 60")
          .all(timeClass)
      : db.prepare("SELECT * FROM games ORDER BY end_time DESC LIMIT 60").all()
  ) as GameRecord[];

  const activeGameId = selectedGameId || games[0]?.id || null;
  const moves = activeGameId
    ? (db
        .prepare("SELECT * FROM moves WHERE game_id = ? ORDER BY ply ASC")
        .all(activeGameId) as MoveRecord[])
    : [];

  const puzzles = db
    .prepare(
      `SELECT p.* FROM puzzles p
       JOIN games g ON g.id = p.game_id
       ${timeClass !== "all" ? "WHERE g.time_class = ?" : ""}
       ORDER BY p.due_date ASC, p.box ASC, p.win_prob_drop DESC`
    )
    .all(...(timeClass !== "all" ? [timeClass] : [])) as PuzzleRecord[];

  const patterns = getPatternsReport(timeClass);
  const username = getSetting("CHESSCOM_USERNAME", "patrickoreilly2");
  const deepSeekKey = getSetting("DEEPSEEK_API_KEY", "").trim();

  return NextResponse.json({
    games,
    activeGameId,
    moves,
    puzzles,
    patterns,
    settings: {
      username,
      hasDeepSeekKey: Boolean(deepSeekKey),
      maskedDeepSeekKey: deepSeekKey ? `${deepSeekKey.slice(0, 6)}•••${deepSeekKey.slice(-4)}` : "",
    },
  });
}
