"use client";

import { useEffectEvent, useLayoutEffect, useMemo, useRef } from "react";
import { Chess } from "chess.js";
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
  movableColor?: Color;
  dests?: Map<Key, Key[]>;
  lastMove?: [Key, Key] | { from: string; to: string } | null;
  highlightMove?: { from: string; to: string } | null;
  check?: boolean;
  shapes?: DrawShape[];
  onMove?: (from: Key, to: Key) => void;
  onPieceDrop?: (from: string, to: string, promotion?: string) => Promise<boolean> | boolean;
};

export function Board(props: BoardProps) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);

  const computed = useMemo(() => {
    const dests = new Map<Key, Key[]>();
    let turnColor: Color = "white";
    let inCheck = false;
    try {
      const chess = new Chess(props.fen);
      turnColor = chess.turn() === "w" ? "white" : "black";
      inCheck = chess.inCheck();
      if (props.interactive) {
        const moves = chess.moves({ verbose: true });
        for (const m of moves) {
          const from = m.from as Key;
          const to = m.to as Key;
          const existing = dests.get(from) || [];
          existing.push(to);
          dests.set(from, existing);
        }
      }
    } catch {
      // ignore invalid FEN fallback
    }
    return { dests, turnColor, inCheck };
  }, [props.fen, props.interactive]);

  const handleMove = useEffectEvent((from: Key, to: Key) => {
    props.onMove?.(from, to);
    props.onPieceDrop?.(from, to, "q");
  });

  useLayoutEffect(() => {
    if (!el.current) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const board = Chessground(el.current, {
      animation: { enabled: !reduced, duration: 160 },
      premovable: { enabled: false },
      draggable: { showGhost: true },
      movable: {
        free: false,
        showDests: true,
        events: { after: (from, to) => handleMove(from, to) },
      },
      drawable: { enabled: true, visible: true },
    });
    api.current = board;
    const observer = new ResizeObserver(() => board.redrawAll());
    observer.observe(el.current);
    return () => {
      observer.disconnect();
      board.destroy();
      api.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const normalizedLastMove: [Key, Key] | undefined = Array.isArray(props.lastMove)
      ? props.lastMove
      : props.lastMove && "from" in props.lastMove
        ? [props.lastMove.from as Key, props.lastMove.to as Key]
        : undefined;

    const autoShapes: DrawShape[] = [...(props.shapes ?? [])];
    if (props.highlightMove?.from && props.highlightMove?.to) {
      autoShapes.push({
        orig: props.highlightMove.from as Key,
        dest: props.highlightMove.to as Key,
        brush: "green",
      });
    }

    const turnColor = props.turnColor ?? computed.turnColor;
    const movableColor =
      props.movableColor ?? (props.interactive ? turnColor : undefined);
    const dests = props.dests ?? computed.dests;

    api.current?.set({
      fen: props.fen,
      orientation: props.orientation,
      turnColor,
      lastMove: normalizedLastMove,
      check: props.check ?? computed.inCheck,
      movable: { color: movableColor, dests },
      drawable: { autoShapes },
    });
  }, [
    props.fen,
    props.orientation,
    props.interactive,
    props.turnColor,
    props.movableColor,
    props.dests,
    props.lastMove,
    props.highlightMove,
    props.check,
    props.shapes,
    computed,
  ]);

  return (
    <div className="chess-board w-full select-none">
      <div
        ref={el}
        className="aspect-square w-full overflow-hidden rounded-none border border-rule-strong"
      />
    </div>
  );
}

export default Board;
