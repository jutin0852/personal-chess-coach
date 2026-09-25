import type { GameHeaders, GameRecord } from "./types.js";

const API_ROOT = "https://api.chess.com/pub";

async function getText(url: string, userAgent: string): Promise<string> {
  const response = await fetch(url, {
    headers: { Accept: "application/x-chess-pgn, text/plain", "User-Agent": userAgent }
  });
  if (!response.ok) throw new Error(`Chess.com request failed (${response.status}) for ${url}`);
  return response.text();
}

export async function getArchives(username: string, userAgent: string): Promise<string[]> {
  const response = await fetch(`${API_ROOT}/player/${encodeURIComponent(username)}/games/archives`, {
    headers: { Accept: "application/json", "User-Agent": userAgent }
  });
  if (!response.ok) throw new Error(`Chess.com archive request failed (${response.status})`);
  const body = (await response.json()) as { archives?: unknown };
  if (!Array.isArray(body.archives) || !body.archives.every((value) => typeof value === "string")) {
    throw new Error("Chess.com returned an invalid archive response");
  }
  return body.archives;
}

export function parseHeaders(pgn: string): GameHeaders {
  const headers: GameHeaders = {};
  for (const line of pgn.split(/\r?\n/)) {
    const match = line.match(/^\[([^\s]+)\s+"(.*)"\]$/);
    if (match) headers[match[1]] = match[2];
    if (line.trim() === "") break;
  }
  return headers;
}

export function splitPgn(pgn: string): string[] {
  return pgn
    .split(/(?=^\[Event\s)/m)
    .map((game) => game.trim())
    .filter(Boolean);
}

function numeric(value?: string): number | undefined {
  return value && /^\d+$/.test(value) ? Number(value) : undefined;
}

export function gameId(headers: GameHeaders): string {
  return headers.Link || [headers.UTCDate, headers.UTCTime, headers.White, headers.Black, headers.Result].join("|");
}

export function toGameRecord(pgn: string, sourceArchive: string, discoveredAt = new Date().toISOString()): GameRecord {
  const headers = parseHeaders(pgn);
  return {
    id: gameId(headers),
    url: headers.Link,
    date: headers.UTCDate || headers.Date,
    white: headers.White,
    black: headers.Black,
    result: headers.Result,
    whiteElo: numeric(headers.WhiteElo),
    blackElo: numeric(headers.BlackElo),
    timeControl: headers.TimeControl,
    pgn,
    sourceArchive,
    discoveredAt
  };
}

export async function discoverGames(username: string, userAgent: string, archiveLimit = 3): Promise<GameRecord[]> {
  const archives = (await getArchives(username, userAgent)).slice(-archiveLimit).reverse();
  const games: GameRecord[] = [];
  for (const archive of archives) {
    const pgn = await getText(`${archive}/pgn`, userAgent);
    for (const game of splitPgn(pgn)) games.push(toGameRecord(game, archive));
  }
  return games;
}
