import { getDb, type GamePhase, type MistakeMotif } from "./db";

export type OpeningLeakItem = {
  family: string;
  color: "white" | "black";
  games: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  avgAccuracy: number;
  mistakesPerGame: number;
  worstVariation: {
    name: string;
    games: number;
    losses: number;
    sampleMove: string | null;
    sampleGameId: string | null;
    samplePly: number | null;
  } | null;
};

export type MotifStat = {
  motif: MistakeMotif;
  label: string;
  description: string;
  count: number;
  avgDrop: number;
  totalDrop: number;
  sampleGameId: string | null;
  samplePly: number | null;
  sampleMove: string | null;
};

export type PhaseStat = {
  phase: GamePhase;
  label: string;
  totalMoves: number;
  mistakesAndBlunders: number;
  ratePer100: number;
  avgDropWhenMistake: number;
};

export type ClockInsight = {
  rushedMoves: number;
  rushedMistakes: number;
  rushedMistakeRatePct: number;
  deliberateMoves: number;
  deliberateMistakes: number;
  deliberateMistakeRatePct: number;
  timeTroubleMoves: number;
  timeTroubleMistakes: number;
  avgSecondsOnBlunders: number | null;
  avgSecondsOnBestMoves: number | null;
};

export type PatternsReport = {
  totalGames: number;
  totalUserMoves: number;
  overallAccuracy: number;
  openingLeaks: OpeningLeakItem[];
  motifs: MotifStat[];
  phases: PhaseStat[];
  clock: ClockInsight;
};

const MOTIF_META: Record<MistakeMotif, { label: string; description: string }> = {
  bad_trade: {
    label: "Miscounted Trades & Captures",
    description: "Capturing into a square where the opponent has more defenders or wins material in the exchange.",
  },
  hanging_piece: {
    label: "Undefended Material",
    description: "Leaving a piece or pawn loose for a one-move capture on the very next turn.",
  },
  fork_or_tactic: {
    label: "Tactical Shots, Checks & Forks",
    description: "Allowing a double attack, intermediate check, or two-move tactical sequence.",
  },
  mate_threat: {
    label: "Mating Nets & Back-Rank",
    description: "Overlooking a forced checkmate sequence for either side.",
  },
  king_safety: {
    label: "King Shield & Open Files",
    description: "Pushing kingside pawns or opening the f/g-files when your king can be targeted.",
  },
  opening_drift: {
    label: "Early Opening Concessions",
    description: "Losing central control, trading an active outpost piece, or locking in a bishop in the first 10 moves.",
  },
  positional: {
    label: "Positional & Central Pressure",
    description: "Passive piece placement or ceding key squares without immediate tactical loss.",
  },
};

function classifyOpeningFamily(openingName: string, color: "white" | "black"): string {
  const lower = openingName.toLowerCase();
  if (lower.includes("bird")) return "Bird's Opening (1.f4)";
  if (lower.includes("pirc")) return "Pirc Defense (1...d6)";
  if (lower.includes("modern")) return "Modern Defense (1...g6 / 1...d6)";
  if (lower.includes("indian")) return "Indian / King's Indian Setup";
  if (lower.includes("queen")) return "Queen's Pawn / Fianchetto";
  return color === "white" ? `Other White (${openingName.split(" ").slice(0, 2).join(" ")})` : `Other Black (${openingName.split(" ").slice(0, 2).join(" ")})`;
}

export function getPatternsReport(timeClassFilter = "all"): PatternsReport {
  const db = getDb();

  const whereClause = timeClassFilter !== "all" ? "WHERE time_class = ?" : "";
  const games = (
    timeClassFilter !== "all"
      ? db.prepare(`SELECT * FROM games ${whereClause} ORDER BY end_time DESC`).all(timeClassFilter)
      : db.prepare(`SELECT * FROM games ORDER BY end_time DESC`).all()
  ) as {
    id: string;
    user_color: "white" | "black";
    result: "win" | "loss" | "draw";
    opening_name: string;
    accuracy: number;
    blunders: number;
    mistakes: number;
  }[];

  if (games.length === 0) {
    return {
      totalGames: 0,
      totalUserMoves: 0,
      overallAccuracy: 0,
      openingLeaks: [],
      motifs: [],
      phases: [],
      clock: {
        rushedMoves: 0,
        rushedMistakes: 0,
        rushedMistakeRatePct: 0,
        deliberateMoves: 0,
        deliberateMistakes: 0,
        deliberateMistakeRatePct: 0,
        timeTroubleMoves: 0,
        timeTroubleMistakes: 0,
        avgSecondsOnBlunders: null,
        avgSecondsOnBestMoves: null,
      },
    };
  }

  const gameIds = new Set(games.map((g) => g.id));
  const allMoves = db
    .prepare(
      `SELECT m.*, g.user_color, g.opening_name
       FROM moves m
       JOIN games g ON g.id = m.game_id
       WHERE m.color = g.user_color
       ORDER BY g.end_time DESC, m.ply ASC`
    )
    .all() as {
    game_id: string;
    ply: number;
    move_number: number;
    color: "white" | "black";
    san: string;
    best_move_san: string;
    win_prob_drop: number;
    classification: string;
    phase: GamePhase;
    motif: MistakeMotif | null;
    clock_flag: string;
    time_spent_seconds: number | null;
    opening_name: string;
  }[];

  const userMoves = allMoves.filter((m) => gameIds.has(m.game_id));

  // 1. Opening Repertoire Leaks
  const familyMap = new Map<
    string,
    {
      family: string;
      color: "white" | "black";
      games: typeof games;
      variations: Map<
        string,
        {
          games: number;
          losses: number;
          sampleMove: string | null;
          sampleGameId: string | null;
          samplePly: number | null;
          maxDrop: number;
        }
      >;
    }
  >();

  for (const g of games) {
    const family = classifyOpeningFamily(g.opening_name, g.user_color);
    const key = `${g.user_color}:${family}`;
    if (!familyMap.has(key)) {
      familyMap.set(key, {
        family,
        color: g.user_color,
        games: [],
        variations: new Map(),
      });
    }
    const entry = familyMap.get(key)!;
    entry.games.push(g);

    if (!entry.variations.has(g.opening_name)) {
      entry.variations.set(g.opening_name, {
        games: 0,
        losses: 0,
        sampleMove: null,
        sampleGameId: null,
        samplePly: null,
        maxDrop: 0,
      });
    }
    const v = entry.variations.get(g.opening_name)!;
    v.games += 1;
    if (g.result === "loss") v.losses += 1;
  }

  for (const m of userMoves) {
    if (m.classification !== "blunder" && m.classification !== "mistake") continue;
    const family = classifyOpeningFamily(m.opening_name, m.color);
    const key = `${m.color}:${family}`;
    const v = familyMap.get(key)?.variations.get(m.opening_name);
    if (v && m.win_prob_drop > v.maxDrop) {
      v.maxDrop = m.win_prob_drop;
      v.sampleMove = `${m.move_number}${m.color === "white" ? "." : "..."}${m.san} (best: ${m.best_move_san})`;
      v.sampleGameId = m.game_id;
      v.samplePly = m.ply;
    }
  }

  const openingLeaks: OpeningLeakItem[] = [...familyMap.values()]
    .map((entry) => {
      const gCount = entry.games.length;
      const wins = entry.games.filter((g) => g.result === "win").length;
      const losses = entry.games.filter((g) => g.result === "loss").length;
      const draws = entry.games.filter((g) => g.result === "draw").length;
      const avgAccuracy =
        entry.games.reduce((s, g) => s + g.accuracy, 0) / Math.max(1, gCount);
      const mistakesPerGame =
        entry.games.reduce((s, g) => s + g.blunders + g.mistakes, 0) / Math.max(1, gCount);

      const worstVar = [...entry.variations.entries()]
        .sort((a, b) => b[1].losses - a[1].losses || b[1].maxDrop - a[1].maxDrop)[0];

      return {
        family: entry.family,
        color: entry.color,
        games: gCount,
        wins,
        losses,
        draws,
        winRate: Number(((wins / Math.max(1, gCount)) * 100).toFixed(0)),
        avgAccuracy: Number(avgAccuracy.toFixed(1)),
        mistakesPerGame: Number(mistakesPerGame.toFixed(1)),
        worstVariation: worstVar
          ? {
              name: worstVar[0],
              games: worstVar[1].games,
              losses: worstVar[1].losses,
              sampleMove: worstVar[1].sampleMove,
              sampleGameId: worstVar[1].sampleGameId,
              samplePly: worstVar[1].samplePly,
            }
          : null,
      };
    })
    .sort((a, b) => b.games - a.games);

  // 2. Motifs
  const motifAccum = new Map<
    MistakeMotif,
    {
      count: number;
      totalDrop: number;
      maxDrop: number;
      sampleGameId: string | null;
      samplePly: number | null;
      sampleMove: string | null;
    }
  >();

  for (const m of userMoves) {
    if (m.classification !== "blunder" && m.classification !== "mistake") continue;
    const motif = m.motif ?? "positional";
    if (!motifAccum.has(motif)) {
      motifAccum.set(motif, {
        count: 0,
        totalDrop: 0,
        maxDrop: 0,
        sampleGameId: null,
        samplePly: null,
        sampleMove: null,
      });
    }
    const item = motifAccum.get(motif)!;
    item.count += 1;
    item.totalDrop += m.win_prob_drop;
    if (m.win_prob_drop > item.maxDrop) {
      item.maxDrop = m.win_prob_drop;
      item.sampleGameId = m.game_id;
      item.samplePly = m.ply;
      item.sampleMove = `${m.move_number}${m.color === "white" ? "." : "..."}${m.san}`;
    }
  }

  const motifs: MotifStat[] = [...motifAccum.entries()]
    .map(([motif, stat]) => ({
      motif,
      label: MOTIF_META[motif].label,
      description: MOTIF_META[motif].description,
      count: stat.count,
      avgDrop: Number((stat.totalDrop / stat.count).toFixed(1)),
      totalDrop: Number(stat.totalDrop.toFixed(0)),
      sampleGameId: stat.sampleGameId,
      samplePly: stat.samplePly,
      sampleMove: stat.sampleMove,
    }))
    .sort((a, b) => b.totalDrop - a.totalDrop);

  // 3. Phases
  const phaseDefs: { phase: GamePhase; label: string }[] = [
    { phase: "opening", label: "Opening (Moves 1–10)" },
    { phase: "middlegame", label: "Middlegame (Tactics & Plans)" },
    { phase: "endgame", label: "Endgame (Simplified)" },
  ];

  const phases: PhaseStat[] = phaseDefs.map(({ phase, label }) => {
    const pMoves = userMoves.filter((m) => m.phase === phase);
    const errs = pMoves.filter((m) => m.classification === "blunder" || m.classification === "mistake");
    const avgDrop =
      errs.length > 0 ? errs.reduce((s, e) => s + e.win_prob_drop, 0) / errs.length : 0;
    return {
      phase,
      label,
      totalMoves: pMoves.length,
      mistakesAndBlunders: errs.length,
      ratePer100: pMoves.length > 0 ? Number(((errs.length / pMoves.length) * 100).toFixed(1)) : 0,
      avgDropWhenMistake: Number(avgDrop.toFixed(1)),
    };
  });

  // 4. Clock Pacing
  const rushed = userMoves.filter((m) => m.clock_flag === "rushed");
  const rushedErrs = rushed.filter(
    (m) => m.classification === "blunder" || m.classification === "mistake"
  );
  const deliberate = userMoves.filter((m) => m.clock_flag === "normal");
  const deliberateErrs = deliberate.filter(
    (m) => m.classification === "blunder" || m.classification === "mistake"
  );
  const tt = userMoves.filter((m) => m.clock_flag === "time_trouble");
  const ttErrs = tt.filter(
    (m) => m.classification === "blunder" || m.classification === "mistake"
  );

  const blunderMovesWithTime = userMoves.filter(
    (m) =>
      (m.classification === "blunder" || m.classification === "mistake") &&
      m.time_spent_seconds !== null
  );
  const bestMovesWithTime = userMoves.filter(
    (m) => m.classification === "best" && m.time_spent_seconds !== null && m.move_number > 3
  );

  const avgSecondsOnBlunders =
    blunderMovesWithTime.length > 0
      ? Number(
          (
            blunderMovesWithTime.reduce((s, m) => s + (m.time_spent_seconds ?? 0), 0) /
            blunderMovesWithTime.length
          ).toFixed(1)
        )
      : null;

  const avgSecondsOnBestMoves =
    bestMovesWithTime.length > 0
      ? Number(
          (
            bestMovesWithTime.reduce((s, m) => s + (m.time_spent_seconds ?? 0), 0) /
            bestMovesWithTime.length
          ).toFixed(1)
        )
      : null;

  const overallAccuracy = Number(
    (games.reduce((s, g) => s + g.accuracy, 0) / Math.max(1, games.length)).toFixed(1)
  );

  return {
    totalGames: games.length,
    totalUserMoves: userMoves.length,
    overallAccuracy,
    openingLeaks,
    motifs,
    phases,
    clock: {
      rushedMoves: rushed.length,
      rushedMistakes: rushedErrs.length,
      rushedMistakeRatePct:
        rushed.length > 0 ? Number(((rushedErrs.length / rushed.length) * 100).toFixed(1)) : 0,
      deliberateMoves: deliberate.length,
      deliberateMistakes: deliberateErrs.length,
      deliberateMistakeRatePct:
        deliberate.length > 0
          ? Number(((deliberateErrs.length / deliberate.length) * 100).toFixed(1))
          : 0,
      timeTroubleMoves: tt.length,
      timeTroubleMistakes: ttErrs.length,
      avgSecondsOnBlunders,
      avgSecondsOnBestMoves,
    },
  };
}
