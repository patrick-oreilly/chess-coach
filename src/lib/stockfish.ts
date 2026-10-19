import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export type EngineLine = {
  multipv: number;
  cpWhite: number; // Always from White's perspective (+ = White better, - = Black better)
  mateWhite: number | null;
  pvUci: string[];
};

export type PositionEval = {
  cpWhite: number;
  mateWhite: number | null;
  bestMoveUci: string;
  lines: EngineLine[];
};

class StockfishEngine {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buffer = "";
  private listeners: ((line: string) => void)[] = [];
  private readyPromise: Promise<void> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  private ensureProcess(): Promise<void> {
    if (this.proc && !this.proc.killed && this.readyPromise) {
      return this.readyPromise;
    }

    const binPath = process.env.STOCKFISH_PATH || "/opt/homebrew/bin/stockfish";
    const proc = spawn(binPath, [], { stdio: ["pipe", "pipe", "pipe"] });
    this.proc = proc;

    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      let idx: number;
      while ((idx = this.buffer.indexOf("\n")) !== -1) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (line) {
          for (const l of [...this.listeners]) l(line);
        }
      }
    });

    proc.on("exit", () => {
      this.proc = null;
      this.readyPromise = null;
    });

    this.readyPromise = new Promise<void>((resolve) => {
      const onLine = (line: string) => {
        if (line === "uciok") {
          this.send("setoption name Threads value 4");
          this.send("setoption name Hash value 64");
          this.send("isready");
        } else if (line === "readyok") {
          this.offLine(onLine);
          resolve();
        }
      };
      this.onLine(onLine);
      this.send("uci");
    });

    return this.readyPromise;
  }

  private send(cmd: string) {
    this.proc?.stdin.write(cmd + "\n");
  }

  private onLine(fn: (line: string) => void) {
    this.listeners.push(fn);
  }

  private offLine(fn: (line: string) => void) {
    this.listeners = this.listeners.filter((l) => l !== fn);
  }

  public evaluate(
    fen: string,
    opts: { movetimeMs?: number; depth?: number; multiPv?: number } = {}
  ): Promise<PositionEval> {
    const task = this.queue.then(() => this.runEvaluate(fen, opts));
    this.queue = task.catch(() => {});
    return task;
  }

  private async runEvaluate(
    fen: string,
    opts: { movetimeMs?: number; depth?: number; multiPv?: number }
  ): Promise<PositionEval> {
    await this.ensureProcess();
    const multiPv = opts.multiPv ?? 2;
    const turn = fen.split(" ")[1] === "b" ? "black" : "white";
    const sign = turn === "white" ? 1 : -1;

    const latestByPv = new Map<number, EngineLine>();

    return new Promise<PositionEval>((resolve) => {
      const onLine = (line: string) => {
        if (line.startsWith("info ") && line.includes(" score ") && line.includes(" pv ")) {
          const mpvMatch = line.match(/\bmultipv (\d+)/);
          const multipv = mpvMatch ? Number(mpvMatch[1]) : 1;

          let cpSide = 0;
          let mateSide: number | null = null;
          const mateMatch = line.match(/\bscore mate (-?\d+)/);
          const cpMatch = line.match(/\bscore cp (-?\d+)/);
          if (mateMatch) {
            mateSide = Number(mateMatch[1]);
            cpSide = mateSide > 0 ? 10000 - mateSide * 40 : -10000 - mateSide * 40;
          } else if (cpMatch) {
            cpSide = Number(cpMatch[1]);
          }

          const pvIndex = line.indexOf(" pv ");
          const pvUci = pvIndex !== -1 ? line.slice(pvIndex + 4).trim().split(/\s+/) : [];

          latestByPv.set(multipv, {
            multipv,
            cpWhite: cpSide * sign,
            mateWhite: mateSide !== null ? mateSide * sign : null,
            pvUci,
          });
        } else if (line.startsWith("bestmove ")) {
          this.offLine(onLine);
          const parts = line.split(/\s+/);
          const bestMoveUci = parts[1] && parts[1] !== "(none)" ? parts[1] : "";
          const lines = [...latestByPv.values()].sort((a, b) => a.multipv - b.multipv);
          const top = lines[0] ?? {
            multipv: 1,
            cpWhite: 0,
            mateWhite: null,
            pvUci: bestMoveUci ? [bestMoveUci] : [],
          };
          resolve({
            cpWhite: top.cpWhite,
            mateWhite: top.mateWhite,
            bestMoveUci: top.pvUci[0] || bestMoveUci,
            lines,
          });
        }
      };

      this.onLine(onLine);
      this.send(`setoption name MultiPV value ${multiPv}`);
      this.send(`position fen ${fen}`);
      if (opts.depth) {
        this.send(`go depth ${opts.depth}`);
      } else {
        this.send(`go movetime ${opts.movetimeMs ?? 55}`);
      }
    });
  }
}

const globalForStockfish = globalThis as unknown as { __stockfish?: StockfishEngine };
export const stockfish = globalForStockfish.__stockfish ?? (globalForStockfish.__stockfish = new StockfishEngine());
