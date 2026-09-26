import type { GameRecord } from "./types.js";
import type { Mistake } from "./analyze.js";
import { describeMistake } from "./board.js";

export const categories = [
  "Hanging pieces", "Piece safety", "Missed tactics", "Forks", "Pins", "Skewers",
  "Missed checkmate", "King safety", "Opening principles", "Development", "Pawn structure",
  "Calculation", "Endgame", "Other"
] as const;

export type Explanation = {
  category: (typeof categories)[number];
  summary: string;
  explanation: string;
  recommendation: string;
  pattern: string;
  groundedIn: string[];
  source: "ollama" | "safe-fallback";
};

function scoreText(score: Mistake["evaluationBefore"]): string {
  if (score.mate !== undefined) return `mate in ${Math.abs(score.mate)}`;
  return `${(score.cp ?? 0) / 100} pawns`;
}

function fallback(mistake: Mistake): Explanation {
  const move = describeMistake(mistake);
  const severity = mistake.severity === "blunder" ? "This was a major error" : mistake.severity === "mistake" ? "This was a significant error" : "This was a smaller inaccuracy";
  const playedPiece = move.played.split(" from ")[0];
  const bestPiece = move.best.split(" from ")[0];
  const playedFrom = move.from.toUpperCase();
  const playedTo = move.to.toUpperCase();
  const bestFrom = move.bestFrom.toUpperCase();
  const bestTo = move.bestTo.toUpperCase();
  return {
    category: "Other",
    summary: `${severity}: your ${playedPiece.toLowerCase()} on ${playedFrom} moved to ${playedTo}, but ${bestPiece.toLowerCase()} from ${bestFrom} to ${bestTo} was stronger.`,
    explanation: `You played ${move.played}. Stockfish preferred ${move.best}. From your perspective, the position changed from ${scoreText(mistake.evaluationBefore)} to ${scoreText(mistake.evaluationAfter)}, a loss of about ${(mistake.evaluationLoss / 100).toFixed(1)} pawns. The engine evidence shows that the move was weaker, but it does not prove a specific tactic by itself, so this explanation avoids inventing one.`,
    recommendation: `Before moving the ${playedPiece.toLowerCase()} on ${playedFrom}, ask: what checks, captures, and threats does my opponent have after ${playedTo}? Then compare that with the safer ${bestPiece.toLowerCase()} move from ${bestFrom} to ${bestTo}.`,
    pattern: "Move-safety check: name your opponent's strongest reply before committing to a move.",
    groundedIn: ["best move", "evaluation before", "evaluation after", "FEN before", "engine continuation"],
    source: "safe-fallback"
  };
}

function prompt(game: GameRecord, mistake: Mistake): string {
  return JSON.stringify({
    task: "Explain one chess mistake for a developing player. Always use plain language and name the piece and squares, not only algebraic notation. Start by saying what the player's piece on its square did, explain what that allowed or failed to address, name the stronger move in piece-and-square language, and finish with a reusable pattern to remember. Do not invent a tactic or claim a piece is hanging unless the supplied data supports it.",
    output_schema: { category: categories, summary: "string", explanation: "string", recommendation: "string", pattern: "string", groundedIn: "string[]" },
    game: { date: game.date, color: mistake.color, result: game.result },
    evidence: {
      moveNumber: mistake.moveNumber, movePlayed: mistake.movePlayed, bestMove: mistake.bestMove,
      evaluationBefore: mistake.evaluationBefore, evaluationAfter: mistake.evaluationAfter,
      evaluationLoss: mistake.evaluationLoss, fenBefore: mistake.fenBefore, continuation: mistake.continuation
    }
  });
}

export async function explainMistake(game: GameRecord, mistake: Mistake): Promise<Explanation> {
  const model = process.env.OLLAMA_MODEL;
  if (!model) return fallback(mistake);
  try {
    const response = await fetch(process.env.OLLAMA_URL || "http://127.0.0.1:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: prompt(game, mistake), format: "json", stream: false })
    });
    if (!response.ok) return fallback(mistake);
    const body = (await response.json()) as { response?: string };
    const parsed = JSON.parse(body.response || "{}");
    if (!categories.includes(parsed.category) || typeof parsed.summary !== "string" || typeof parsed.explanation !== "string" || typeof parsed.recommendation !== "string" || typeof parsed.pattern !== "string" || !Array.isArray(parsed.groundedIn)) return fallback(mistake);
    return { ...parsed, source: "ollama" } as Explanation;
  } catch {
    return fallback(mistake);
  }
}
