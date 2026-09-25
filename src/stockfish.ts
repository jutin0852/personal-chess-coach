// The npm package ships JavaScript without TypeScript declarations; the local
// declaration in stockfish.d.ts describes the small API this adapter uses.
// @ts-expect-error package has no bundled declaration file under NodeNext
import initEngine from "stockfish";

type Engine = Awaited<ReturnType<typeof initEngine>>;
export type EngineScore = { cp?: number; mate?: number };
export type EngineAnalysis = { score: EngineScore; bestMove: string; pv: string[] };

function parseScore(line: string): EngineScore | undefined {
  const mate = line.match(/\bscore mate (-?\d+)/);
  if (mate) return { mate: Number(mate[1]) };
  const cp = line.match(/\bscore cp (-?\d+)/);
  return cp ? { cp: Number(cp[1]) } : undefined;
}

export class StockfishEngine {
  private engine?: Engine;

  async start(): Promise<void> {
    this.engine = await initEngine("lite-single");
    await this.waitForLine("uciok", () => this.engine?.sendCommand("uci"));
  }

  async analyze(fen: string, depth = 10): Promise<EngineAnalysis> {
    if (!this.engine) throw new Error("Stockfish engine has not been started");
    let score: EngineScore | undefined;
    let pv: string[] = [];
    const bestMove = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Stockfish timed out")), 60_000);
      this.engine!.listener = (line: string) => {
        const nextScore = parseScore(line);
        if (nextScore) score = nextScore;
        const pvMatch = line.match(/\bpv (.+)$/);
        if (pvMatch) pv = pvMatch[1].trim().split(/\s+/);
        const best = line.match(/^bestmove\s+(\S+)/)?.[1];
        if (best) {
          clearTimeout(timeout);
          resolve(best);
        }
      };
      this.engine!.sendCommand(`position fen ${fen}`);
      this.engine!.sendCommand(`go depth ${depth}`);
    });
    if (!score) throw new Error("Stockfish returned no evaluation");
    return { score, bestMove, pv };
  }

  async stop(): Promise<void> {
    this.engine?.sendCommand("quit");
    this.engine = undefined;
  }

  private waitForLine(expected: string, send: () => void): Promise<void> {
    if (!this.engine) throw new Error("Stockfish engine has not been started");
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Stockfish timed out waiting for ${expected}`)), 30_000);
      this.engine!.listener = (line: string) => {
        if (line.includes(expected)) {
          clearTimeout(timeout);
          resolve();
        }
      };
      send();
    });
  }
}
