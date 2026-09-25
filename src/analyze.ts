import { Chess } from "chess.js";
import type { GameRecord } from "./types.js";
import { StockfishEngine, type EngineAnalysis, type EngineScore } from "./stockfish.js";

export type Mistake = {
  ply: number;
  moveNumber: number;
  color: "w" | "b";
  movePlayed: string;
  bestMove: string;
  fenBefore: string;
  evaluationBefore: EngineScore;
  evaluationAfter: EngineScore;
  evaluationLoss: number;
  continuation: string[];
  severity: "inaccuracy" | "mistake" | "blunder";
};

function cp(score: EngineScore): number {
  if (score.cp !== undefined) return score.cp;
  return (score.mate ?? 0) > 0 ? 10000 : -10000;
}

function moverPerspective(score: EngineScore, mover: "w" | "b"): number {
  return mover === "w" ? cp(score) : -cp(score);
}

function severity(loss: number): Mistake["severity"] {
  if (loss >= 300) return "blunder";
  if (loss >= 150) return "mistake";
  return "inaccuracy";
}

export async function analyzeGame(game: GameRecord, depth = 8, player?: string): Promise<Mistake[]> {
  const parsed = new Chess();
  parsed.loadPgn(game.pgn);
  const moves = parsed.history({ verbose: true });
  const replay = new Chess();
  const engine = new StockfishEngine();
  const mistakes: Mistake[] = [];
  await engine.start();
  try {
    for (let index = 0; index < moves.length; index++) {
      const move = moves[index];
      const fenBefore = replay.fen();
      const before: EngineAnalysis = await engine.analyze(fenBefore, depth);
      replay.move(move.san);
      const after = await engine.analyze(replay.fen(), depth);
      const loss = Math.max(0, Math.round(moverPerspective(before.score, move.color) - moverPerspective(after.score, move.color)));
      const playerColor = player === game.white ? "w" : player === game.black ? "b" : undefined;
      if (loss >= 100 && (!playerColor || move.color === playerColor)) {
        mistakes.push({
          ply: index + 1,
          moveNumber: Math.floor(index / 2) + 1,
          color: move.color,
          movePlayed: move.san,
          bestMove: before.bestMove,
          fenBefore,
          evaluationBefore: before.score,
          evaluationAfter: after.score,
          evaluationLoss: loss,
          continuation: before.pv,
          severity: severity(loss)
        });
      }
    }
  } finally {
    await engine.stop();
  }
  return mistakes;
}
