create table if not exists public.games (
  id bigint generated always as identity primary key,
  chesscom_game_id text not null unique,
  chesscom_url text,
  username text not null,
  game_date date,
  white text,
  black text,
  result text,
  white_elo integer,
  black_elo integer,
  time_control text,
  pgn text not null,
  source_archive text not null,
  discovered_at timestamptz not null
);

create table if not exists public.analyses (
  id bigint generated always as identity primary key,
  game_id bigint not null references public.games(id) on delete cascade,
  status text not null check (status in ('running', 'completed', 'failed')),
  engine_name text not null,
  engine_version text,
  depth integer not null,
  started_at timestamptz not null,
  completed_at timestamptz,
  error_message text,
  unique (game_id, engine_name, engine_version, depth)
);

create table if not exists public.mistakes (
  id bigint generated always as identity primary key,
  analysis_id bigint not null references public.analyses(id) on delete cascade,
  ply integer not null,
  move_number integer not null,
  color text not null check (color in ('w', 'b')),
  move_played text not null,
  best_move text not null,
  fen_before text not null,
  evaluation_before jsonb not null,
  evaluation_after jsonb not null,
  evaluation_loss integer not null,
  continuation jsonb not null,
  severity text not null,
  category text,
  ai_explanation jsonb,
  unique (analysis_id, ply)
);

alter table public.games enable row level security;
alter table public.analyses enable row level security;
alter table public.mistakes enable row level security;
