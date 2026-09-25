import type { Mistake } from "./analyze.js";
import type { Explanation } from "./explain.js";
import type { GameRecord } from "./types.js";
import { FormData, fetch } from "undici";
import { describeMistake, renderMistakeBoard } from "./board.js";

export type DiscordNotificationStatus = "disabled" | "sent" | "failed";

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

/**
 * Sends only the filtered Stockfish findings that were stored for one newly
 * analyzed game. A missing or failing webhook must never prevent persistence.
 */
export async function sendDiscordGameReport(
  game: GameRecord,
  mistakes: Mistake[],
  explanations: Explanation[],
): Promise<DiscordNotificationStatus> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL?.trim();
  if (!webhookUrl) return "disabled";

  const ranked = [...mistakes]
    .sort((left, right) => right.evaluationLoss - left.evaluationLoss)
    .slice(0, 3)
    .map((mistake) => {
      const explanation = explanations[mistakes.indexOf(mistake)];
      const moves = describeMistake(mistake);
      const coachingNote = explanation?.summary ? ` — ${explanation.summary}` : "";
      return truncate(
        `• Move ${mistake.moveNumber}: **${moves.played}** → **${moves.best}** (${mistake.evaluationLoss}cp, ${mistake.severity})${coachingNote}`,
        900,
      );
    });
  const visualMistakes = [...mistakes].sort((left, right) => right.evaluationLoss - left.evaluationLoss).slice(0, 3);

  const description = mistakes.length
    ? `Stockfish found **${mistakes.length}** improvement point${mistakes.length === 1 ? "" : "s"}.`
    : "No significant Stockfish mistakes were found at the current analysis depth.";

  try {
    const payload = {
      username: "Personal Chess Coach",
      embeds: [{
        title: "Your Chess.com game is ready",
        url: game.url,
        description,
        color: mistakes.some((mistake) => mistake.severity === "blunder") ? 0xd83c3e : 0x5865f2,
        fields: [
          { name: "Game", value: `${game.white ?? "White"} vs ${game.black ?? "Black"} · ${game.result ?? "result unavailable"}`, inline: false },
          { name: "Top improvement points", value: ranked.join("\n") || "No major mistakes detected.", inline: false },
        ],
        footer: { text: "Boards show your move in red and Stockfish's move in green." },
      }, ...visualMistakes.map((mistake, index) => ({
        title: `Visual explanation — move ${mistake.moveNumber}`,
        description: `Red is what you played. Green is what Stockfish preferred.\n**${describeMistake(mistake).played}** → **${describeMistake(mistake).best}**`,
        image: { url: `attachment://mistake-${index + 1}.svg` },
        color: mistake.severity === "blunder" ? 0xd83c3e : 0x2ecc71,
      }))],
    };
    const form = new FormData();
    form.append("payload_json", JSON.stringify(payload));
    visualMistakes.forEach((mistake, index) => {
      const svg = renderMistakeBoard(mistake, explanations[mistakes.indexOf(mistake)]?.summary);
      form.append(`files[${index}]`, new Blob([svg], { type: "image/svg+xml" }), `mistake-${index + 1}.svg`);
    });
    const response = await fetch(webhookUrl, {
      method: "POST",
      body: form,
    });
    if (!response.ok) {
      console.warn(`Discord notification failed with status ${response.status}`);
      return "failed";
    }
    return "sent";
  } catch (error) {
    console.warn("Discord notification failed", error);
    return "failed";
  }
}
