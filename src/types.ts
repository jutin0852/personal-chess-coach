export type GameRecord = {
  id: string;
  url?: string;
  date?: string;
  white?: string;
  black?: string;
  result?: string;
  whiteElo?: number;
  blackElo?: number;
  timeControl?: string;
  pgn: string;
  sourceArchive: string;
  discoveredAt: string;
};

export type GameHeaders = Record<string, string>;
