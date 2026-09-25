import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { GameRecord } from "./types.js";

type Database = { games: GameRecord[] };

export class GameStore {
  private readonly filePath: string;

  constructor(dataDir: string) {
    this.filePath = join(dataDir, "games.json");
  }

  private async read(): Promise<Database> {
    try {
      return JSON.parse(await readFile(this.filePath, "utf8")) as Database;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { games: [] };
      throw error;
    }
  }

  async addNew(games: GameRecord[]): Promise<GameRecord[]> {
    const database = await this.read();
    const known = new Set(database.games.map((game) => game.id));
    const newGames = games.filter((game) => !known.has(game.id));
    if (newGames.length === 0) return [];
    await mkdir(join(this.filePath, ".."), { recursive: true });
    await writeFile(this.filePath, JSON.stringify({ games: [...database.games, ...newGames] }, null, 2));
    return newGames;
  }

  async count(): Promise<number> {
    return (await this.read()).games.length;
  }
}
