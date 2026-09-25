import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { gameId, parseHeaders, splitPgn, toGameRecord } from "../src/chesscom.js";

const pgn = `[Event "Live Chess"]\n[UTCDate "2026.09.25"]\n[UTCTime "11:00:53"]\n[White "Alice"]\n[Black "Bob"]\n[Result "1-0"]\n[Link "https://www.chess.com/game/live/123"]\n\n1. e4 e5 1-0`;

describe("Chess.com PGN handling", () => {
  it("parses headers and uses the stable game link as the ID", () => {
    const headers = parseHeaders(pgn);
    assert.equal(headers.White, "Alice");
    assert.equal(gameId(headers), "https://www.chess.com/game/live/123");
  });

  it("splits a multi-game PGN archive", () => {
    assert.equal(splitPgn(`${pgn}\n\n${pgn.replace("123", "456")}`).length, 2);
  });

  it("normalizes a game into the persistence shape", () => {
    const record = toGameRecord(pgn, "https://api.chess.com/pub/player/bob/games/2026/09");
    assert.equal(record.id, "https://www.chess.com/game/live/123");
    assert.equal(record.white, "Alice");
    assert.equal(record.result, "1-0");
  });
});
