"use client";

import type { MoveRecord } from "@/lib/db";

type EvalGraphProps = {
  moves: MoveRecord[];
  userColor: "white" | "black";
  currentPly: number;
  onSelectPly: (ply: number) => void;
};

export function EvalGraph({
  moves,
  userColor,
  currentPly,
  onSelectPly,
}: EvalGraphProps) {
  if (moves.length === 0) {
    return (
      <div className="h-28 w-full border border-rule-strong bg-paper-sunken flex items-center justify-center font-mono text-xs text-ink-mute">
        SELECT A MATCH TO INSPECT ELEVATION PROFILE
      </div>
    );
  }

  const width = 580;
  const height = 108;
  const maxPly = Math.max(1, moves.length);

  const getUserWinProb = (m: MoveRecord) =>
    m.color === userColor ? m.win_prob_after : 100 - m.win_prob_after;

  const points: {
    x: number;
    y: number;
    wp: number;
    ply: number;
    move?: MoveRecord;
  }[] = [
    { x: 0, y: height / 2, wp: 50, ply: 0 },
    ...moves.map((m) => {
      const wp = getUserWinProb(m);
      const x = (m.ply / maxPly) * width;
      const y = height - (Math.max(5, Math.min(95, wp)) / 100) * height;
      return { x, y, wp, ply: m.ply, move: m };
    }),
  ];

  const linePath = points
    .map((p, idx) => `${idx === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");

  const areaPath = `${linePath} L${width},${height} L0,${height} Z`;
  const activePoint = points[currentPly] ?? points[0];

  const cliffs = points
    .slice(1)
    .map((p, i) => ({ prev: points[i], curr: p }))
    .filter(
      ({ curr }) =>
        curr.move &&
        curr.move.color === userColor &&
        (curr.move.classification === "blunder" || curr.move.classification === "mistake")
    );

  return (
    <div className="relative w-full overflow-hidden bg-paper-sunken">
      <div className="flex items-center justify-between border-b border-rule px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider">
        <span className="font-bold text-ink">
          02 / TOPOGRAPHIC WIN-EQUITY RIDGE (CONTOUR %)
        </span>
        <span className="flex items-center gap-3 text-ink-mute tabular-nums">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 bg-red" /> BLUNDER CLIFF
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 bg-amber" /> MISTAKE
          </span>
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-28 w-full cursor-crosshair block"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const relX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          const targetPly = Math.round(relX * maxPly);
          onSelectPly(targetPly);
        }}
      >
        <defs>
          <pattern
            id="cliffHatch"
            width="6"
            height="6"
            patternTransform="rotate(45 0 0)"
            patternUnits="userSpaceOnUse"
          >
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="6"
              stroke="var(--red)"
              strokeWidth="1.6"
              opacity="0.4"
            />
          </pattern>
        </defs>

        {/* Horizontal survey elevation lines */}
        {[20, 35, 50, 65, 80].map((pct) => {
          const y = height - (pct / 100) * height;
          return (
            <g key={pct}>
              <line
                x1={0}
                y1={y}
                x2={width}
                y2={y}
                stroke="var(--rule)"
                strokeDasharray={pct === 50 ? "none" : "2 3"}
                strokeWidth={pct === 50 ? 1.2 : 0.8}
              />
              <text
                x={4}
                y={y - 2}
                fontSize="8.5"
                fontWeight="600"
                fill="var(--ink-mute)"
                fontFamily="var(--font-mono)"
              >
                {pct}%
              </text>
            </g>
          );
        })}

        {/* Filled equity ridge */}
        <path d={areaPath} fill="var(--green-soft)" opacity={0.8} />

        {/* Shaded blunder cliff drops */}
        {cliffs.map(({ prev, curr }) => (
          <polygon
            key={`cliff-${curr.ply}`}
            points={`${prev.x.toFixed(1)},${prev.y.toFixed(1)} ${curr.x.toFixed(1)},${curr.y.toFixed(1)} ${curr.x.toFixed(1)},${height} ${prev.x.toFixed(1)},${height}`}
            fill="url(#cliffHatch)"
          />
        ))}

        {/* Main ridge line */}
        <path
          d={linePath}
          fill="none"
          stroke="var(--green)"
          strokeWidth={2}
          strokeLinejoin="miter"
        />

        {/* Active ply crosshair */}
        <line
          x1={activePoint.x}
          y1={0}
          x2={activePoint.x}
          y2={height}
          stroke="var(--ink)"
          strokeWidth={1.5}
        />
        <line
          x1={0}
          y1={activePoint.y}
          x2={width}
          y2={activePoint.y}
          stroke="var(--ink)"
          strokeDasharray="2 4"
          strokeWidth={0.75}
          opacity={0.5}
        />

        {/* Blunder & mistake markers + altitude flags */}
        {points.map((p) => {
          if (!p.move || p.move.color !== userColor) return null;
          if (
            p.move.classification !== "blunder" &&
            p.move.classification !== "mistake"
          ) {
            return null;
          }
          const isBlunder = p.move.classification === "blunder";
          return (
            <g
              key={p.ply}
              onClick={(ev) => {
                ev.stopPropagation();
                onSelectPly(p.ply);
              }}
            >
              <rect
                x={p.x - (isBlunder ? 4 : 3)}
                y={p.y - (isBlunder ? 4 : 3)}
                width={isBlunder ? 8 : 6}
                height={isBlunder ? 8 : 6}
                fill={isBlunder ? "var(--red)" : "var(--amber)"}
                stroke="var(--paper-raised)"
                strokeWidth={1.2}
              />
              {isBlunder && (
                <text
                  x={Math.min(width - 44, Math.max(6, p.x - 14))}
                  y={Math.min(height - 4, p.y + 14)}
                  fontSize="8.5"
                  fontWeight="700"
                  fill="var(--red-text)"
                  fontFamily="var(--font-mono)"
                >
                  ▼-{Math.round(p.move.win_prob_drop)}%
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default EvalGraph;
