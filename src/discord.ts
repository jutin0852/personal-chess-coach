import type { Mistake } from "./analyze.js";
import type { Explanation } from "./explain.js";
import type { GameRecord } from "./types.js";
import { fetch } from "undici";

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

  const highlights = [...mistakes]
    .sort((left, right) => right.evaluationLoss - left.evaluationLoss)
    .slice(0, 3)
    .map((mistake) => {
      const explanation = explanations.find((_, index) => mistakes[index] === mistake);
      const coachingNote = explanation?.summary ? ` — ${explanation.summary}` : "";
      return truncate(
        `• Move ${mistake.moveNumber}: **${mistake.movePlayed}** → **${mistake.bestMove}** (${mistake.evaluationLoss}cp, ${mistake.severity})${coachingNote}`,
        900,
      );
    });

  const description = mistakes.length
    ? `Stockfish found **${mistakes.length}** improvement point${mistakes.length === 1 ? "" : "s"}.`
    : "No significant Stockfish mistakes were found at the current analysis depth.";

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "Personal Chess Coach",
        embeds: [{
          title: "Your Chess.com game is ready",
          url: game.url,
          description,
          color: mistakes.some((mistake) => mistake.severity === "blunder") ? 0xd83c3e : 0x5865f2,
          fields: [
            { name: "Game", value: `${game.white ?? "White"} vs ${game.black ?? "Black"} · ${game.result ?? "result unavailable"}`, inline: false },
            { name: "Top improvement points", value: highlights.join("\n") || "No major mistakes detected.", inline: false },
          ],
          footer: { text: "Based on Stockfish evidence — open the game for full review." },
        }],
      }),
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
