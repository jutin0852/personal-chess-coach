import { config, requireUsername } from "./config.js";
import { discoverGames } from "./chesscom.js";
import { analyzeGame } from "./analyze.js";
import { explainMistake } from "./explain.js";
import { sendDiscordGameReport, sendDiscordInteractiveGameReport } from "./discord.js";
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
  const discordNotification = process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_CHANNEL_ID
    ? await sendDiscordInteractiveGameReport(game, mistakes, explanations)
    : await sendDiscordGameReport(game, mistakes, explanations);
  console.log(JSON.stringify({ username, discovered: discovered.length, action: "analyzed", game: game.url, mistakes: mistakes.length, discordNotification, stored: await store.count() }, null, 2));
}

export async function runCoachBackfill(): Promise<void> {
  const username = requireUsername();
  const store = SupabaseStore.fromEnvironment();
  const discovered = await discoverGames(username, config.userAgent, 0);
  await store.upsertGames(username, discovered);
  const games = await store.unanalyzedGamesFor(username, 100000);
  const summary = {
    username,
    discovered: discovered.length,
    gamesQueued: games.length,
    gamesAnalyzed: 0,
    gamesWithMistakes: 0,
    mistakes: 0,
    evaluationLoss: 0,
    severity: { inaccuracy: 0, mistake: 0, blunder: 0 },
    categories: {} as Record<string, number>,
    pattern: "Move-safety check: name your opponent's strongest reply before committing to a move."
  };

  for (const game of games) {
    const mistakes = await analyzeGame(game, 8, username);
    const explanations = await Promise.all(mistakes.map((mistake) => explainMistake(game, mistake)));
    await store.saveAnalysis(game, mistakes, explanations, 8);
    summary.gamesAnalyzed += 1;
    if (mistakes.length) summary.gamesWithMistakes += 1;
    summary.mistakes += mistakes.length;
    summary.evaluationLoss += mistakes.reduce((total, mistake) => total + mistake.evaluationLoss, 0);
    for (const [index, mistake] of mistakes.entries()) {
      summary.severity[mistake.severity] += 1;
      const category = explanations[index]?.category ?? "Other";
      summary.categories[category] = (summary.categories[category] ?? 0) + 1;
    }
  }

  console.log(JSON.stringify({
    ...summary,
    averageLossPerMistake: summary.mistakes ? Math.round(summary.evaluationLoss / summary.mistakes) : 0,
    stored: await store.count()
  }, null, 2));
}
