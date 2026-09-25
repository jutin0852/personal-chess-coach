import type { GameRecord } from "./types.js";
import type { Mistake } from "./analyze.js";

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
  groundedIn: string[];
  source: "ollama" | "safe-fallback";
};

function scoreText(score: Mistake["evaluationBefore"]): string {
  if (score.mate !== undefined) return `mate in ${Math.abs(score.mate)}`;
  return `${(score.cp ?? 0) / 100} pawns`;
}

function fallback(mistake: Mistake): Explanation {
  const severity = mistake.severity === "blunder" ? "This was a major error" : mistake.severity === "mistake" ? "This was a significant error" : "This was a smaller inaccuracy";
  return {
    category: "Other",
    summary: `${severity}: ${mistake.movePlayed} instead of ${mistake.bestMove}.`,
    explanation: `Stockfish preferred ${mistake.bestMove}. The position changed from ${scoreText(mistake.evaluationBefore)} to ${scoreText(mistake.evaluationAfter)} from your perspective. The engine evidence supports a move-quality problem, but does not by itself prove a specific tactical theme.`,
    recommendation: "Before committing to a move, compare it with the opponent's forcing checks, captures, and threats.",
    groundedIn: ["best move", "evaluation before", "evaluation after", "FEN before", "engine continuation"],
    source: "safe-fallback"
  };
}

function prompt(game: GameRecord, mistake: Mistake): string {
  return JSON.stringify({
    task: "Explain one chess mistake for a developing player. Do not invent a tactic or claim a piece is hanging unless the supplied data supports it.",
    output_schema: { category: categories, summary: "string", explanation: "string", recommendation: "string", groundedIn: "string[]" },
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
    if (!categories.includes(parsed.category) || typeof parsed.summary !== "string" || typeof parsed.explanation !== "string" || typeof parsed.recommendation !== "string" || !Array.isArray(parsed.groundedIn)) return fallback(mistake);
    return { ...parsed, source: "ollama" } as Explanation;
  } catch {
    return fallback(mistake);
  }
}
