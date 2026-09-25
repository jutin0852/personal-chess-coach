import { config, requireUsername } from "./config.js";
import { discoverGames } from "./chesscom.js";
import { analyzeGame } from "./analyze.js";
import { explainMistake } from "./explain.js";
import { SupabaseStore } from "./supabase-store.js";

export async function runCoachCycle(): Promise<void> {
  const username = requireUsername();
  const store = SupabaseStore.fromEnvironment();
  const discovered = await discoverGames(username, config.userAgent);
  await store.upsertGames(username, discovered);
  const [game] = await store.unanalyzedGamesFor(username, 1);
  if (!game) {
    console.log(JSON.stringify({ username, discovered: discovered.length, action: "nothing-to-analyze", stored: await store.count() }, null, 2));
    return;
  }
  const mistakes = await analyzeGame(game, 8, username);
  const explanations = await Promise.all(mistakes.map((mistake) => explainMistake(game, mistake)));
  await store.saveAnalysis(game, mistakes, explanations, 8);
  console.log(JSON.stringify({ username, discovered: discovered.length, action: "analyzed", game: game.url, mistakes: mistakes.length, stored: await store.count() }, null, 2));
}
