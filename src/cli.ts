import { config, requireUsername } from "./config.js";
import { discoverGames } from "./chesscom.js";
import { GameStore } from "./store.js";
import { readFile } from "node:fs/promises";
import { analyzeGame } from "./analyze.js";
import type { GameRecord } from "./types.js";
import { explainMistake } from "./explain.js";
import { SupabaseStore } from "./supabase-store.js";
import { runCoachCycle } from "./cycle.js";

async function sync(): Promise<void> {
  const username = requireUsername();
  const discovered = await discoverGames(username, config.userAgent);
  if (process.env.PERSISTENCE_BACKEND === "supabase") {
    const store = SupabaseStore.fromEnvironment();
    await store.upsertGames(username, discovered);
    console.log(JSON.stringify({ username, discovered: discovered.length, backend: "supabase", stored: await store.count() }, null, 2));
  } else {
    const store = new GameStore(config.dataDir);
    const added = await store.addNew(discovered);
    console.log(JSON.stringify({ username, discovered: discovered.length, added: added.length, backend: "local", stored: await store.count() }, null, 2));
  }
}

async function loadFirstGame(username: string): Promise<GameRecord> {
  if (process.env.PERSISTENCE_BACKEND === "supabase") {
    const game = await SupabaseStore.fromEnvironment().firstGameFor(username);
    if (game) return game;
  } else {
    const database = JSON.parse(await readFile(`${config.dataDir}/games.json`, "utf8")) as { games: GameRecord[] };
    const game = database.games.find((candidate) => candidate.white === username || candidate.black === username);
    if (game) return game;
  }
  throw new Error("No stored game found for the configured username");
}

async function analyzeOne(): Promise<void> {
  const username = requireUsername();
  const game = await loadFirstGame(username);
  const mistakes = await analyzeGame(game, 8, username);
  if (process.env.PERSISTENCE_BACKEND === "supabase") await SupabaseStore.fromEnvironment().saveAnalysis(game, mistakes, [], 8);
  console.log(JSON.stringify({ game: game.url, date: game.date, result: game.result, mistakes }, null, 2));
}

async function reportOne(): Promise<void> {
  const username = requireUsername();
  const game = await loadFirstGame(username);
  const mistakes = await analyzeGame(game, 8, username);
  const explanations = await Promise.all(mistakes.map((mistake) => explainMistake(game, mistake)));
  if (process.env.PERSISTENCE_BACKEND === "supabase") await SupabaseStore.fromEnvironment().saveAnalysis(game, mistakes, explanations, 8);
  console.log(JSON.stringify({ game: game.url, date: game.date, result: game.result, mistakes: mistakes.map((mistake, index) => ({ ...mistake, explanation: explanations[index] })) }, null, 2));
}

async function migrateSupabase(): Promise<void> {
  const database = JSON.parse(await readFile(`${config.dataDir}/games.json`, "utf8")) as { games: GameRecord[] };
  const username = requireUsername();
  const store = SupabaseStore.fromEnvironment();
  await store.upsertGames(username, database.games);
  console.log(JSON.stringify({ uploaded: database.games.length, supabaseCount: await store.count() }, null, 2));
}

if (process.argv[2] === "sync") await sync();
else if (process.argv[2] === "analyze-one") await analyzeOne();
else if (process.argv[2] === "report-one") await reportOne();
else if (process.argv[2] === "migrate-supabase") await migrateSupabase();
else if (process.argv[2] === "coach-cycle") await runCoachCycle();
else console.error("Usage: npm run sync | npm run analyze-one | npm run report-one | npm run migrate-supabase | npm run coach-cycle");
