import { readFileSync } from "node:fs";

function loadDotEnv(): void {
  try {
    const contents = readFileSync(".env", "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  } catch {
    // .env is optional; the shell environment is also supported.
  }
}

loadDotEnv();

export const config = {
  username: process.env.CHESSCOM_USERNAME?.trim(),
  userAgent: process.env.CHESSCOM_USER_AGENT?.trim() || "personal-chess-coach/0.1",
  dataDir: process.env.DATA_DIR?.trim() || "./data"
};

export function requireUsername(): string {
  if (!config.username) throw new Error("CHESSCOM_USERNAME is required. Copy .env.example to .env and set it.");
  return config.username;
}
