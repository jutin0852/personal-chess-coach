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

  async historyFor(username: string): Promise<HistoryGame[]> {
    const { data: gameRows, error: gamesError } = await this.client.from("games")
      .select("id, chesscom_game_id, chesscom_url, username, game_date, white, black, result, white_elo, black_elo, time_control, pgn, source_archive, discovered_at")
      .eq("username", username)
      .order("game_date", { ascending: false });
    if (gamesError) throw new Error(`Supabase history game lookup failed: ${gamesError.message}`);
    if (!gameRows?.length) return [];

    const gameIds = gameRows.map((row) => row.id as number);
    const { data: analysisRows, error: analysesError } = await this.client.from("analyses")
      .select("id, game_id, status, completed_at")
      .in("game_id", gameIds)
      .eq("status", "completed");
    if (analysesError) throw new Error(`Supabase history analysis lookup failed: ${analysesError.message}`);

    const completedAnalyses = analysisRows ?? [];
    const analysisIds = completedAnalyses.map((row) => row.id as number);
    const { data: mistakeRows, error: mistakesError } = analysisIds.length
      ? await this.client.from("mistakes").select("analysis_id, ply, move_number, color, move_played, best_move, fen_before, evaluation_before, evaluation_after, evaluation_loss, continuation, severity, category, ai_explanation").in("analysis_id", analysisIds).order("evaluation_loss", { ascending: false })
      : { data: [], error: null };
    if (mistakesError) throw new Error(`Supabase history mistake lookup failed: ${mistakesError.message}`);

    const analysisToGame = new Map(completedAnalyses.map((row) => [row.id as number, row.game_id as number]));
    const history = new Map<number, HistoryGame>();
    for (const row of gameRows) {
      history.set(row.id as number, {
        game: {
          id: row.chesscom_game_id as string,
          url: row.chesscom_url as string | undefined,
          date: row.game_date as string | undefined,
          white: row.white as string | undefined,
          black: row.black as string | undefined,
          result: row.result as string | undefined,
          whiteElo: row.white_elo as number | undefined,
          blackElo: row.black_elo as number | undefined,
          timeControl: row.time_control as string | undefined,
          pgn: row.pgn as string,
          sourceArchive: row.source_archive as string,
          discoveredAt: row.discovered_at as string
        },
        mistakes: []
      });
    }

    for (const row of mistakeRows ?? []) {
      const gameId = analysisToGame.get(row.analysis_id as number);
      const item = gameId === undefined ? undefined : history.get(gameId);
      if (!item) continue;
      item.mistakes.push({
        mistake: {
          ply: row.ply as number,
          moveNumber: row.move_number as number,
          color: row.color as Mistake["color"],
          movePlayed: row.move_played as string,
          bestMove: row.best_move as string,
          fenBefore: row.fen_before as string,
          evaluationBefore: row.evaluation_before as Mistake["evaluationBefore"],
          evaluationAfter: row.evaluation_after as Mistake["evaluationAfter"],
          evaluationLoss: row.evaluation_loss as number,
          continuation: row.continuation as string[],
          severity: row.severity as Mistake["severity"]
        },
        explanation: isExplanation(row.ai_explanation) ? row.ai_explanation : undefined,
        category: typeof row.category === "string" ? row.category : undefined
      });
    }
    return [...history.values()];
  }
}

export type HistoryMistake = {
  mistake: Mistake;
  explanation?: Explanation;
  category?: string;
};

export type HistoryGame = {
  game: GameRecord;
  mistakes: HistoryMistake[];
};

function isExplanation(value: unknown): value is Explanation {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Explanation>;
  return typeof candidate.summary === "string" && typeof candidate.explanation === "string" && typeof candidate.recommendation === "string" && typeof candidate.pattern === "string";
}
