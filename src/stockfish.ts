import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

type Engine = {
  listener?: (line: string) => void;
  sendCommand(command: string): void;
  ccall(name: string, returnType: null, argTypes: string[], args: string[], options?: { async?: boolean }): Promise<unknown> | unknown;
  _isReady?: () => boolean;
};

type EngineInitializer = () => (options: {
  locateFile(path: string): string;
  wasmBinary: Buffer;
}) => Promise<Engine>;

async function initEngine(): Promise<Engine> {
  // Load the package's bundled WASM engine directly. The package's CommonJS
  // wrapper can return the wrong module shape on hosted Node runners.
  // @ts-expect-error package has no bundled TypeScript declaration
  const module = await import("stockfish/bin/stockfish-19-lite-single.js");
  const factory = (module.default ?? module.Stockfish) as EngineInitializer;
  const require = createRequire(import.meta.url);
  const packageDir = path.dirname(require.resolve("stockfish/package.json"));
  const wasmPath = path.join(packageDir, "bin", "stockfish-19-lite-single.wasm");
  const engine = await factory()({ locateFile: () => wasmPath, wasmBinary: fs.readFileSync(wasmPath) });
  if (engine._isReady) {
    while (!engine._isReady()) await new Promise((resolve) => setTimeout(resolve, 10));
    delete engine._isReady;
  }
  engine.sendCommand = (command) => {
    setImmediate(() => engine.ccall("command", null, ["string"], [command], { async: /^go\\b/.test(command) }));
  };
  return engine;
}
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
    this.engine = await initEngine();
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
