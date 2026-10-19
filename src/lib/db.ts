import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type MoveClassification = "best" | "good" | "inaccuracy" | "mistake" | "blunder";
export type GamePhase = "opening" | "middlegame" | "endgame";
export type MistakeMotif =
  | "bad_trade"
  | "hanging_piece"
  | "fork_or_tactic"
  | "mate_threat"
  | "king_safety"
  | "opening_drift"
  | "positional";
export type ClockFlag = "rushed" | "time_trouble" | "normal";

export type GameRecord = {
  id: string;
  url: string;
  end_time: number;
  date: string;
  time_class: string;
  rated: number;
  user_color: "white" | "black";
  user_rating: number;
  opponent_name: string;
  opponent_rating: number;
  result: "win" | "loss" | "draw";
  method: string;
  eco: string | null;
  opening_name: string;
  pgn: string;
  accuracy: number;
  blunders: number;
  mistakes: number;
  inaccuracies: number;
  coach_summary: string | null;
  analyzed_at: string;
};

export type MoveRecord = {
  id?: number;
  game_id: string;
  ply: number;
  move_number: number;
  color: "white" | "black";
  san: string;
  uci: string;
  fen_before: string;
  fen_after: string;
  clock_seconds: number | null;
  time_spent_seconds: number | null;
  eval_before_cp: number;
  eval_after_cp: number;
  win_prob_before: number;
  win_prob_after: number;
  win_prob_drop: number;
  best_move_uci: string;
  best_move_san: string;
  best_line_san: string;
  classification: MoveClassification;
  phase: GamePhase;
  motif: MistakeMotif | null;
  clock_flag: ClockFlag;
  coach_note: string | null;
};

export type PuzzleCandidate = {
  uci: string;
  san: string;
  cp: number;
  pvUci: string[];
  pvSan: string[];
};

export type PuzzleRecord = {
  id: string;
  game_id: string;
  ply: number;
  move_number: number;
  user_color: "white" | "black";
  fen_start: string;
  opponent_move_uci: string | null;
  opponent_move_san: string | null;
  target_fen: string;
  played_move_uci: string;
  played_move_san: string;
  best_move_uci: string;
  best_move_san: string;
  solution_line_uci: string;
  solution_line_san: string;
  candidates_json: string;
  eval_before_cp: number;
  eval_after_cp: number;
  win_prob_drop: number;
  motif: MistakeMotif;
  phase: GamePhase;
  clock_flag: ClockFlag;
  time_spent_seconds: number | null;
  opening_name: string;
  opponent_name: string;
  game_date: string;
  coach_explanation: string | null;
  box: number;
  due_date: string;
  attempts: number;
  successes: number;
  last_reviewed_at: string | null;
};

let dbInstance: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (dbInstance) return dbInstance;
  const dataDir = path.join(process.cwd(), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "chess-coach.db");
  const db = new DatabaseSync(dbPath);

  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      end_time INTEGER NOT NULL,
      date TEXT NOT NULL,
      time_class TEXT NOT NULL,
      rated INTEGER NOT NULL DEFAULT 1,
      user_color TEXT NOT NULL,
      user_rating INTEGER NOT NULL,
      opponent_name TEXT NOT NULL,
      opponent_rating INTEGER NOT NULL,
      result TEXT NOT NULL,
      method TEXT NOT NULL,
      eco TEXT,
      opening_name TEXT NOT NULL,
      pgn TEXT NOT NULL,
      accuracy REAL NOT NULL DEFAULT 0,
      blunders INTEGER NOT NULL DEFAULT 0,
      mistakes INTEGER NOT NULL DEFAULT 0,
      inaccuracies INTEGER NOT NULL DEFAULT 0,
      coach_summary TEXT,
      analyzed_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_games_end_time ON games(end_time DESC);
    CREATE INDEX IF NOT EXISTS idx_games_date ON games(date DESC);

    CREATE TABLE IF NOT EXISTS moves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT NOT NULL,
      ply INTEGER NOT NULL,
      move_number INTEGER NOT NULL,
      color TEXT NOT NULL,
      san TEXT NOT NULL,
      uci TEXT NOT NULL,
      fen_before TEXT NOT NULL,
      fen_after TEXT NOT NULL,
      clock_seconds REAL,
      time_spent_seconds REAL,
      eval_before_cp INTEGER NOT NULL,
      eval_after_cp INTEGER NOT NULL,
      win_prob_before REAL NOT NULL,
      win_prob_after REAL NOT NULL,
      win_prob_drop REAL NOT NULL,
      best_move_uci TEXT NOT NULL,
      best_move_san TEXT NOT NULL,
      best_line_san TEXT NOT NULL,
      classification TEXT NOT NULL,
      phase TEXT NOT NULL,
      motif TEXT,
      clock_flag TEXT NOT NULL DEFAULT 'normal',
      coach_note TEXT,
      UNIQUE(game_id, ply)
    );

    CREATE INDEX IF NOT EXISTS idx_moves_game_id ON moves(game_id, ply);

    CREATE TABLE IF NOT EXISTS puzzles (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL,
      ply INTEGER NOT NULL,
      move_number INTEGER NOT NULL,
      user_color TEXT NOT NULL,
      fen_start TEXT NOT NULL,
      opponent_move_uci TEXT,
      opponent_move_san TEXT,
      target_fen TEXT NOT NULL,
      played_move_uci TEXT NOT NULL,
      played_move_san TEXT NOT NULL,
      best_move_uci TEXT NOT NULL,
      best_move_san TEXT NOT NULL,
      solution_line_uci TEXT NOT NULL,
      solution_line_san TEXT NOT NULL,
      candidates_json TEXT NOT NULL,
      eval_before_cp INTEGER NOT NULL,
      eval_after_cp INTEGER NOT NULL,
      win_prob_drop REAL NOT NULL,
      motif TEXT NOT NULL,
      phase TEXT NOT NULL,
      clock_flag TEXT NOT NULL DEFAULT 'normal',
      time_spent_seconds REAL,
      opening_name TEXT NOT NULL,
      opponent_name TEXT NOT NULL,
      game_date TEXT NOT NULL,
      coach_explanation TEXT,
      box INTEGER NOT NULL DEFAULT 0,
      due_date TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      successes INTEGER NOT NULL DEFAULT 0,
      last_reviewed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_puzzles_due ON puzzles(due_date ASC, box ASC);
  `);

  const countRow = db.prepare("SELECT COUNT(*) as c FROM games").get() as { c: number };
  if (countRow.c === 0) {
    const candidatePaths = [path.join(dataDir, "seed.json")];
    for (const seedPath of candidatePaths) {
      if (fs.existsSync(seedPath)) {
        try {
          const raw = JSON.parse(fs.readFileSync(seedPath, "utf8")) as {
            games: GameRecord[];
            moves: MoveRecord[];
            puzzles: PuzzleRecord[];
          };
          const insGame = db.prepare(`
            INSERT OR IGNORE INTO games (
              id, url, end_time, date, time_class, rated, user_color, user_rating,
              opponent_name, opponent_rating, result, method, eco, opening_name,
              pgn, accuracy, blunders, mistakes, inaccuracies, coach_summary, analyzed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          const insMove = db.prepare(`
            INSERT OR IGNORE INTO moves (
              game_id, ply, move_number, color, san, uci, fen_before, fen_after,
              clock_seconds, time_spent_seconds, eval_before_cp, eval_after_cp,
              win_prob_before, win_prob_after, win_prob_drop, best_move_uci,
              best_move_san, best_line_san, classification, phase, motif, clock_flag, coach_note
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          const insPuzzle = db.prepare(`
            INSERT OR IGNORE INTO puzzles (
              id, game_id, ply, move_number, user_color, fen_start, opponent_move_uci,
              opponent_move_san, target_fen, played_move_uci, played_move_san,
              best_move_uci, best_move_san, solution_line_uci, solution_line_san,
              candidates_json, eval_before_cp, eval_after_cp, win_prob_drop, motif,
              phase, clock_flag, time_spent_seconds, opening_name, opponent_name,
              game_date, coach_explanation, box, due_date, attempts, successes, last_reviewed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          db.exec("BEGIN");
          for (const g of raw.games) {
            insGame.run(
              g.id, g.url, g.end_time, g.date, g.time_class, g.rated, g.user_color,
              g.user_rating, g.opponent_name, g.opponent_rating, g.result, g.method,
              g.eco, g.opening_name, g.pgn, g.accuracy, g.blunders, g.mistakes,
              g.inaccuracies, g.coach_summary, g.analyzed_at
            );
          }
          for (const m of raw.moves) {
            insMove.run(
              m.game_id, m.ply, m.move_number, m.color, m.san, m.uci, m.fen_before,
              m.fen_after, m.clock_seconds, m.time_spent_seconds, m.eval_before_cp,
              m.eval_after_cp, m.win_prob_before, m.win_prob_after, m.win_prob_drop,
              m.best_move_uci, m.best_move_san, m.best_line_san, m.classification,
              m.phase, m.motif, m.clock_flag, m.coach_note
            );
          }
          for (const p of raw.puzzles) {
            insPuzzle.run(
              p.id, p.game_id, p.ply, p.move_number, p.user_color, p.fen_start,
              p.opponent_move_uci, p.opponent_move_san, p.target_fen, p.played_move_uci,
              p.played_move_san, p.best_move_uci, p.best_move_san, p.solution_line_uci,
              p.solution_line_san, p.candidates_json, p.eval_before_cp, p.eval_after_cp,
              p.win_prob_drop, p.motif, p.phase, p.clock_flag, p.time_spent_seconds,
              p.opening_name, p.opponent_name, p.game_date, p.coach_explanation,
              p.box, p.due_date, p.attempts, p.successes, p.last_reviewed_at
            );
          }
          db.exec("COMMIT");
          break;
        } catch {
          try {
            db.exec("ROLLBACK");
          } catch {}
        }
      }
    }
  }

  dbInstance = db;
  return db;
}

export function getSetting(key: string, fallback = ""): string {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  if (row && row.value) return row.value;
  return process.env[key] ?? fallback;
}

export function setSetting(key: string, value: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}
