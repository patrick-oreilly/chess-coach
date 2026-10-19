"use client";

import { useCallback, useEffectEvent, useLayoutEffect, useMemo, useRef } from "react";
import { Chess, type Square } from "chess.js";
import { Chessground } from "chessground";
import type { Api } from "chessground/api";
import type { DrawShape } from "chessground/draw";
import type { Color, Key } from "chessground/types";
import "chessground/assets/chessground.base.css";
import "chessground/assets/chessground.cburnett.css";

export type BoardProps = {
  fen: string;
  orientation: Color;
  interactive?: boolean;
  turnColor?: Color;
  movableColor?: Color | "both";
  dests?: Map<Key, Key[]>;
  lastMove?: [Key, Key] | { from: string; to: string } | null;
  highlightMove?: { from: string; to: string } | null;
  playedBlunderMove?: { from: string; to: string } | null;
  check?: boolean;
  shapes?: DrawShape[];
  onMove?: (from: Key, to: Key) => void;
  onPieceDrop?: (
    from: string,
    to: string,
    promotion?: string
  ) => Promise<boolean> | boolean;
};

export function Board(props: BoardProps) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);

  const interactive = props.interactive ?? true;

  const computed = useMemo(() => {
    const dests = new Map<Key, Key[]>();
    let turnColor: Color = "white";
    let inCheck = false;
    try {
      const chess = new Chess(props.fen);
      turnColor = chess.turn() === "w" ? "white" : "black";
      inCheck = chess.inCheck();
      if (interactive) {
        const moves = chess.moves({ verbose: true });
        for (const m of moves) {
          const from = m.from as Key;
          const to = m.to as Key;
          const existing = dests.get(from) || [];
          if (!existing.includes(to)) {
            existing.push(to);
          }
          dests.set(from, existing);
        }
      }
    } catch {
      // ignore invalid FEN fallback
    }
    return { dests, turnColor, inCheck };
  }, [props.fen, interactive]);

  const lastMoveFrom = Array.isArray(props.lastMove)
    ? props.lastMove[0]
    : props.lastMove?.from;
  const lastMoveTo = Array.isArray(props.lastMove)
    ? props.lastMove[1]
    : props.lastMove?.to;
  const highlightFrom = props.highlightMove?.from;
  const highlightTo = props.highlightMove?.to;
  const blunderFrom = props.playedBlunderMove?.from;
  const blunderTo = props.playedBlunderMove?.to;

  const syncBoard = useCallback(() => {
    if (!api.current) return;

    const normalizedLastMove: [Key, Key] | undefined =
      lastMoveFrom && lastMoveTo
        ? [lastMoveFrom as Key, lastMoveTo as Key]
        : undefined;

    const autoShapes: DrawShape[] = [...(props.shapes ?? [])];
    if (highlightFrom && highlightTo) {
      autoShapes.push({
        orig: highlightFrom as Key,
        dest: highlightTo as Key,
        brush: "green",
      });
    }
    if (blunderFrom && blunderTo) {
      autoShapes.push({
        orig: blunderFrom as Key,
        dest: blunderTo as Key,
        brush: "red",
      });
    }

    const turnColor = props.turnColor ?? computed.turnColor;
    const movableColor =
      props.movableColor ?? (interactive ? turnColor : undefined);
    const dests = props.dests ?? computed.dests;

    api.current.set({
      fen: props.fen,
      orientation: props.orientation,
      turnColor,
      lastMove: normalizedLastMove,
      check: props.check ?? computed.inCheck,
      movable: {
        free: false,
        color: movableColor,
        dests,
        showDests: true,
      },
      drawable: {
        enabled: true,
        visible: true,
        autoShapes,
      },
    });
  }, [
    props.fen,
    props.orientation,
    props.turnColor,
    props.movableColor,
    props.dests,
    props.check,
    props.shapes,
    interactive,
    computed,
    lastMoveFrom,
    lastMoveTo,
    highlightFrom,
    highlightTo,
    blunderFrom,
    blunderTo,
  ]);

  const handleMove = useEffectEvent(async (from: Key, to: Key) => {
    props.onMove?.(from, to);
    if (!props.onPieceDrop) return;

    // Detect whether this move is a pawn promotion
    let promotion: string | undefined = undefined;
    try {
      const c = new Chess(props.fen);
      const p = c.get(from as Square);
      if (
        p &&
        p.type === "p" &&
        ((p.color === "w" && to[1] === "8") ||
          (p.color === "b" && to[1] === "1"))
      ) {
        promotion = "q";
      }
    } catch {
      // ignore
    }

    const result = await props.onPieceDrop(from, to, promotion);
    if (result === false) {
      // Snap the rejected piece back to the current FEN and restore legal dests
      setTimeout(() => {
        syncBoard();
      }, 180);
    }
  });

  useLayoutEffect(() => {
    if (!el.current) return;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const turnColor = props.turnColor ?? computed.turnColor;
    const movableColor =
      props.movableColor ?? (interactive ? turnColor : undefined);
    const dests = props.dests ?? computed.dests;

    const board = Chessground(el.current, {
      fen: props.fen,
      orientation: props.orientation,
      turnColor,
      check: props.check ?? computed.inCheck,
      animation: { enabled: !reduced, duration: 150 },
      premovable: { enabled: false },
      selectable: { enabled: true },
      draggable: { enabled: true, showGhost: true },
      movable: {
        free: false,
        color: movableColor,
        dests,
        showDests: true,
        events: {
          after: (from, to) => {
            void handleMove(from, to);
          },
        },
      },
      drawable: { enabled: true, visible: true },
    });
    api.current = board;

    return () => {
      board.destroy();
      api.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    syncBoard();
  }, [syncBoard]);

  return (
    <div className="chess-board w-full select-none">
      <div
        ref={el}
        className="aspect-square w-full rounded-none border border-rule-strong"
      />
    </div>
  );
}

export default Board;
