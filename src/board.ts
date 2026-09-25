import { Chess } from "chess.js";
import type { Mistake } from "./analyze.js";

const PIECES: Record<string, string> = {
  wp: "♙", wn: "♘", wb: "♗", wr: "♖", wq: "♕", wk: "♔",
  bp: "♟", bn: "♞", bb: "♝", br: "♜", bq: "♛", bk: "♚",
};

const PIECE_NAMES: Record<string, string> = {
  p: "Pawn", n: "Knight", b: "Bishop", r: "Rook", q: "Queen", k: "King",
};

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function parseUci(move: string): { from: string; to: string } | undefined {
  const match = move.match(/^([a-h][1-8])([a-h][1-8])/i);
  return match ? { from: match[1].toLowerCase(), to: match[2].toLowerCase() } : undefined;
}

function describeMove(chess: Chess, from: string, to: string, san: string): string {
  const piece = chess.get(from as never);
  const name = piece ? PIECE_NAMES[piece.type] : "Piece";
  return `${name} from ${from} to ${to} (${san})`;
}

export function describeMistake(mistake: Mistake): { played: string; best: string; from: string; to: string; bestFrom: string; bestTo: string } {
  const chess = new Chess(mistake.fenBefore);
  const played = chess.moves({ verbose: true }).find((move) => move.san === mistake.movePlayed);
  const best = parseUci(mistake.bestMove);
  const playedFrom = played?.from ?? "?";
  const playedTo = played?.to ?? "?";
  const bestFrom = best?.from ?? "?";
  const bestTo = best?.to ?? "?";
  return {
    played: played ? describeMove(chess, playedFrom, playedTo, mistake.movePlayed) : mistake.movePlayed,
    best: best ? describeMove(chess, bestFrom, bestTo, mistake.bestMove) : mistake.bestMove,
    from: playedFrom,
    to: playedTo,
    bestFrom,
    bestTo,
  };
}

export function renderMistakeBoard(mistake: Mistake, explanation?: string): string {
  const chess = new Chess(mistake.fenBefore);
  const move = describeMistake(mistake);
  const flip = mistake.color === "b";
  const size = 80;
  const left = 44;
  const top = 92;
  const boardSize = size * 8;
  const squarePosition = (square: string) => {
    const file = square.charCodeAt(0) - 97;
    const rank = Number(square[1]);
    const column = flip ? 7 - file : file;
    const row = flip ? rank - 1 : 8 - rank;
    return { x: left + column * size, y: top + row * size, cx: left + column * size + size / 2, cy: top + row * size + size / 2 };
  };
  const arrow = (from: string, to: string, color: string) => {
    if (from === "?" || to === "?") return "";
    const start = squarePosition(from);
    const end = squarePosition(to);
    return `<line x1="${start.cx}" y1="${start.cy}" x2="${end.cx}" y2="${end.cy}" stroke="${color}" stroke-width="12" stroke-linecap="round" marker-end="url(#${color === "#e74c3c" ? "red" : "green"}-arrow)" opacity="0.9"/>`;
  };

  let squares = "";
  let pieces = "";
  for (let rank = 8; rank >= 1; rank--) {
    for (let file = 0; file < 8; file++) {
      const square = `${String.fromCharCode(97 + file)}${rank}`;
      const position = squarePosition(square);
      const dark = (file + rank) % 2 === 1;
      squares += `<rect x="${position.x}" y="${position.y}" width="${size}" height="${size}" fill="${dark ? "#769656" : "#eeeed2"}"/>`;
      const piece = chess.get(square as never);
      if (piece) {
        pieces += `<text x="${position.cx}" y="${position.cy + 25}" text-anchor="middle" font-size="58" font-family="Arial, DejaVu Sans, sans-serif" fill="${piece.color === "w" ? "#fff" : "#111"}" stroke="${piece.color === "w" ? "#111" : "#fff"}" stroke-width="2" paint-order="stroke">${PIECES[`${piece.color}${piece.type}`]}</text>`;
      }
    }
  }

  const played = move.from !== "?" ? squarePosition(move.from) : undefined;
  const playedTo = move.to !== "?" ? squarePosition(move.to) : undefined;
  const best = move.bestFrom !== "?" ? squarePosition(move.bestFrom) : undefined;
  const bestTo = move.bestTo !== "?" ? squarePosition(move.bestTo) : undefined;
  const labels = flip ? ["8", "7", "6", "5", "4", "3", "2", "1"] : ["1", "2", "3", "4", "5", "6", "7", "8"];
  const files = flip ? ["h", "g", "f", "e", "d", "c", "b", "a"] : ["a", "b", "c", "d", "e", "f", "g", "h"];
  const axes = labels.map((label, index) => `<text x="${left - 14}" y="${top + index * size + 18}" text-anchor="middle" font-size="14" font-family="Arial" fill="#444">${label}</text>`).join("") + files.map((label, index) => `<text x="${left + index * size + 72}" y="${top + boardSize + 22}" text-anchor="middle" font-size="14" font-family="Arial" fill="#444">${label}</text>`).join("");
  const caption = explanation ? `<text x="${left}" y="${top + boardSize + 56}" font-size="16" font-family="Arial" fill="#222">${escapeXml(explanation.slice(0, 105))}</text>` : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="${top + boardSize + 84}" viewBox="0 0 760 ${top + boardSize + 84}">
  <defs><marker id="red-arrow" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto"><path d="M0,0 L12,6 L0,12 z" fill="#e74c3c"/></marker><marker id="green-arrow" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto"><path d="M0,0 L12,6 L0,12 z" fill="#2ecc71"/></marker></defs>
  <rect width="100%" height="100%" fill="#ffffff"/>
  <text x="${left}" y="34" font-size="22" font-weight="bold" font-family="Arial" fill="#222">Move ${mistake.moveNumber}: see the difference</text>
  <text x="${left}" y="62" font-size="16" font-family="Arial" fill="#e74c3c">Red: your move — ${escapeXml(move.played)}</text>
  <text x="380" y="62" font-size="16" font-family="Arial" fill="#168a45">Green: Stockfish — ${escapeXml(move.best)}</text>
  ${squares}<rect x="${played?.x ?? 0}" y="${played?.y ?? 0}" width="${played ? size : 0}" height="${played ? size : 0}" fill="#e74c3c" opacity="0.25"/><rect x="${best?.x ?? 0}" y="${best?.y ?? 0}" width="${best ? size : 0}" height="${best ? size : 0}" fill="#2ecc71" opacity="0.25"/>
  ${arrow(move.from, move.to, "#e74c3c")}${arrow(move.bestFrom, move.bestTo, "#2ecc71")}${pieces}${axes}${caption}</svg>`;
}
