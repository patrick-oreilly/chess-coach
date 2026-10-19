import { getSetting, type MistakeMotif, type MoveRecord } from "./db";

export type CoachAnalysisResult = {
  summary: string;
  moveNotes: Record<number, string>;
  usedLlm: boolean;
};

const MOTIF_LABELS: Record<MistakeMotif, string> = {
  bad_trade: "unfavorable capture or defender miscount",
  hanging_piece: "leaving material undefended",
  fork_or_tactic: "allowing a tactical shot or double attack",
  mate_threat: "missing or allowing a mating net",
  king_safety: "weakening king cover or opening files against your king",
  opening_drift: "drifting from opening principles or repertoire setup",
  positional: "conceding central control or piece activity",
};

export function buildDeterministicNote(move: MoveRecord): string {
  const dropPct = Math.round(move.win_prob_drop);
  const motifText = move.motif ? MOTIF_LABELS[move.motif] : "positional concession";
  const clockContext =
    move.clock_flag === "rushed" && move.time_spent_seconds !== null
      ? ` Played in just ${move.time_spent_seconds.toFixed(0)}s with plenty of time on the clock.`
      : move.clock_flag === "time_trouble"
        ? " Played under clock pressure."
        : "";

  const bestLine = move.best_line_san ? ` (${move.best_line_san})` : "";
  return `${move.move_number}${move.color === "white" ? "." : "..."} ${move.san} cost ${dropPct}% win probability due to ${motifText}.${clockContext} Stockfish preferred ${move.best_move_san}${bestLine}.`;
}

export function buildDeterministicSummary(params: {
  userColor: "white" | "black";
  openingName: string;
  result: "win" | "loss" | "draw";
  accuracy: number;
  blunders: number;
  mistakes: number;
  keyMistakes: MoveRecord[];
}): string {
  const { userColor, openingName, result, accuracy, blunders, mistakes, keyMistakes } = params;
  if (keyMistakes.length === 0) {
    return `Clean ${result} as ${userColor} in the ${openingName} (${accuracy.toFixed(1)}% accuracy) with zero major mistakes or blunders.`;
  }
  const worst = [...keyMistakes].sort((a, b) => b.win_prob_drop - a.win_prob_drop)[0];
  const motifLabel = worst.motif ? MOTIF_LABELS[worst.motif] : "a tactical concession";
  return `Played as ${userColor} in the ${openingName} (${result}, ${accuracy.toFixed(1)}% accuracy, ${blunders} blunder${blunders === 1 ? "" : "s"}, ${mistakes} mistake${mistakes === 1 ? "" : "s"}). The critical turning point was move ${worst.move_number} (${worst.san}), losing ${Math.round(worst.win_prob_drop)}% win equity through ${motifLabel} instead of ${worst.best_move_san}.`;
}

export async function generateGameCoachCommentary(params: {
  userColor: "white" | "black";
  userRating: number;
  opponentName: string;
  opponentRating: number;
  openingName: string;
  result: "win" | "loss" | "draw";
  method: string;
  accuracy: number;
  blunders: number;
  mistakes: number;
  keyMistakes: MoveRecord[];
}): Promise<CoachAnalysisResult> {
  const fallbackNotes: Record<number, string> = {};
  for (const m of params.keyMistakes) {
    fallbackNotes[m.ply] = buildDeterministicNote(m);
  }
  const fallbackSummary = buildDeterministicSummary(params);

  const apiKey = getSetting("DEEPSEEK_API_KEY", "").trim();
  if (!apiKey) {
    return { summary: fallbackSummary, moveNotes: fallbackNotes, usedLlm: false };
  }

  try {
    const mistakeDescriptions = params.keyMistakes.map((m) => ({
      ply: m.ply,
      moveNumber: m.move_number,
      phase: m.phase,
      fenBefore: m.fen_before,
      playedSan: m.san,
      bestMoveSan: m.best_move_san,
      bestLineSan: m.best_line_san,
      evalBeforePawns: (m.eval_before_cp / 100).toFixed(2),
      evalAfterPawns: (m.eval_after_cp / 100).toFixed(2),
      winProbDropPct: Math.round(m.win_prob_drop),
      motif: m.motif,
      timeSpentSeconds: m.time_spent_seconds,
      clockRemainingSeconds: m.clock_seconds,
      clockFlag: m.clock_flag,
    }));

    const prompt = `You are a direct, perceptive personal chess coach analysing a Rapid game for Patrick (rating ${params.userRating}, plays Bird's Opening 1.f4 as White and Pirc/Modern 1...d6 as Black).

Game context:
- Patrick played: ${params.userColor}
- Opponent: ${params.opponentName} (${params.opponentRating})
- Opening: ${params.openingName}
- Result: ${params.result} by ${params.method}
- Accuracy: ${params.accuracy.toFixed(1)}% (${params.blunders} blunders, ${params.mistakes} mistakes)

Critical mistakes made by Patrick:
${JSON.stringify(mistakeDescriptions, null, 2)}

Return ONLY valid JSON matching this schema:
{
  "summary": "2-3 crisp sentences summarizing how the game went, the main strategic/tactical theme, and one concrete habit to carry into the next game.",
  "moveNotes": {
    "<ply>": "2-3 clear sentences explaining specifically WHY the played move failed (referencing the concrete refutation/tactic/defender count/clock rush) and WHY Stockfish's best move works."
  }
}`;

    const res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are an expert chess coach. Speak directly to the player in second person ('you'). Be concrete, cite exact squares and moves, avoid filler.",
          },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (!res.ok) {
      return { summary: fallbackSummary, moveNotes: fallbackNotes, usedLlm: false };
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return { summary: fallbackSummary, moveNotes: fallbackNotes, usedLlm: false };
    }

    const parsed = JSON.parse(content) as {
      summary?: string;
      moveNotes?: Record<string, string>;
    };

    const mergedNotes: Record<number, string> = { ...fallbackNotes };
    if (parsed.moveNotes) {
      for (const [k, v] of Object.entries(parsed.moveNotes)) {
        const plyNum = Number(k);
        if (!Number.isNaN(plyNum) && typeof v === "string" && v.trim()) {
          mergedNotes[plyNum] = v.trim();
        }
      }
    }

    return {
      summary: parsed.summary?.trim() || fallbackSummary,
      moveNotes: mergedNotes,
      usedLlm: true,
    };
  } catch {
    return { summary: fallbackSummary, moveNotes: fallbackNotes, usedLlm: false };
  }
}
