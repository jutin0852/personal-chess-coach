# Personal Chess Coach

Phase 1 currently implements automatic Chess.com game discovery and local deduplication.

## Run

```powershell
Copy-Item .env.example .env
npm install
npm test
npm run typecheck
npm run sync
npm run analyze-one
npm run report-one
npm run migrate-supabase
npm run coach-cycle
```

`CHESSCOM_USERNAME` is the only required account setting. The Chess.com PubAPI is public and read-only; no password is used. The sync checks the latest three monthly archives, extracts PGN headers, and stores unseen games in `data/games.json`.

Stockfish analysis, structured mistake extraction, and grounded AI explanations are deliberately separate next steps. They will consume the stored PGNs rather than re-fetching games.

`analyze-one` uses the free Stockfish 19 lite single-threaded WASM build locally. It evaluates each position at depth 8, keeps only mistakes by the configured player, and reports the FEN before the move, evaluation swing, best move, and principal variation.

`report-one` adds a structured explanation layer. Without `OLLAMA_MODEL`, it uses a conservative evidence-only fallback. If Ollama is installed later, set `OLLAMA_MODEL` and the explanation provider will receive only the filtered mistake evidence—not the whole game.

## Supabase migration

1. Create a Supabase project and run `supabase/schema.sql` in its SQL editor.
2. Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `CHESSCOM_USERNAME` in `.env`.
3. Run `npm run migrate-supabase`.
4. Confirm the reported Supabase count matches the local game count before switching the worker backend.

The JSON store remains available until this verification is complete.

`coach-cycle` is the local automation unit: it syncs Chess.com, finds the newest Supabase game without a completed analysis, runs local Stockfish, generates grounded explanations, and saves the result. If there is nothing new to analyze, it exits without doing work.

## Online GitHub Actions worker

`.github/workflows/chess-coach.yml` runs the same coach cycle on a GitHub-hosted runner. It is intentionally triggered with `workflow_dispatch` so n8n Cloud can orchestrate it through GitHub's API. Add these repository secrets before running it:

- `CHESSCOM_USERNAME`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

### Discord reports (optional)

To receive a compact report when a newly analyzed game is stored, create an incoming webhook in your chosen Discord channel and add its URL as the repository secret `DISCORD_WEBHOOK_URL`. The URL is never committed. When the secret is absent, the worker continues normally and sends no Discord message.

The Supabase service-role key is used only inside the GitHub runner and must never be committed to the repository or placed in workflow YAML.

### Interactive Discord reviews

When `DISCORD_BOT_TOKEN` is present, the worker posts a navigable review card through the Personal Chess Coach bot. The token is read only from the encrypted GitHub Actions secret; the channel ID is the private `#chess-coach` channel. The existing webhook report remains the fallback when the bot secret is absent.
