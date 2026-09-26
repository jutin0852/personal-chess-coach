import type { Mistake } from "./analyze.js";
import type { Explanation } from "./explain.js";
import type { GameRecord } from "./types.js";
import { FormData, fetch } from "undici";
import sharp from "sharp";
import { describeMistake, renderMistakeBoard } from "./board.js";
import type { HistoryGame } from "./supabase-store.js";

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
        `**Your move:** ${move.played}\n**Stockfish:** ${move.best}\n\n${explanation?.explanation ?? "Stockfish found a better move in this position."}\n\n**Practice:** ${explanation?.recommendation ?? "Look for checks, captures, and threats before committing."}\n\n**Pattern to remember:** ${explanation?.pattern ?? "Check your opponent's forcing replies before committing."}`,
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
      }, ...visualMistakes.map((mistake, index) => {
        const explanation = explanations[mistakes.indexOf(mistake)];
        return {
          title: `Visual explanation — move ${mistake.moveNumber}`,
          description: truncate(`Red is what you played. Green is what Stockfish preferred.\n**${describeMistake(mistake).played}** → **${describeMistake(mistake).best}**\n\n${explanation?.summary ?? "Stockfish found a stronger alternative."}\n\n**Pattern:** ${explanation?.pattern ?? "Check your opponent's forcing replies before committing."}`, 900),
          image: { url: `attachment://mistake-${index + 1}.png` },
          color: mistake.severity === "blunder" ? 0xd83c3e : 0x2ecc71,
        };
      })],
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

async function postDiscordPayload(payload: Record<string, unknown>, files: Array<{ name: string; data: Buffer }> = []): Promise<boolean> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL?.trim();
  const botToken = process.env.DISCORD_BOT_TOKEN?.trim();
  const channelId = process.env.DISCORD_CHANNEL_ID?.trim();
  const url = webhookUrl || (botToken && channelId ? `https://discord.com/api/v10/channels/${channelId}/messages` : undefined);
  if (!url) return false;
  try {
    const form = new FormData();
    form.append("payload_json", JSON.stringify(payload));
    files.forEach((file, index) => form.append(`files[${index}]`, new Blob([file.data as unknown as BlobPart], { type: "image/png" }), file.name));
    const response = await fetch(url, {
      method: "POST",
      headers: botToken && !webhookUrl ? { Authorization: `Bot ${botToken}` } : undefined,
      body: form
    });
    return response.ok;
  } catch (error) {
    console.warn("Discord history report failed", error);
    return false;
  }
}

function compact(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

export async function sendDiscordHistoryReport(username: string, history: HistoryGame[]): Promise<DiscordNotificationStatus> {
  if (!process.env.DISCORD_WEBHOOK_URL?.trim() && !(process.env.DISCORD_BOT_TOKEN?.trim() && process.env.DISCORD_CHANNEL_ID?.trim())) return "disabled";
  const analyzed = history.filter((entry) => entry.mistakes.length || entry.game.id);
  const allMistakes = analyzed.flatMap((entry) => entry.mistakes.map((item) => ({ ...item, game: entry.game })));
  const severity = { inaccuracy: 0, mistake: 0, blunder: 0 };
  const categories: Record<string, number> = {};
  for (const item of allMistakes) {
    severity[item.mistake.severity] += 1;
    const category = item.explanation?.category ?? item.category ?? "Other";
    categories[category] = (categories[category] ?? 0) + 1;
  }
  const topCategories = Object.entries(categories).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const totalLoss = allMistakes.reduce((sum, item) => sum + item.mistake.evaluationLoss, 0);
  const pattern = allMistakes[0]?.explanation?.pattern ?? "Before committing to a move, name your opponent's strongest check, capture, or threat.";
  const summary = [
    `**Games analyzed:** ${analyzed.length}`,
    `**Games with improvement points:** ${analyzed.filter((entry) => entry.mistakes.length > 0).length}`,
    `**Total improvement points:** ${allMistakes.length}`,
    `**Severity:** ${severity.blunder} blunders · ${severity.mistake} mistakes · ${severity.inaccuracy} inaccuracies`,
    `**Total evaluation loss:** ${(totalLoss / 100).toFixed(1)} pawns`,
    `**Most common patterns:** ${topCategories.map(([name, count]) => `${name} (${count})`).join(", ") || "No recurring category yet."}`,
    `**Main habit to practice:** ${pattern}`
  ].join("\n");
  const summarySent = await postDiscordPayload({
    username: "Personal Chess Coach",
    embeds: [{ title: `${username}'s full chess history report`, description: compact(summary, 3900), color: 0x5865f2, footer: { text: "Built from the explanations already saved in Supabase." } }]
  });
  if (!summarySent) return "failed";

  const gameLines = analyzed.map((entry) => {
    const game = entry.game;
    const label = `${game.date ?? "Unknown date"} · ${game.white ?? "White"} vs ${game.black ?? "Black"} · ${game.result ?? "result unavailable"}`;
    return `• ${label}: **${entry.mistakes.length}** improvement point${entry.mistakes.length === 1 ? "" : "s"}${game.url ? ` · ${game.url}` : ""}`;
  });
  for (let index = 0; index < gameLines.length; index += 8) {
    const page = gameLines.slice(index, index + 8).join("\n");
    if (!(await postDiscordPayload({ username: "Personal Chess Coach", content: `**Games ${index + 1}–${Math.min(index + 8, gameLines.length)}**\n${compact(page, 1800)}` }))) return "failed";
  }

  const detailLines = allMistakes.map((item, index) => {
    const move = describeMistake(item.mistake);
    const explanation = item.explanation;
    const gameLabel = `${item.game.date ?? "Unknown date"} · ${item.game.white ?? "White"} vs ${item.game.black ?? "Black"}`;
    return `**${index + 1}. ${gameLabel} · move ${item.mistake.moveNumber} (${item.mistake.severity})**\nYou played **${move.played}**. Stockfish preferred **${move.best}**.\n${explanation?.explanation ?? explanation?.summary ?? "Stockfish found a stronger alternative."}\n**Practice:** ${explanation?.recommendation ?? "Before moving, check your opponent's checks, captures, and threats."}\n**Pattern:** ${explanation?.pattern ?? pattern}`;
  });
  for (let index = 0; index < detailLines.length; index += 3) {
    const page = detailLines.slice(index, index + 3).join("\n\n");
    if (!(await postDiscordPayload({ username: "Personal Chess Coach", content: compact(`**Detailed explanations ${index + 1}–${Math.min(index + 3, detailLines.length)}**\n${page}`, 1950) }))) return "failed";
  }

  const visual = [...allMistakes].sort((left, right) => right.mistake.evaluationLoss - left.mistake.evaluationLoss).slice(0, 5);
  for (let index = 0; index < visual.length; index += 1) {
    const item = visual[index];
    const move = describeMistake(item.mistake);
    const image = await sharp(Buffer.from(renderMistakeBoard(item.mistake, item.explanation?.summary))).png().toBuffer();
    if (!(await postDiscordPayload({
      username: "Personal Chess Coach",
      embeds: [{ title: `Visual example ${index + 1}: ${item.mistake.severity} · move ${item.mistake.moveNumber}`, description: compact(`Red is your move: **${move.played}**\nGreen is Stockfish's move: **${move.best}**\n\n${item.explanation?.summary ?? "This was the stronger alternative."}\n\n**Pattern:** ${item.explanation?.pattern ?? pattern}`, 3900), image: { url: `attachment://history-${index + 1}.png` }, color: item.mistake.severity === "blunder" ? 0xd83c3e : 0x2ecc71 }]
    }, [{ name: `history-${index + 1}.png`, data: image }]))) return "failed";
  }
  return "sent";
}
