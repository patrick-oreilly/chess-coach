"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess, type Square } from "chess.js";
import type {
  GameRecord,
  MoveRecord,
  PuzzleCandidate,
  PuzzleRecord,
} from "@/lib/db";
import type { PatternsReport } from "@/lib/patterns";
import { Board } from "./Board";
import { EvalGraph } from "./EvalGraph";

interface OverviewPayload {
  games: GameRecord[];
  activeGameId: string | null;
  moves: MoveRecord[];
  puzzles: PuzzleRecord[];
  patterns: PatternsReport;
  settings: {
    username: string;
    hasDeepSeekKey: boolean;
    maskedDeepSeekKey: string;
  };
}

type MainTab = "review" | "train" | "patterns";
type StageMode = "single" | "split";

const MOTIF_LABELS: Record<string, string> = {
  bad_trade: "BAD RECAPTURE / UNFAVORABLE EXCHANGE",
  hanging_piece: "ONE-MOVE HANGING PIECE / OVEREXTENSION",
  fork_or_tactic: "MISSED TACTICAL FORK OR PIN",
  mate_threat: "MISSED MATING NET / BACK-RANK THREAT",
  king_safety: "KING EXPOSURE & CASTLING DELAY",
  opening_drift: "EARLY OPENING DRIFT",
  positional: "CENTRAL CONTROL & POSITIONAL CONCESSION",
};

function formatClock(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || Number.isNaN(sec)) return "--:--";
  const s = Math.max(0, Math.round(sec));
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${mins}:${rem.toString().padStart(2, "0")}`;
}

function formatEval(cp: number | null | undefined): string {
  if (cp === null || cp === undefined) return "0.0";
  if (Math.abs(cp) >= 9000) {
    const mateMoves = Math.max(1, Math.round((10000 - Math.abs(cp)) / 10));
    return `${cp > 0 ? "+M" : "-M"}${mateMoves}`;
  }
  const pawns = cp / 100;
  return `${pawns >= 0 ? "+" : ""}${pawns.toFixed(1)}`;
}

function formatRelativeDate(epochSec: number): string {
  const date = new Date(epochSec * 1000);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) {
    return `TODAY ${date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  }
  return date
    .toLocaleDateString([], {
      month: "short",
      day: "numeric",
    })
    .toUpperCase();
}

export function ChessCoachApp() {
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<MainTab>("review");
  const [stageMode, setStageMode] = useState<StageMode>("single");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [timeClassFilter, setTimeClassFilter] = useState<string>("rapid");

  // Settings modal state
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [usernameInput, setUsernameInput] = useState("patrickoreilly2");
  const [deepseekKeyInput, setDeepseekKeyInput] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);

  // Game Review state
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [moves, setMoves] = useState<MoveRecord[]>([]);
  const [currentPly, setCurrentPly] = useState<number>(1);
  const [flipped, setFlipped] = useState<boolean>(false);
  const [loadingGame, setLoadingGame] = useState<boolean>(false);
  const [refreshingCoach, setRefreshingCoach] = useState<boolean>(false);

  // Interactive Sandbox / Variation exploration state in Review tab
  const [sandboxFen, setSandboxFen] = useState<string | null>(null);
  const [sandboxLastMove, setSandboxLastMove] = useState<{
    from: string;
    to: string;
  } | null>(null);
  const [sandboxMovesSan, setSandboxMovesSan] = useState<string[]>([]);
  const [sandboxFeedback, setSandboxFeedback] = useState<string | null>(null);

  // Blunder Trainer state
  const [selectedPuzzleId, setSelectedPuzzleId] = useState<string | null>(null);
  const [puzzleFilterMotif, setPuzzleFilterMotif] = useState<string>("all");
  const [puzzleModeDueOnly, setPuzzleModeDueOnly] = useState<boolean>(false);
  const [puzzleFen, setPuzzleFen] = useState<string>(
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
  );
  const [puzzleStatus, setPuzzleStatus] = useState<
    "prompt" | "wrong" | "solved"
  >("prompt");
  const [puzzleFeedback, setPuzzleFeedback] = useState<string>("");
  const [puzzleLastMove, setPuzzleLastMove] = useState<{
    from: string;
    to: string;
  } | null>(null);
  const [showHint, setShowHint] = useState<boolean>(false);
  const replyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const clearSandbox = useCallback(() => {
    setSandboxFen(null);
    setSandboxLastMove(null);
    setSandboxMovesSan([]);
    setSandboxFeedback(null);
  }, []);

  const selectPlyAndClearSandbox = useCallback(
    (plyOrUpdater: number | ((prev: number) => number)) => {
      clearSandbox();
      setCurrentPly(plyOrUpdater);
    },
    [clearSandbox]
  );

  const loadOverview = useCallback(
    async (keepGameSelection = true) => {
      try {
        const res = await fetch(
          `/api/overview?timeClass=${encodeURIComponent(timeClassFilter)}`
        );
        const data: OverviewPayload = await res.json();
        setOverview(data);
        setUsernameInput(data.settings?.username || "patrickoreilly2");

        if (data.games.length > 0) {
          if (
            !keepGameSelection ||
            !selectedGameId ||
            !data.games.some((g) => g.id === selectedGameId)
          ) {
            setSelectedGameId(data.games[0].id);
          }
        }
        if (data.puzzles.length > 0 && !selectedPuzzleId) {
          setSelectedPuzzleId(data.puzzles[0].id);
        }
      } catch (err) {
        console.error("Failed to fetch overview:", err);
      } finally {
        setLoading(false);
      }
    },
    [timeClassFilter, selectedGameId, selectedPuzzleId]
  );

  useEffect(() => {
    loadOverview(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeClassFilter]);

  const selectedGame = useMemo(
    () => overview?.games.find((g) => g.id === selectedGameId) || null,
    [overview, selectedGameId]
  );

  useEffect(() => {
    if (!selectedGameId) return;
    let cancelled = false;
    setLoadingGame(true);
    clearSandbox();
    fetch(`/api/games/${selectedGameId}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const loadedMoves: MoveRecord[] = data.moves || [];
        const gameColor = data.game?.user_color || "white";
        setMoves(loadedMoves);
        setFlipped(false);

        const firstBlunder = loadedMoves.find(
          (m) => m.color === gameColor && m.classification === "blunder"
        );
        const firstMistake = loadedMoves.find(
          (m) => m.color === gameColor && m.classification === "mistake"
        );
        if (firstBlunder) {
          setCurrentPly(firstBlunder.ply);
        } else if (firstMistake) {
          setCurrentPly(firstMistake.ply);
        } else if (loadedMoves.length > 0) {
          setCurrentPly(loadedMoves[0].ply);
        } else {
          setCurrentPly(0);
        }
      })
      .catch((err) => console.error("Failed to load game:", err))
      .finally(() => {
        if (!cancelled) setLoadingGame(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedGameId, clearSandbox]);

  const currentMove = useMemo(() => {
    if (moves.length === 0) return null;
    if (currentPly <= 0) return null;
    return moves.find((m) => m.ply === currentPly) || moves[moves.length - 1];
  }, [moves, currentPly]);

  const jumpToNextError = useCallback(() => {
    if (!moves.length || !selectedGame) return;
    const errors = moves.filter(
      (m) =>
        m.color === selectedGame.user_color &&
        (m.classification === "blunder" ||
          m.classification === "mistake" ||
          m.classification === "inaccuracy")
    );
    if (errors.length === 0) return;
    const next = errors.find((m) => m.ply > currentPly) || errors[0];
    selectPlyAndClearSandbox(next.ply);
  }, [moves, currentPly, selectedGame, selectPlyAndClearSandbox]);

  const jumpToPrevError = useCallback(() => {
    if (!moves.length || !selectedGame) return;
    const errors = moves.filter(
      (m) =>
        m.color === selectedGame.user_color &&
        (m.classification === "blunder" ||
          m.classification === "mistake" ||
          m.classification === "inaccuracy")
    );
    if (errors.length === 0) return;
    const prev =
      [...errors].reverse().find((m) => m.ply < currentPly) ||
      errors[errors.length - 1];
    selectPlyAndClearSandbox(prev.ply);
  }, [moves, currentPly, selectedGame, selectPlyAndClearSandbox]);

  // Keyboard navigation in review view
  useEffect(() => {
    if (activeTab !== "review") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        selectPlyAndClearSandbox((p) => Math.min(moves.length, p + 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        selectPlyAndClearSandbox((p) => Math.max(0, p - 1));
      } else if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        jumpToNextError();
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (e.key === "Escape" && sandboxFen) {
        e.preventDefault();
        clearSandbox();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activeTab,
    moves.length,
    jumpToNextError,
    selectPlyAndClearSandbox,
    sandboxFen,
    clearSandbox,
  ]);

  const movePairs = useMemo(() => {
    const pairs: {
      moveNumber: number;
      white?: MoveRecord;
      black?: MoveRecord;
    }[] = [];
    for (const m of moves) {
      let row = pairs.find((p) => p.moveNumber === m.move_number);
      if (!row) {
        row = { moveNumber: m.move_number };
        pairs.push(row);
      }
      if (m.color === "white") row.white = m;
      else row.black = m;
    }
    return pairs;
  }, [moves]);

  const duePuzzlesCount = useMemo(() => {
    if (!overview) return 0;
    const todayStr = new Date().toISOString().slice(0, 10);
    return overview.puzzles.filter((p) => p.due_date <= todayStr).length;
  }, [overview]);

  // Filtered puzzles for trainer
  const filteredPuzzles = useMemo(() => {
    if (!overview) return [];
    const todayStr = new Date().toISOString().slice(0, 10);
    return overview.puzzles.filter((p) => {
      if (puzzleModeDueOnly && p.due_date > todayStr) return false;
      if (puzzleFilterMotif !== "all" && p.motif !== puzzleFilterMotif)
        return false;
      return true;
    });
  }, [overview, puzzleFilterMotif, puzzleModeDueOnly]);

  const activePuzzle = useMemo(() => {
    if (!filteredPuzzles.length) return null;
    return (
      filteredPuzzles.find((p) => p.id === selectedPuzzleId) ||
      filteredPuzzles[0]
    );
  }, [filteredPuzzles, selectedPuzzleId]);

  const activePuzzleId = activePuzzle?.id || null;

  // IMPORTANT: Depend only on activePuzzleId so background overview refreshes do NOT reset the board mid-solve!
  useEffect(() => {
    if (!activePuzzle) return;
    if (replyTimerRef.current) {
      clearTimeout(replyTimerRef.current);
      replyTimerRef.current = null;
    }
    setPuzzleFen(activePuzzle.target_fen);
    setPuzzleStatus("prompt");
    setPuzzleFeedback("");
    setPuzzleLastMove(
      activePuzzle.opponent_move_uci &&
        activePuzzle.opponent_move_uci.length >= 4
        ? {
            from: activePuzzle.opponent_move_uci.slice(0, 2),
            to: activePuzzle.opponent_move_uci.slice(2, 4),
          }
        : null
    );
    setShowHint(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePuzzleId]);

  // Board states for Review tab
  const boardOrientation: "white" | "black" = useMemo(() => {
    const base = selectedGame?.user_color || "white";
    if (!flipped) return base;
    return base === "white" ? "black" : "white";
  }, [selectedGame, flipped]);

  const displayFen = useMemo(() => {
    if (!moves.length) {
      return "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    }
    if (currentPly <= 0) {
      return moves[0].fen_before;
    }
    return currentMove?.fen_after || moves[0].fen_before;
  }, [moves, currentPly, currentMove]);

  const activeReviewFen = sandboxFen ?? displayFen;

  // Interactive move handler on the 01 / POST-MORTEM board
  const handleReviewBoardMove = useCallback(
    (from: string, to: string, promotion?: string): boolean => {
      const chess = new Chess(activeReviewFen);
      let moveObj = null;
      try {
        const piece = chess.get(from as Square);
        const isPromo =
          piece &&
          piece.type === "p" &&
          ((piece.color === "w" && to[1] === "8") ||
            (piece.color === "b" && to[1] === "1"));
        moveObj = chess.move(
          isPromo ? { from, to, promotion: promotion || "q" } : { from, to }
        );
      } catch {
        return false;
      }
      if (!moveObj) return false;

      const playedUci = `${from}${to}${moveObj.promotion || ""}`.toLowerCase();

      // 1. If we're on the main game line and the user played the exact next move from the game, advance currentPly!
      if (!sandboxFen) {
        const nextGameMove = moves.find((m) => m.ply === currentPly + 1);
        if (nextGameMove && nextGameMove.uci.toLowerCase() === playedUci) {
          setCurrentPly(nextGameMove.ply);
          return true;
        }
      }

      // 2. Check if the user is testing a move from currentMove.fen_before (e.g. "Rewind & Try Move")
      let feedbackMsg = `VARIATION EXPLORATION: Played ${moveObj.san}. Drag pieces for either side to explore or click [RETURN TO GAME] to exit.`;
      if (currentMove && activeReviewFen === currentMove.fen_before) {
        if (
          playedUci === currentMove.best_move_uci?.toLowerCase() ||
          moveObj.san === currentMove.best_move_san
        ) {
          feedbackMsg = `✓ ENGINE BEST FOUND: ${moveObj.san} is Stockfish's #1 continuation (${currentMove.best_line_san || moveObj.san}) instead of ${currentMove.san}!`;
        } else if (
          playedUci === currentMove.uci?.toLowerCase() ||
          moveObj.san === currentMove.san
        ) {
          feedbackMsg = `⚠ IN-GAME MOVE REPEATED: ${moveObj.san} was the move played in the match (${currentMove.classification.toUpperCase()}). Best was ${currentMove.best_move_san}.`;
        } else {
          feedbackMsg = `VARIATION: Played ${moveObj.san} (Stockfish's #1 recommendation from that position was ${currentMove.best_move_san}).`;
        }
      } else if (sandboxFen === null) {
        const nextGameMove = moves.find((m) => m.ply === currentPly + 1);
        if (
          nextGameMove &&
          (playedUci === nextGameMove.best_move_uci?.toLowerCase() ||
            moveObj.san === nextGameMove.best_move_san)
        ) {
          feedbackMsg = `✓ ENGINE BEST FOUND FOR PLY ${nextGameMove.ply}: ${moveObj.san} matches Stockfish's #1 move (in-game move was ${nextGameMove.san}).`;
        }
      }

      setSandboxFen(chess.fen());
      setSandboxLastMove({ from, to });
      setSandboxMovesSan((prev) => [...prev, moveObj.san]);
      setSandboxFeedback(feedbackMsg);
      return true;
    },
    [activeReviewFen, sandboxFen, moves, currentPly, currentMove]
  );

  // Interactive move handler on the 02 / DRILL DECK board
  const handlePuzzleMove = async (
    from: string,
    to: string,
    promotion = "q"
  ): Promise<boolean> => {
    if (!activePuzzle || puzzleStatus === "solved") return false;

    const chess = new Chess(puzzleFen);
    let moveObj = null;
    try {
      const piece = chess.get(from as Square);
      const isPromo =
        piece &&
        piece.type === "p" &&
        ((piece.color === "w" && to[1] === "8") ||
          (piece.color === "b" && to[1] === "1"));
      moveObj = chess.move(
        isPromo ? { from, to, promotion } : { from, to }
      );
    } catch {
      return false;
    }
    if (!moveObj) return false;

    const candidateUci = `${from}${to}${moveObj.promotion || ""}`;
    const targetBestUci = activePuzzle.best_move_uci;

    let candidates: PuzzleCandidate[] = [];
    try {
      candidates = JSON.parse(activePuzzle.candidates_json || "[]");
    } catch {
      candidates = [];
    }

    const bestCp = candidates[0]?.cp ?? activePuzzle.eval_before_cp;
    const matchingCand = candidates.find(
      (c) =>
        c.uci.toLowerCase() === candidateUci.toLowerCase() ||
        c.san === moveObj.san
    );

    const isExactBest =
      candidateUci.toLowerCase() === targetBestUci?.toLowerCase() ||
      moveObj.san === activePuzzle.best_move_san;

    const isCloseAlternative =
      !isExactBest &&
      matchingCand !== undefined &&
      Math.abs(bestCp - matchingCand.cp) <= 35 &&
      candidateUci.toLowerCase() !== activePuzzle.played_move_uci?.toLowerCase();

    if (isExactBest || isCloseAlternative) {
      const afterUserMoveFen = chess.fen();
      setPuzzleFen(afterUserMoveFen);
      setPuzzleLastMove({ from, to });
      setPuzzleStatus("solved");
      setPuzzleFeedback(
        isExactBest
          ? `VERIFIED: ${moveObj.san} IS STOCKFISH'S #1 CONTINUATION (REPLACING YOUR IN-GAME ${activePuzzle.played_move_san}).`
          : `ACCEPTED: ${moveObj.san} IS WITHIN 0.3 PAWNS OF STOCKFISH'S #1 LINE (${activePuzzle.best_move_san}).`
      );

      if (activePuzzle.solution_line_san) {
        const tokens = activePuzzle.solution_line_san
          .split(" ")
          .filter(Boolean);
        if (tokens.length > 1 && isExactBest) {
          if (replyTimerRef.current) clearTimeout(replyTimerRef.current);
          replyTimerRef.current = setTimeout(() => {
            try {
              const replyChess = new Chess(afterUserMoveFen);
              const reply = replyChess.move(tokens[1]);
              if (reply) {
                setPuzzleFen(replyChess.fen());
                setPuzzleLastMove({ from: reply.from, to: reply.to });
              }
            } catch {
              // ignore PV parse failure
            }
          }, 420);
        }
      }

      fetch("/api/puzzles/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ puzzleId: activePuzzle.id, success: true }),
      }).then(() => loadOverview(true));

      return true;
    } else {
      const playedSameBlunder =
        moveObj.san === activePuzzle.played_move_san ||
        candidateUci.toLowerCase() ===
          activePuzzle.played_move_uci?.toLowerCase();

      setPuzzleStatus("wrong");
      setPuzzleFeedback(
        playedSameBlunder
          ? `REJECTED: YOU REPEATED YOUR IN-GAME BLUNDER (${activePuzzle.played_move_san}). PIECE SNAPPED BACK — TRY AGAIN.`
          : `SUBOPTIMAL: ${moveObj.san} MISSES THE CRITICAL CONTINUATION. PIECE SNAPPED BACK — TRY AGAIN.`
      );
      return false;
    }
  };

  const handleSyncGames = async () => {
    setSyncing(true);
    setSyncStatus("RUNNING STOCKFISH 18 + DEEPSEEK TELEMETRY...");
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: usernameInput,
          limit: 6,
          timeClass: timeClassFilter === "all" ? "rapid" : timeClassFilter,
        }),
      });
      const data = await res.json();
      if (data.ok || data.analyzed !== undefined) {
        setSyncStatus(
          (data.analyzed || data.newlyAnalyzed || 0) > 0
            ? `ANALYZED ${data.analyzed || data.newlyAnalyzed} NEW MATCH(ES)`
            : `ARCHIVE UP TO DATE`
        );
        await loadOverview(true);
      } else {
        setSyncStatus(`SYNC ERROR: ${data.error || "FAILED"}`);
      }
    } catch (err) {
      setSyncStatus(`SYNC FAILED: ${(err as Error).message}`);
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncStatus(null), 5000);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: usernameInput,
          deepSeekApiKey: deepseekKeyInput,
        }),
      });
      setDeepseekKeyInput("");
      setSettingsOpen(false);
      await loadOverview(true);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleRefreshDeepSeek = async () => {
    if (!selectedGameId) return;
    setRefreshingCoach(true);
    try {
      await fetch(`/api/games/${selectedGameId}`, { method: "POST" });
      const res = await fetch(`/api/games/${selectedGameId}`);
      const data = await res.json();
      setMoves(data.moves || []);
      await loadOverview(true);
    } finally {
      setRefreshingCoach(false);
    }
  };

  const bestContinuationFen = useMemo(() => {
    if (!currentMove?.fen_before || !currentMove?.best_move_san) {
      return displayFen;
    }
    try {
      const c = new Chess(currentMove.fen_before);
      c.move(currentMove.best_move_san);
      return c.fen();
    } catch {
      return displayFen;
    }
  }, [currentMove, displayFen]);

  const lastMoveSquares = useMemo(() => {
    if (sandboxLastMove) return sandboxLastMove;
    if (!currentMove?.uci || currentMove.uci.length < 4) return null;
    return {
      from: currentMove.uci.slice(0, 2),
      to: currentMove.uci.slice(2, 4),
    };
  }, [currentMove, sandboxLastMove]);

  const bestMoveSquares = useMemo(() => {
    if (sandboxFen) return null;
    if (!currentMove?.best_move_uci || currentMove.best_move_uci.length < 4)
      return null;
    return {
      from: currentMove.best_move_uci.slice(0, 2),
      to: currentMove.best_move_uci.slice(2, 4),
    };
  }, [currentMove, sandboxFen]);

  const evalGaugeWhitePct = useMemo(() => {
    if (!currentMove) return 50;
    const cp = currentMove.eval_after_cp ?? 0;
    const clamped = Math.max(-900, Math.min(900, cp));
    return Math.round(50 + (clamped / 900) * 46);
  }, [currentMove]);

  const topPlayerIsUser = boardOrientation !== selectedGame?.user_color;
  const userClockAtPly = useMemo(() => {
    if (!moves.length || !selectedGame) return null;
    const slice = moves.filter(
      (m) => m.ply <= currentPly && m.color === selectedGame.user_color
    );
    return slice.length ? slice[slice.length - 1].clock_seconds : null;
  }, [moves, currentPly, selectedGame]);

  const opponentClockAtPly = useMemo(() => {
    if (!moves.length || !selectedGame) return null;
    const oppColor = selectedGame.user_color === "white" ? "black" : "white";
    const slice = moves.filter(
      (m) => m.ply <= currentPly && m.color === oppColor
    );
    return slice.length ? slice[slice.length - 1].clock_seconds : null;
  }, [moves, currentPly, selectedGame]);

  const recordSummary = useMemo(() => {
    const games = overview?.games || [];
    return {
      wins: games.filter((g) => g.result === "win").length,
      losses: games.filter((g) => g.result === "loss").length,
      draws: games.filter((g) => g.result === "draw").length,
      totalBlunders: games.reduce((s, g) => s + (g.blunders || 0), 0),
    };
  }, [overview]);

  if (loading && !overview) {
    return (
      <div className="min-h-screen bg-paper text-ink flex items-center justify-center font-mono text-xs uppercase tracking-[0.2em]">
        INITIALIZING SWISS BRUTALIST TELEMETRY MATRIX...
      </div>
    );
  }

  const isUserMove =
    currentMove && selectedGame && currentMove.color === selectedGame.user_color;

  return (
    <div className="min-h-screen flex flex-col bg-paper text-ink selection:bg-ink selection:text-paper">
      {/* =====================================================================
          00 // STRUCTURAL COMMAND BAR
         ===================================================================== */}
      <header className="border-b-2 border-rule-strong bg-paper-raised grid grid-cols-12 divide-x divide-rule-strong">
        {/* Masthead */}
        <div className="col-span-12 lg:col-span-3 px-4 py-3 flex items-center justify-between">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-faint">
              INSTRUMENT // {overview?.settings?.username || "PATRICKOREILLY2"}
            </div>
            <div className="font-serif text-lg font-bold tracking-tight text-ink leading-none mt-0.5">
              1.F4 // CHESS COACH
            </div>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-widest px-1.5 py-0.5 border border-rule-strong bg-paper text-ink font-semibold">
            SF18
          </span>
        </div>

        {/* Numbered Mode Cells */}
        <div className="col-span-12 lg:col-span-5 grid grid-cols-3 divide-x divide-rule-strong">
          {[
            {
              id: "review" as MainTab,
              num: "01",
              label: "POST-MORTEM",
              meta: `${overview?.games.length || 0} GAMES`,
            },
            {
              id: "train" as MainTab,
              num: "02",
              label: "DRILL DECK",
              meta: `${duePuzzlesCount} DUE`,
            },
            {
              id: "patterns" as MainTab,
              num: "03",
              label: "LEAK MATRIX",
              meta: `${overview?.patterns.overallAccuracy || 0}% ACC`,
            },
          ].map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3.5 py-2.5 text-left transition-colors flex flex-col justify-between ${
                  active
                    ? "bg-ink text-paper"
                    : "bg-paper-raised text-ink hover:bg-paper-sunken"
                }`}
              >
                <div className="w-full flex items-center justify-between font-mono text-[10px] tracking-[0.16em]">
                  <span className={active ? "text-paper/70" : "text-ink-faint"}>
                    {tab.num} / MODE
                  </span>
                  <span
                    className={`px-1 py-0.2 text-[9px] font-bold ${
                      active
                        ? "bg-paper text-ink"
                        : "border border-rule text-ink-muted"
                    }`}
                  >
                    {tab.meta}
                  </span>
                </div>
                <div className="font-mono text-xs font-bold tracking-[0.14em] mt-1">
                  {tab.label}
                </div>
              </button>
            );
          })}
        </div>

        {/* Time Control + Controls */}
        <div className="col-span-12 lg:col-span-4 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 bg-paper-raised">
          {/* Time Class Selector */}
          <div className="flex items-center border border-rule-strong divide-x divide-rule-strong font-mono text-[10px] uppercase">
            {["rapid", "blitz", "daily", "all"].map((tc) => (
              <button
                key={tc}
                onClick={() => setTimeClassFilter(tc)}
                className={`px-2 py-1 tracking-wider transition-colors ${
                  timeClassFilter === tc
                    ? "bg-ink text-paper font-semibold"
                    : "bg-paper text-ink-muted hover:text-ink"
                }`}
              >
                {tc}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase">
            <button
              onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
              className="px-2.5 py-1 border border-rule-strong bg-paper text-ink hover:bg-ink hover:text-paper transition-colors tracking-wider font-semibold"
              title="Toggle High-Contrast Light / Dark Instrument Theme"
            >
              {theme === "light" ? "INK: LIGHT" : "INK: DARK"}
            </button>

            <button
              onClick={() => setSettingsOpen((v) => !v)}
              className={`px-2.5 py-1 border border-rule-strong transition-colors tracking-wider font-semibold ${
                overview?.settings?.hasDeepSeekKey
                  ? "bg-green-soft text-green"
                  : "bg-paper text-ink hover:bg-paper-sunken"
              }`}
            >
              {overview?.settings?.hasDeepSeekKey ? "DEEPSEEK: ON" : "API KEY"}
            </button>

            <button
              onClick={handleSyncGames}
              disabled={syncing}
              className="px-3 py-1 border border-rule-strong bg-ink text-paper font-bold tracking-wider hover:opacity-90 disabled:opacity-50"
            >
              {syncing ? "SYNCING..." : "SYNC CHESS.COM"}
            </button>
          </div>
        </div>
      </header>

      {/* Sync Banner */}
      {syncStatus && (
        <div className="border-b border-rule-strong bg-amber-soft px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-amber flex items-center justify-between">
          <span>STATUS // {syncStatus}</span>
          <button
            onClick={() => setSyncStatus(null)}
            className="underline font-bold"
          >
            DISMISS
          </button>
        </div>
      )}

      {/* Settings Drawer */}
      {settingsOpen && (
        <div className="border-b-2 border-rule-strong bg-paper-sunken px-6 py-4">
          <form
            onSubmit={handleSaveSettings}
            className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end"
          >
            <div className="md:col-span-3">
              <label className="block font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted mb-1">
                01 / CHESS.COM USERNAME
              </label>
              <input
                type="text"
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                className="w-full px-3 py-1.5 bg-paper border border-rule-strong font-mono text-xs text-ink focus:outline-none"
              />
            </div>
            <div className="md:col-span-6">
              <label className="block font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted mb-1">
                02 / DEEPSEEK API KEY (STORED LOCALLY IN SQLITE)
              </label>
              <input
                type="password"
                placeholder={
                  overview?.settings?.hasDeepSeekKey
                    ? `${overview.settings.maskedDeepSeekKey} (CONFIGURED — ENTER NEW KEY TO OVERWRITE)`
                    : "sk-..."
                }
                value={deepseekKeyInput}
                onChange={(e) => setDeepseekKeyInput(e.target.value)}
                className="w-full px-3 py-1.5 bg-paper border border-rule-strong font-mono text-xs text-ink focus:outline-none"
              />
            </div>
            <div className="md:col-span-3 flex items-center gap-2">
              <button
                type="submit"
                disabled={savingSettings}
                className="px-4 py-1.5 bg-ink text-paper font-mono text-xs uppercase tracking-widest font-bold border border-rule-strong"
              >
                {savingSettings ? "SAVING..." : "COMMIT CONFIG"}
              </button>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="px-3 py-1.5 bg-paper text-ink font-mono text-xs uppercase tracking-widest border border-rule-strong"
              >
                CLOSE
              </button>
            </div>
          </form>
        </div>
      )}

      {/* =====================================================================
          01 // POST-MORTEM INSTRUMENT GRID
         ===================================================================== */}
      {activeTab === "review" && (
        <div className="flex-1 flex flex-col">
          {/* Oversized 5-Cell Tabular KPI Ticker Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-5 border-b-2 border-rule-strong bg-paper-raised divide-x divide-y lg:divide-y-0 divide-rule-strong">
            <div className="px-4 py-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
                01 // ACTIVE MATCH
              </div>
              <div className="font-serif text-lg font-bold text-ink truncate mt-0.5">
                {selectedGame
                  ? `vs. ${selectedGame.opponent_name} (${selectedGame.opponent_rating})`
                  : "NO MATCH SELECTED"}
              </div>
              <div className="font-mono text-[10px] uppercase text-ink-muted truncate mt-0.5">
                {selectedGame
                  ? `${selectedGame.user_color.toUpperCase()} · ${selectedGame.opening_name}`
                  : "--"}
              </div>
            </div>

            <div className="px-4 py-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
                02 // ACCURACY INDEX
              </div>
              <div className="font-mono text-2xl font-bold tabular-nums text-ink mt-0.5">
                {selectedGame?.accuracy ?? "--"}%
              </div>
              <div className="font-mono text-[10px] uppercase text-ink-muted">
                ARCHIVE AVG: {overview?.patterns.overallAccuracy ?? "--"}%
              </div>
            </div>

            <div className="px-4 py-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
                03 // CRITICAL ERRORS
              </div>
              <div className="font-mono text-2xl font-bold tabular-nums text-red mt-0.5">
                {selectedGame?.blunders ?? 0} BL /{" "}
                <span className="text-amber">
                  {selectedGame?.mistakes ?? 0} MK
                </span>
              </div>
              <div className="font-mono text-[10px] uppercase text-ink-muted">
                {selectedGame?.inaccuracies ?? 0} INACCURACIES
              </div>
            </div>

            <div className="px-4 py-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
                04 // STOCKFISH 18 EVAL
              </div>
              <div className="font-mono text-2xl font-bold tabular-nums text-ink mt-0.5">
                {currentMove ? formatEval(currentMove.eval_after_cp) : "+0.0"}
              </div>
              <div className="font-mono text-[10px] uppercase text-ink-muted">
                PLY {currentPly}/{moves.length} ·{" "}
                {currentMove ? currentMove.phase.toUpperCase() : "START"}
              </div>
            </div>

            <div className="col-span-2 lg:col-span-1 px-4 py-3 flex items-center justify-between gap-2 bg-paper">
              <button
                onClick={jumpToPrevError}
                className="px-2.5 py-2 border border-rule-strong bg-paper-raised hover:bg-ink hover:text-paper font-mono text-[10px] uppercase tracking-wider font-bold transition-colors"
                title="Previous Error"
              >
                ◀ PREV ERR
              </button>
              <button
                onClick={jumpToNextError}
                className="flex-1 py-2 px-3 bg-red text-white font-mono text-[11px] uppercase tracking-[0.14em] font-bold hover:opacity-90 transition-opacity text-center"
              >
                NEXT BLUNDER →
              </button>
            </div>
          </div>

          {/* 3-Zone Hairline Matrix */}
          <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-rule-strong flex-1">
            {/* ZONE 01: ARCHIVE INDEX (3 cols) */}
            <aside className="lg:col-span-3 flex flex-col bg-paper">
              <div className="px-3.5 py-2.5 border-b border-rule-strong bg-paper-sunken flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.18em] font-semibold">
                <span>01 / ARCHIVE INDEX</span>
                <span className="text-ink-muted">
                  {overview?.games.length || 0} RECORDS
                </span>
              </div>

              <div className="divide-y divide-rule overflow-y-auto max-h-[700px]">
                {overview?.games.map((g, idx) => {
                  const active = g.id === selectedGameId;
                  const badgeTone =
                    g.result === "win"
                      ? "bg-green text-white"
                      : g.result === "loss"
                        ? "bg-red text-white"
                        : "bg-ink-muted text-white";

                  return (
                    <button
                      key={g.id}
                      onClick={() => setSelectedGameId(g.id)}
                      className={`w-full text-left px-3.5 py-3 transition-colors ${
                        active
                          ? "bg-ink text-paper"
                          : "bg-paper hover:bg-paper-raised text-ink"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 font-mono text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`text-[10px] tabular-nums ${
                              active ? "text-paper/60" : "text-ink-faint"
                            }`}
                          >
                            {String(idx + 1).padStart(2, "0")}
                          </span>
                          <span
                            className={`px-1.5 py-0.5 text-[9px] font-bold uppercase ${badgeTone}`}
                          >
                            {g.result === "win"
                              ? "W"
                              : g.result === "loss"
                                ? "L"
                                : "D"}
                          </span>
                          <span className="font-bold truncate">
                            {g.opponent_name}
                          </span>
                        </div>
                        <span
                          className={`text-[10px] tabular-nums shrink-0 ${
                            active ? "text-paper/75" : "text-ink-muted"
                          }`}
                        >
                          ({g.opponent_rating})
                        </span>
                      </div>

                      <div
                        className={`mt-1.5 text-[11px] font-mono truncate ${
                          active ? "text-paper/80" : "text-ink-muted"
                        }`}
                      >
                        {g.user_color === "white" ? "WHITE" : "BLACK"} ·{" "}
                        {g.opening_name}
                      </div>

                      <div className="mt-2 pt-1.5 border-t border-current/15 flex items-center justify-between font-mono text-[10px] tabular-nums">
                        <span>ACC {g.accuracy}%</span>
                        <span
                          className={
                            g.blunders > 0
                              ? active
                                ? "text-red-300 font-bold"
                                : "text-red font-bold"
                              : active
                                ? "text-paper/60"
                                : "text-ink-faint"
                          }
                        >
                          {g.blunders} BL · {g.mistakes} MK
                        </span>
                        <span
                          className={active ? "text-paper/60" : "text-ink-faint"}
                        >
                          {formatRelativeDate(g.end_time)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </aside>

            {/* ZONE 02: INSTRUMENT STAGE (5 cols) */}
            <section className="lg:col-span-5 flex flex-col justify-between bg-paper-raised">
              {/* Stage Subheader */}
              <div className="px-4 py-2 border-b border-rule-strong bg-paper-sunken flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.16em]">
                <span className="font-semibold">
                  02 / INSTRUMENT STAGE ({boardOrientation.toUpperCase()} POV)
                </span>
                <div className="flex items-center gap-1.5">
                  {isUserMove &&
                    (currentMove.classification === "blunder" ||
                      currentMove.classification === "mistake") &&
                    sandboxFen !== currentMove.fen_before && (
                      <button
                        onClick={() => {
                          setSandboxFen(currentMove.fen_before);
                          setSandboxLastMove(null);
                          setSandboxMovesSan([]);
                          setSandboxFeedback(
                            `REWINDED BEFORE ${currentMove.san}?? — Drag your ${selectedGame?.user_color} piece on the board to test a better continuation!`
                          );
                        }}
                        className="px-2 py-0.5 border border-rule-strong bg-amber-soft text-amber font-bold hover:bg-ink hover:text-paper transition-colors"
                      >
                        ↺ TRY BEFORE BLUNDER
                      </button>
                    )}

                  <div className="flex items-center border border-rule-strong divide-x divide-rule-strong">
                    <button
                      onClick={() => setStageMode("single")}
                      className={`px-2 py-0.5 font-semibold ${
                        stageMode === "single"
                          ? "bg-ink text-paper"
                          : "bg-paper text-ink-muted hover:text-ink"
                      }`}
                    >
                      SINGLE
                    </button>
                    <button
                      onClick={() => setStageMode("split")}
                      className={`px-2 py-0.5 font-semibold ${
                        stageMode === "split"
                          ? "bg-ink text-paper"
                          : "bg-paper text-ink-muted hover:text-ink"
                      }`}
                      title="Compare Your Move vs. Stockfish Best Continuation Side-by-Side"
                    >
                      SPLIT DIFF
                    </button>
                  </div>
                </div>
              </div>

              {/* Sandbox Banner when exploring custom moves on the board */}
              {sandboxFen && (
                <div className="px-4 py-1.5 border-b border-rule-strong bg-green-soft text-green font-mono text-[11px] flex items-center justify-between gap-2">
                  <span className="truncate font-semibold">
                    {sandboxMovesSan.length > 0
                      ? `SANDBOX LINE: ${sandboxMovesSan.join(" → ")}`
                      : "INTERACTIVE TEST MODE: DRAG A PIECE TO MOVE"}
                  </span>
                  <button
                    onClick={clearSandbox}
                    className="px-2 py-0.5 bg-ink text-paper text-[10px] uppercase font-bold shrink-0"
                  >
                    RETURN TO GAME PLY
                  </button>
                </div>
              )}

              {/* Top Player Bar */}
              <div className="px-4 py-2.5 border-b border-rule-strong flex items-center justify-between font-mono text-xs bg-paper">
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2.5 h-2.5 border border-rule-strong ${
                      boardOrientation === "white" ? "bg-[#1a212b]" : "bg-[#f3efe6]"
                    }`}
                  />
                  <span className="font-bold uppercase">
                    {topPlayerIsUser
                      ? `${overview?.settings?.username || "YOU"} (${selectedGame?.user_rating || ""})`
                      : `${selectedGame?.opponent_name || "OPPONENT"} (${selectedGame?.opponent_rating || ""})`}
                  </span>
                </div>
                <span className="px-2 py-0.5 border border-rule-strong bg-paper-raised font-mono text-xs font-bold tabular-nums">
                  {formatClock(
                    topPlayerIsUser ? userClockAtPly : opponentClockAtPly
                  )}
                </span>
              </div>

              {/* Center Stage: Single Board OR Split Diff */}
              <div className="p-4 flex-1 flex items-center justify-center bg-paper-raised">
                {stageMode === "single" ? (
                  <div className="w-full max-w-[450px] flex items-stretch gap-2.5">
                    {/* Vertical Stockfish Eval Bar */}
                    <div
                      className="w-5 border border-rule-strong bg-[#1e2530] flex flex-col justify-end overflow-hidden shrink-0"
                      title="Stockfish 18 Evaluation Gauge"
                    >
                      <div
                        className="w-full bg-[#f0eadc] transition-all duration-300"
                        style={{ height: `${evalGaugeWhitePct}%` }}
                      />
                    </div>
                    <div className="flex-1">
                      <Board
                        fen={activeReviewFen}
                        orientation={boardOrientation}
                        interactive={true}
                        onPieceDrop={handleReviewBoardMove}
                        lastMove={lastMoveSquares}
                        highlightMove={
                          isUserMove &&
                          (currentMove.classification === "blunder" ||
                            currentMove.classification === "mistake" ||
                            currentMove.classification === "inaccuracy")
                            ? bestMoveSquares
                            : null
                        }
                      />
                    </div>
                  </div>
                ) : (
                  <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="border border-rule-strong bg-paper p-2">
                      <div className="mb-1.5 pb-1 border-b border-rule flex items-center justify-between font-mono text-[10px] uppercase">
                        <span className="text-red font-bold">
                          01 // PLAYED ({currentMove?.san || "START"})
                        </span>
                        <span className="tabular-nums">
                          {currentMove
                            ? formatEval(currentMove.eval_after_cp)
                            : "0.0"}
                        </span>
                      </div>
                      <Board
                        fen={activeReviewFen}
                        orientation={boardOrientation}
                        interactive={true}
                        onPieceDrop={handleReviewBoardMove}
                        lastMove={lastMoveSquares}
                      />
                    </div>
                    <div className="border border-rule-strong bg-paper p-2">
                      <div className="mb-1.5 pb-1 border-b border-rule flex items-center justify-between font-mono text-[10px] uppercase">
                        <span className="text-green font-bold">
                          02 // ENGINE BEST ({currentMove?.best_move_san || "--"})
                        </span>
                        <span className="tabular-nums">
                          {currentMove
                            ? formatEval(currentMove.eval_before_cp)
                            : "0.0"}
                        </span>
                      </div>
                      <Board
                        fen={bestContinuationFen}
                        orientation={boardOrientation}
                        interactive={false}
                        highlightMove={bestMoveSquares}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Bottom Player Bar */}
              <div className="px-4 py-2.5 border-t border-rule-strong flex items-center justify-between font-mono text-xs bg-paper">
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2.5 h-2.5 border border-rule-strong ${
                      boardOrientation === "white" ? "bg-[#f3efe6]" : "bg-[#1a212b]"
                    }`}
                  />
                  <span className="font-bold uppercase">
                    {!topPlayerIsUser
                      ? `${overview?.settings?.username || "YOU"} (${selectedGame?.user_rating || ""})`
                      : `${selectedGame?.opponent_name || "OPPONENT"} (${selectedGame?.opponent_rating || ""})`}
                  </span>
                </div>
                <span className="px-2 py-0.5 border border-rule-strong bg-paper-raised font-mono text-xs font-bold tabular-nums">
                  {formatClock(
                    !topPlayerIsUser ? userClockAtPly : opponentClockAtPly
                  )}
                </span>
              </div>

              {/* 5-Cell Structural Transport Bar */}
              <div className="grid grid-cols-5 border-t-2 border-rule-strong divide-x divide-rule-strong font-mono text-xs bg-paper-raised">
                <button
                  onClick={() => selectPlyAndClearSandbox(0)}
                  className="py-2.5 hover:bg-ink hover:text-paper transition-colors font-bold"
                  title="Jump to Start"
                >
                  |◀
                </button>
                <button
                  onClick={() =>
                    selectPlyAndClearSandbox((p) => Math.max(0, p - 1))
                  }
                  className="py-2.5 hover:bg-ink hover:text-paper transition-colors font-bold"
                  title="Previous Ply (←)"
                >
                  ◀ PREV
                </button>
                <button
                  onClick={() =>
                    selectPlyAndClearSandbox((p) =>
                      Math.min(moves.length, p + 1)
                    )
                  }
                  className="py-2.5 hover:bg-ink hover:text-paper transition-colors font-bold"
                  title="Next Ply (→)"
                >
                  NEXT ▶
                </button>
                <button
                  onClick={() => selectPlyAndClearSandbox(moves.length)}
                  className="py-2.5 hover:bg-ink hover:text-paper transition-colors font-bold"
                  title="Jump to End"
                >
                  ▶|
                </button>
                <button
                  onClick={() => setFlipped((f) => !f)}
                  className="py-2.5 hover:bg-ink hover:text-paper transition-colors font-bold uppercase"
                  title="Flip Orientation (F)"
                >
                  FLIP
                </button>
              </div>
            </section>

            {/* ZONE 03: TELEMETRY, COACH DIAGNOSTIC & SCORE SHEET (4 cols) */}
            <aside className="lg:col-span-4 flex flex-col divide-y divide-rule-strong bg-paper">
              {/* Topographic Win-Equity Curve */}
              <div className="p-3.5 bg-paper-raised">
                <EvalGraph
                  moves={moves}
                  userColor={selectedGame?.user_color || "white"}
                  currentPly={currentPly}
                  onSelectPly={(ply) => selectPlyAndClearSandbox(ply)}
                />
              </div>

              {/* Coach Diagnostic Readout */}
              <div className="p-4 bg-paper">
                {sandboxFeedback && (
                  <div className="mb-3 p-2.5 border border-rule-strong bg-paper-raised font-mono text-xs text-ink">
                    {sandboxFeedback}
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 pb-2 mb-2.5 border-b border-rule">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold uppercase">
                      {currentMove
                        ? `${currentMove.move_number}${
                            currentMove.color === "white" ? "." : "..."
                          }${currentMove.san}`
                        : "START POSITION"}
                    </span>
                    {currentMove && (
                      <span
                        className={`font-mono text-[10px] uppercase px-1.5 py-0.5 font-bold ${
                          currentMove.classification === "blunder"
                            ? "bg-red text-white"
                            : currentMove.classification === "mistake"
                              ? "bg-amber text-white"
                              : currentMove.classification === "inaccuracy"
                                ? "bg-amber-soft text-amber border border-amber"
                                : "bg-green-soft text-green"
                        }`}
                      >
                        {currentMove.classification}
                      </span>
                    )}
                  </div>

                  {currentMove?.time_spent_seconds !== null &&
                    currentMove?.time_spent_seconds !== undefined && (
                      <span
                        className={`font-mono text-[10px] uppercase px-1.5 py-0.5 border ${
                          currentMove.clock_flag === "rushed"
                            ? "border-red bg-red-soft text-red font-bold"
                            : "border-rule text-ink-muted"
                        }`}
                      >
                        {currentMove.time_spent_seconds}S{" "}
                        {currentMove.clock_flag === "rushed" ? "// RUSHED" : ""}
                      </span>
                    )}
                </div>

                {currentMove ? (
                  <>
                    {currentMove.motif && (
                      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted mb-1.5">
                        MOTIF //{" "}
                        <span className="text-ink font-semibold">
                          {MOTIF_LABELS[currentMove.motif] || currentMove.motif}
                        </span>
                      </div>
                    )}

                    <p className="text-xs leading-relaxed text-ink">
                      {currentMove.coach_note ||
                        (isUserMove
                          ? `Solid move (${currentMove.san}). Maintains structural equilibrium.`
                          : `Opponent played ${currentMove.san}.`)}
                    </p>

                    {currentMove.best_move_san &&
                      currentMove.best_move_san !== currentMove.san && (
                        <div className="mt-3 pt-2.5 border-t border-rule flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
                          <div>
                            <span className="text-ink-faint uppercase">
                              BEST LINE:{" "}
                            </span>
                            <span className="text-green font-bold">
                              {currentMove.best_move_san}
                            </span>
                            {currentMove.best_line_san && (
                              <span className="text-ink-muted ml-1.5">
                                ({currentMove.best_line_san})
                              </span>
                            )}
                          </div>

                          {isUserMove &&
                            (currentMove.classification === "blunder" ||
                              currentMove.classification === "mistake") && (
                              <button
                                onClick={() => {
                                  const match = overview?.puzzles.find(
                                    (p) =>
                                      p.game_id === selectedGameId &&
                                      p.ply === currentMove.ply
                                  );
                                  if (match) setSelectedPuzzleId(match.id);
                                  setActiveTab("train");
                                }}
                                className="px-2 py-0.5 border border-rule-strong bg-ink text-paper text-[10px] uppercase tracking-wider font-bold"
                              >
                                DRILL POSITION →
                              </button>
                            )}
                        </div>
                      )}

                    {overview?.settings?.hasDeepSeekKey && (
                      <div className="mt-2.5 flex justify-end">
                        <button
                          onClick={handleRefreshDeepSeek}
                          disabled={refreshingCoach}
                          className="font-mono text-[10px] uppercase tracking-wider underline text-ink-muted hover:text-ink"
                        >
                          {refreshingCoach
                            ? "QUERYING DEEPSEEK..."
                            : "REFRESH DEEPSEEK ANALYSIS"}
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="font-mono text-xs text-ink-muted">
                    USE ARROW KEYS (← / →), DRAG PIECES ON THE BOARD, OR PRESS
                    [B] TO JUMP DIRECTLY TO YOUR FIRST CRITICAL BLUNDER.
                  </p>
                )}
              </div>

              {/* 2-Column Tabular Score Sheet */}
              <div className="flex-1 flex flex-col min-h-[260px]">
                <div className="px-3.5 py-2 border-b border-rule-strong bg-paper-sunken flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.18em] font-semibold">
                  <span>03 / SCORE SHEET LOG</span>
                  <span className="text-ink-muted">
                    {loadingGame ? "LOADING..." : `${movePairs.length} TURNS`}
                  </span>
                </div>

                <div className="overflow-y-auto max-h-[310px] divide-y divide-rule font-mono text-xs">
                  {movePairs.map((pair) => (
                    <div
                      key={pair.moveNumber}
                      className="grid grid-cols-12 divide-x divide-rule items-stretch"
                    >
                      <div className="col-span-2 px-2 py-1.5 bg-paper-sunken text-ink-faint text-[11px] tabular-nums flex items-center">
                        {String(pair.moveNumber).padStart(2, "0")}.
                      </div>

                      {[pair.white, pair.black].map((m, idx) => {
                        if (!m) {
                          return (
                            <div
                              key={idx}
                              className="col-span-5 px-2.5 py-1.5 bg-paper"
                            />
                          );
                        }
                        const isSelected = m.ply === currentPly;
                        const isUserSide =
                          m.color === selectedGame?.user_color;
                        const glyph =
                          isUserSide && m.classification === "blunder"
                            ? "??"
                            : isUserSide && m.classification === "mistake"
                              ? "?"
                              : isUserSide && m.classification === "inaccuracy"
                                ? "?!"
                                : "";

                        return (
                          <button
                            key={m.ply}
                            onClick={() => selectPlyAndClearSandbox(m.ply)}
                            className={`col-span-5 px-2.5 py-1.5 text-left flex items-center justify-between transition-colors ${
                              isSelected
                                ? "bg-ink text-paper font-bold"
                                : isUserSide && m.classification === "blunder"
                                  ? "bg-red-soft text-red font-semibold hover:opacity-90"
                                  : isUserSide && m.classification === "mistake"
                                    ? "bg-amber-soft text-amber font-semibold hover:opacity-90"
                                    : "bg-paper text-ink hover:bg-paper-raised"
                            }`}
                          >
                            <span className="truncate">
                              {m.san}
                              {glyph}
                            </span>
                            <span
                              className={`text-[10px] tabular-nums ${
                                isSelected ? "text-paper/70" : "text-ink-faint"
                              }`}
                            >
                              {m.time_spent_seconds !== null &&
                              m.time_spent_seconds !== undefined
                                ? `${m.time_spent_seconds}s`
                                : ""}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </aside>
          </div>
        </div>
      )}

      {/* =====================================================================
          02 // DRILL DECK (SPACED-REPETITION BLUNDER TRAINER)
         ===================================================================== */}
      {activeTab === "train" && (
        <div className="flex-1 flex flex-col">
          {/* Drill Header Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 border-b-2 border-rule-strong bg-paper-raised divide-x divide-rule-strong">
            <div className="px-4 py-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
                01 // PERSONAL BLUNDER DECK
              </div>
              <div className="font-mono text-2xl font-bold tabular-nums text-ink mt-0.5">
                {filteredPuzzles.length} POSITIONS
              </div>
            </div>
            <div className="px-4 py-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
                02 // DUE FOR REVIEW NOW
              </div>
              <div className="font-mono text-2xl font-bold tabular-nums text-red mt-0.5">
                {duePuzzlesCount} DUE
              </div>
            </div>
            <div className="px-4 py-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
                03 // FILTER BY MOTIF
              </div>
              <select
                value={puzzleFilterMotif}
                onChange={(e) => setPuzzleFilterMotif(e.target.value)}
                className="mt-1 w-full bg-paper border border-rule-strong px-2 py-1 font-mono text-xs uppercase text-ink focus:outline-none"
              >
                <option value="all">ALL TACTICAL & POSITIONAL MOTIFS</option>
                {Object.entries(MOTIF_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="px-4 py-3 flex items-center justify-between">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
                  04 // QUEUE MODE
                </div>
                <div className="font-mono text-xs font-bold mt-1">
                  {puzzleModeDueOnly ? "DUE ONLY" : "FULL ARCHIVE"}
                </div>
              </div>
              <button
                onClick={() => setPuzzleModeDueOnly((v) => !v)}
                className="px-3 py-1.5 border border-rule-strong bg-ink text-paper font-mono text-[10px] uppercase tracking-widest font-bold"
              >
                TOGGLE
              </button>
            </div>
          </div>

          {/* 3-Zone Drill Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-rule-strong flex-1">
            {/* Queue List */}
            <aside className="lg:col-span-3 bg-paper flex flex-col">
              <div className="px-3.5 py-2.5 border-b border-rule-strong bg-paper-sunken font-mono text-[10px] uppercase tracking-[0.18em] font-semibold flex justify-between">
                <span>01 / DRILL QUEUE</span>
                <span>LEITNER BOX</span>
              </div>
              <div className="divide-y divide-rule overflow-y-auto max-h-[680px]">
                {filteredPuzzles.map((p, idx) => {
                  const active = activePuzzle?.id === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => setSelectedPuzzleId(p.id)}
                      className={`w-full text-left px-3.5 py-3 font-mono transition-colors ${
                        active
                          ? "bg-ink text-paper"
                          : "bg-paper hover:bg-paper-raised text-ink"
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold">
                          #{String(idx + 1).padStart(2, "0")} · MOVE{" "}
                          {p.move_number} ({p.user_color.toUpperCase()})
                        </span>
                        <span
                          className={`px-1.5 py-0.5 text-[9px] border ${
                            active
                              ? "border-paper/40 text-paper"
                              : "border-rule-strong text-ink-muted"
                          }`}
                        >
                          BOX {p.box}/5
                        </span>
                      </div>
                      <div
                        className={`text-[11px] mt-1 truncate ${
                          active ? "text-paper/80" : "text-ink-muted"
                        }`}
                      >
                        vs. {p.opponent_name} · PLAYED {p.played_move_san}??
                      </div>
                      <div
                        className={`text-[10px] mt-1 uppercase ${
                          active ? "text-red-300" : "text-red"
                        }`}
                      >
                        -{Math.round(p.win_prob_drop)}% EQUITY ·{" "}
                        {p.motif.replace(/_/g, " ")}
                      </div>
                    </button>
                  );
                })}
              </div>
            </aside>

            {/* Interactive Drill Stage */}
            <section className="lg:col-span-5 bg-paper-raised flex flex-col justify-between p-5">
              {activePuzzle ? (
                <>
                  <div className="pb-3 border-b border-rule-strong flex items-center justify-between font-mono text-xs">
                    <div>
                      <span className="text-ink-faint uppercase">
                        TARGET:{" "}
                      </span>
                      <span className="font-bold uppercase">
                        FIND BEST MOVE FOR {activePuzzle.user_color}
                      </span>
                    </div>
                    <span className="px-2 py-0.5 bg-red text-white text-[10px] font-bold uppercase">
                      IN-GAME: {activePuzzle.played_move_san}??
                    </span>
                  </div>

                  <div className="my-4 w-full max-w-[440px] mx-auto">
                    <Board
                      fen={puzzleFen}
                      orientation={activePuzzle.user_color}
                      interactive={puzzleStatus !== "solved"}
                      onPieceDrop={handlePuzzleMove}
                      lastMove={puzzleLastMove}
                      highlightMove={
                        showHint && activePuzzle.best_move_uci?.length >= 4
                          ? {
                              from: activePuzzle.best_move_uci.slice(0, 2),
                              to: activePuzzle.best_move_uci.slice(2, 4),
                            }
                          : null
                      }
                    />
                  </div>

                  <div className="grid grid-cols-3 border-t-2 border-rule-strong pt-3 gap-2 font-mono text-xs">
                    <button
                      onClick={() => setShowHint((h) => !h)}
                      className="py-2 border border-rule-strong bg-paper hover:bg-paper-sunken font-bold uppercase"
                    >
                      {showHint ? "HIDE HINT" : "HIGHLIGHT TARGET"}
                    </button>
                    <button
                      onClick={() => {
                        if (replyTimerRef.current) {
                          clearTimeout(replyTimerRef.current);
                          replyTimerRef.current = null;
                        }
                        setPuzzleFen(activePuzzle.target_fen);
                        setPuzzleStatus("prompt");
                        setPuzzleFeedback("");
                        setPuzzleLastMove(
                          activePuzzle.opponent_move_uci &&
                            activePuzzle.opponent_move_uci.length >= 4
                            ? {
                                from: activePuzzle.opponent_move_uci.slice(
                                  0,
                                  2
                                ),
                                to: activePuzzle.opponent_move_uci.slice(2, 4),
                              }
                            : null
                        );
                      }}
                      className="py-2 border border-rule-strong bg-paper hover:bg-paper-sunken font-bold uppercase"
                    >
                      RESET BOARD
                    </button>
                    <button
                      onClick={() => {
                        const idx = filteredPuzzles.findIndex(
                          (p) => p.id === activePuzzle.id
                        );
                        const next =
                          filteredPuzzles[(idx + 1) % filteredPuzzles.length];
                        if (next) setSelectedPuzzleId(next.id);
                      }}
                      className="py-2 border border-rule-strong bg-ink text-paper font-bold uppercase"
                    >
                      NEXT DRILL →
                    </button>
                  </div>
                </>
              ) : (
                <div className="p-8 font-mono text-xs uppercase text-ink-muted">
                  NO DRILLS MATCHING CURRENT FILTER.
                </div>
              )}
            </section>

            {/* Telemetry & Verification Panel */}
            <aside className="lg:col-span-4 bg-paper p-5 flex flex-col justify-between">
              {activePuzzle ? (
                <div className="space-y-4">
                  <div className="border-b border-rule-strong pb-3">
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
                      03 / DRILL TELEMETRY
                    </div>
                    <h2 className="font-serif text-xl font-bold text-ink mt-1">
                      vs. {activePuzzle.opponent_name}
                    </h2>
                    <div className="font-mono text-xs text-ink-muted mt-0.5">
                      {activePuzzle.opening_name} · MOVE{" "}
                      {activePuzzle.move_number} ({activePuzzle.game_date})
                    </div>
                  </div>

                  {/* Status Banner */}
                  <div
                    className={`p-3.5 border font-mono text-xs leading-relaxed ${
                      puzzleStatus === "solved"
                        ? "border-green bg-green-soft text-green font-bold"
                        : puzzleStatus === "wrong"
                          ? "border-red bg-red-soft text-red font-bold"
                          : "border-rule-strong bg-paper-raised text-ink"
                    }`}
                  >
                    {puzzleFeedback ||
                      `DRAG OR CLICK A ${activePuzzle.user_color.toUpperCase()} PIECE ON THE BOARD TO REPLACE YOUR IN-GAME BLUNDER (${activePuzzle.played_move_san}??).`}
                  </div>

                  {/* Explanation */}
                  <div className="p-4 border border-rule-strong bg-paper-raised space-y-2">
                    <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
                      DIAGNOSTIC REPORT //{" "}
                      {MOTIF_LABELS[activePuzzle.motif] || activePuzzle.motif}
                    </div>
                    <p className="text-xs leading-relaxed text-ink">
                      {activePuzzle.coach_explanation}
                    </p>
                    {puzzleStatus === "solved" && (
                      <div className="pt-2 border-t border-rule font-mono text-xs text-green font-bold">
                        ENGINE LINE: {activePuzzle.best_move_san} (
                        {activePuzzle.solution_line_san})
                      </div>
                    )}
                  </div>
                </div>
              ) : null}

              {activePuzzle && (
                <button
                  onClick={() => {
                    setSelectedGameId(activePuzzle.game_id);
                    setActiveTab("review");
                    setTimeout(
                      () => selectPlyAndClearSandbox(activePuzzle.ply),
                      120
                    );
                  }}
                  className="w-full py-2.5 border border-rule-strong bg-paper-raised hover:bg-ink hover:text-paper font-mono text-xs uppercase tracking-widest font-bold transition-colors"
                >
                  OPEN FULL MATCH AT PLY {activePuzzle.ply} →
                </button>
              )}
            </aside>
          </div>
        </div>
      )}

      {/* =====================================================================
          03 // LEAK MATRIX (CROSS-GAME PATTERNS & REPERTOIRE AUDIT)
         ===================================================================== */}
      {activeTab === "patterns" && overview && (
        <div className="flex-1 flex flex-col divide-y-2 divide-rule-strong">
          {/* Top Summary Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-rule-strong bg-paper-raised">
            <div className="p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
                01 // RECORD ANALYZED ({overview.patterns.totalGames} GAMES)
              </div>
              <div className="font-mono text-2xl font-bold tabular-nums mt-1">
                {recordSummary.wins}W – {recordSummary.losses}L –{" "}
                {recordSummary.draws}D
              </div>
            </div>
            <div className="p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
                02 // MEAN ACCURACY
              </div>
              <div className="font-mono text-2xl font-bold tabular-nums mt-1">
                {overview.patterns.overallAccuracy}%
              </div>
            </div>
            <div className="p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
                03 // RUSHED ERRORS (≤4S MOVE TIME)
              </div>
              <div className="font-mono text-2xl font-bold tabular-nums text-red mt-1">
                {overview.patterns.clock.rushedMistakes} ERRORS{" "}
                <span className="text-xs text-ink-muted font-normal">
                  ({overview.patterns.clock.rushedMistakeRatePct}% OF{" "}
                  {overview.patterns.clock.rushedMoves} RUSHED MOVES)
                </span>
              </div>
            </div>
            <div className="p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
                04 // AVG THINK TIME ON BLUNDER
              </div>
              <div className="font-mono text-2xl font-bold tabular-nums mt-1">
                {overview.patterns.clock.avgSecondsOnBlunders ?? "--"}S{" "}
                <span className="text-xs text-ink-muted font-normal">
                  (VS {overview.patterns.clock.avgSecondsOnBestMoves ?? "--"}S ON
                  BEST)
                </span>
              </div>
            </div>
          </div>

          {/* Main 2-Column Matrix */}
          <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-rule-strong flex-1">
            {/* Opening Repertoire Audit */}
            <section className="lg:col-span-7 bg-paper flex flex-col">
              <div className="px-4 py-3 border-b border-rule-strong bg-paper-sunken font-mono text-xs uppercase tracking-[0.18em] font-bold">
                01 // OPENING REPERTOIRE LEAK AUDIT (1.F4 BIRD VS. 1...D6 PIRC)
              </div>
              <div className="divide-y divide-rule">
                {overview.patterns.openingLeaks.map((op) => (
                  <div
                    key={`${op.color}-${op.family}`}
                    className="p-4 hover:bg-paper-raised transition-colors"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 border border-rule-strong font-mono text-[10px] uppercase font-bold bg-paper-raised">
                          {op.color}
                        </span>
                        <h3 className="font-serif text-lg font-bold text-ink">
                          {op.family}
                        </h3>
                      </div>
                      <div className="font-mono text-xs font-bold tabular-nums">
                        WIN RATE: {op.winRate}% ({op.wins}W-{op.losses}L-
                        {op.draws}D) · ACC {op.avgAccuracy}%
                      </div>
                    </div>

                    <div className="mt-2 font-mono text-xs text-ink-muted flex flex-wrap items-center justify-between gap-2">
                      <span>
                        WORST VARIATION:{" "}
                        {op.worstVariation
                          ? `${op.worstVariation.name} ${
                              op.worstVariation.sampleMove
                                ? `— ${op.worstVariation.sampleMove}`
                                : ""
                            }`
                          : "NONE"}
                      </span>
                      <span className="text-red font-bold">
                        {op.mistakesPerGame} ERRORS / GAME
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Recurring Tactical & Positional Motifs + Phase Breakdown */}
            <section className="lg:col-span-5 bg-paper flex flex-col divide-y divide-rule-strong">
              <div>
                <div className="px-4 py-3 border-b border-rule-strong bg-paper-sunken font-mono text-xs uppercase tracking-[0.18em] font-bold">
                  02 // RECURRING MISTAKE MOTIFS
                </div>
                <div className="divide-y divide-rule">
                  {overview.patterns.motifs.map((m) => (
                    <div key={m.motif} className="p-4">
                      <div className="flex items-center justify-between font-mono text-xs font-bold">
                        <span className="uppercase">{m.label}</span>
                        <span className="text-red tabular-nums">
                          {m.count} ERRORS (-{m.avgDrop}% AVG DROP)
                        </span>
                      </div>
                      <p className="text-xs text-ink-muted mt-1">
                        {m.description}
                      </p>
                      <div className="mt-2 h-2 w-full bg-paper-sunken border border-rule overflow-hidden">
                        <div
                          className="h-full bg-red"
                          style={{
                            width: `${Math.min(100, m.count * 8)}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="px-4 py-3 border-b border-rule-strong bg-paper-sunken font-mono text-xs uppercase tracking-[0.18em] font-bold">
                  03 // ERROR RATE BY PHASE
                </div>
                <div className="grid grid-cols-3 divide-x divide-rule">
                  {overview.patterns.phases.map((p) => (
                    <div key={p.phase} className="p-4 font-mono">
                      <div className="text-[10px] uppercase tracking-widest text-ink-faint">
                        {p.phase}
                      </div>
                      <div className="text-xl font-bold tabular-nums mt-1 text-ink">
                        {p.ratePer100}%
                      </div>
                      <div className="text-[11px] text-ink-muted mt-0.5">
                        {p.mistakesAndBlunders} ERR / {p.totalMoves} MOVES
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

export default ChessCoachApp;
