import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fetch as undiciFetch } from "undici";
import type { GameRecord } from "./types.js";
import type { Mistake } from "./analyze.js";
import type { Explanation } from "./explain.js";

type GameRow = {
  chesscom_game_id: string;
  chesscom_url?: string;
  username: string;
  game_date?: string;
  white?: string;
  black?: string;
  result?: string;
  white_elo?: number;
  black_elo?: number;
  time_control?: string;
  pgn: string;
  source_archive: string;
  discovered_at: string;
};

export class SupabaseStore {
  constructor(private readonly client: SupabaseClient) {}

  static fromEnvironment(): SupabaseStore {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
    return new SupabaseStore(createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: undiciFetch as unknown as typeof globalThis.fetch } }));
  }

  async upsertGames(username: string, games: GameRecord[]): Promise<number> {
    const rows: GameRow[] = games.map((game) => ({
      chesscom_game_id: game.id,
      chesscom_url: game.url,
      username,
      game_date: game.date?.replace(/\./g, "-"),
      white: game.white,
      black: game.black,
      result: game.result,
      white_elo: game.whiteElo,
      black_elo: game.blackElo,
      time_control: game.timeControl,
      pgn: game.pgn,
      source_archive: game.sourceArchive,
      discovered_at: game.discoveredAt
    }));
    if (rows.length === 0) return 0;
    const { error } = await this.client.from("games").upsert(rows, { onConflict: "chesscom_game_id", ignoreDuplicates: true });
    if (error) throw new Error(`Supabase game upsert failed: ${error.message}`);
    return rows.length;
  }

  async count(): Promise<number> {
    const { count, error } = await this.client.from("games").select("id", { count: "exact", head: true });
    if (error) throw new Error(`Supabase count failed: ${error.message}`);
    return count ?? 0;
  }

  async firstGameFor(username: string): Promise<GameRecord | null> {
    const games = await this.unanalyzedGamesFor(username, 1);
    return games[0] ?? null;
  }

  async unanalyzedGamesFor(username: string, limit = 1): Promise<GameRecord[]> {
    const { data: rows, error } = await this.client.from("games").select("*").or(`white.eq.${username},black.eq.${username}`).order("game_date", { ascending: false }).limit(limit);
    if (error) throw new Error(`Supabase game lookup failed: ${error.message}`);
    const { data: analyses, error: analysisError } = await this.client.from("analyses").select("game_id").eq("status", "completed");
    if (analysisError) throw new Error(`Supabase analysis lookup failed: ${analysisError.message}`);
    const analyzedIds = new Set((analyses ?? []).map((analysis) => analysis.game_id));
    return (rows ?? []).filter((row) => !analyzedIds.has(row.id)).slice(0, limit).map((row) => {
      const game = row as GameRow;
      return {
        id: game.chesscom_game_id, url: game.chesscom_url, date: game.game_date, white: game.white, black: game.black,
        result: game.result, whiteElo: game.white_elo, blackElo: game.black_elo, timeControl: game.time_control,
        pgn: game.pgn, sourceArchive: game.source_archive, discoveredAt: game.discovered_at
      };
    });
  }

  async saveAnalysis(game: GameRecord, mistakes: Mistake[], explanations: Explanation[] = [], depth = 8): Promise<void> {
    const { data: gameRow, error: gameError } = await this.client.from("games").select("id").eq("chesscom_game_id", game.id).single();
    if (gameError) throw new Error(`Supabase analysis game lookup failed: ${gameError.message}`);
    const engineVersion = "19.0.0-lite";
    const { data: analysis, error: analysisError } = await this.client.from("analyses").upsert({
      game_id: gameRow.id, status: "completed", engine_name: "Stockfish", engine_version: engineVersion,
      depth, started_at: new Date().toISOString(), completed_at: new Date().toISOString()
    }, { onConflict: "game_id,engine_name,engine_version,depth" }).select("id").single();
    if (analysisError) throw new Error(`Supabase analysis save failed: ${analysisError.message}`);
    const rows = mistakes.map((mistake, index) => ({
      analysis_id: analysis.id, ply: mistake.ply, move_number: mistake.moveNumber, color: mistake.color,
      move_played: mistake.movePlayed, best_move: mistake.bestMove, fen_before: mistake.fenBefore,
      evaluation_before: mistake.evaluationBefore, evaluation_after: mistake.evaluationAfter,
      evaluation_loss: mistake.evaluationLoss, continuation: mistake.continuation,
      severity: mistake.severity, category: explanations[index]?.category ?? null,
      ai_explanation: explanations[index] ?? null
    }));
    if (!rows.length) return;
    const { error: mistakesError } = await this.client.from("mistakes").upsert(rows, { onConflict: "analysis_id,ply" });
    if (mistakesError) throw new Error(`Supabase mistakes save failed: ${mistakesError.message}`);
  }
}
