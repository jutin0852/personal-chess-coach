import type { Mistake } from "./analyze.js";
import type { Explanation } from "./explain.js";
import type { GameRecord } from "./types.js";
import { FormData, fetch } from "undici";
import sharp from "sharp";
import { describeMistake, renderMistakeBoard } from "./board.js";

export type DiscordNotificationStatus = "disabled" | "sent" | "failed";

type DiscordButton = {
  type: 2;
  style: 1 | 2 | 4;
  label: string;
  custom_id: string;
  disabled?: boolean;
};

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

function reviewButtons(gameId: string, index: number, total: number): DiscordButton[] {
  return [
    { type: 2, style: 1, label: "Previous", custom_id: `review:${gameId}:${Math.max(0, index - 1)}`, disabled: index === 0 },
    { type: 2, style: 1, label: "Next", custom_id: `review:${gameId}:${Math.min(total - 1, index + 1)}`, disabled: index >= total - 1 },
    { type: 2, style: 4, label: "Close review", custom_id: `review:${gameId}:close` },
  ];
}

/**
 * Sends a single, navigable mistake review through the Discord bot API.
 * The interaction endpoint is intentionally separate: Discord delivers button
 * clicks to that endpoint, while this worker only creates the initial review.
 */
export async function sendDiscordInteractiveGameReport(
  game: GameRecord,
  mistakes: Mistake[],
  explanations: Explanation[],
): Promise<DiscordNotificationStatus> {
  const botToken = process.env.DISCORD_BOT_TOKEN?.trim();
  const channelId = process.env.DISCORD_CHANNEL_ID?.trim();
  if (!botToken || !channelId) return "disabled";

  const ranked = [...mistakes].sort((left, right) => right.evaluationLoss - left.evaluationLoss);
  if (!ranked.length) return "disabled";
  const mistake = ranked[0];
  const explanation = explanations[mistakes.indexOf(mistake)];
  const move = describeMistake(mistake);
  const board = await sharp(Buffer.from(renderMistakeBoard(mistake, explanation?.summary))).png().toBuffer();
  const content = `Review 1 of ${ranked.length} · Move ${mistake.moveNumber}`;
  const payload = {
    username: "Personal Chess Coach",
    content,
    embeds: [{
      title: `${mistake.severity.toUpperCase()} · Move ${mistake.moveNumber}`,
      description: truncate(
        `**Your move:** ${move.played}\n**Stockfish:** ${move.best}\n\n${explanation?.explanation ?? "Stockfish found a better move in this position."}\n\n**Practice:** ${explanation?.recommendation ?? "Look for checks, captures, and threats before committing."}`,
        3900,
      ),
      image: { url: "attachment://review.png" },
      color: mistake.severity === "blunder" ? 0xd83c3e : 0x5865f2,
      footer: { text: "Red = your move · Green = Stockfish's move" },
    }],
    components: [{ type: 1, components: reviewButtons(game.id, 0, ranked.length) }],
  };
  try {
    const form = new FormData();
    form.append("payload_json", JSON.stringify(payload));
    form.append("files[0]", new Blob([board], { type: "image/png" }), "review.png");
    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${botToken}` },
      body: form,
    });
    if (!response.ok) {
      console.warn(`Discord interactive report failed with status ${response.status}`);
      return "failed";
    }
    return "sent";
  } catch (error) {
    console.warn("Discord interactive report failed", error);
    return "failed";
  }
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
        image: { url: `attachment://mistake-${index + 1}.png` },
        color: mistake.severity === "blunder" ? 0xd83c3e : 0x2ecc71,
      }))],
    };
    const form = new FormData();
    form.append("payload_json", JSON.stringify(payload));
    const attachments = await Promise.all(visualMistakes.map(async (mistake, index) => {
      const svg = renderMistakeBoard(mistake, explanations[mistakes.indexOf(mistake)]?.summary);
      const png = await sharp(Buffer.from(svg)).png().toBuffer();
      return { index, png };
    }));
    attachments.forEach(({ index, png }) => {
      form.append(`files[${index}]`, new Blob([png], { type: "image/png" }), `mistake-${index + 1}.png`);
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
