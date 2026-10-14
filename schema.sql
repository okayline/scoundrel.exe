-- scoundrel.exe database (Cloudflare D1)
--   npx wrangler d1 execute scoundrel-db --remote --file=schema.sql

-- A player is a browser cookie. The cookie holds a random token; only its SHA-256 hash is stored.
-- A name is optional: you only need one to show up on the leaderboard.
CREATE TABLE IF NOT EXISTS players (
  id          INTEGER PRIMARY KEY,
  token_hash  TEXT NOT NULL UNIQUE,
  name        TEXT,
  name_key    TEXT UNIQUE,            -- lowercase name, so names are unique ignoring case
  created_at  INTEGER NOT NULL,       -- unix seconds
  seen_at     INTEGER NOT NULL,
  tester      INTEGER NOT NULL DEFAULT 0   -- 1 = unlimited restarts, left off the leaderboard
);

-- One ranked run per player per UTC day. The deck is never stored: it comes from the day's seed,
-- and the run is just its list of moves, replayed through the engine on every request.
CREATE TABLE IF NOT EXISTS runs (
  id           INTEGER PRIMARY KEY,
  player_id    INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  day          TEXT NOT NULL,         -- "2026-10-14" (UTC)
  actions      TEXT NOT NULL DEFAULT '[]',   -- JSON list of moves
  moves        INTEGER NOT NULL DEFAULT 0,   -- length of actions (guards against double-sends)
  status       TEXT NOT NULL DEFAULT 'playing',   -- playing | won | dead
  score        INTEGER,
  health       INTEGER NOT NULL DEFAULT 20,
  marks        TEXT,                  -- share marks, one per room, once finished
  started_at   INTEGER NOT NULL,
  finished_at  INTEGER,
  UNIQUE (player_id, day)
);

CREATE INDEX IF NOT EXISTS runs_board ON runs (day, status, score DESC, finished_at);

CREATE TABLE IF NOT EXISTS ledger (
  id          INTEGER PRIMARY KEY,
  kind        TEXT NOT NULL,          -- deal | move | run
  day         TEXT NOT NULL,          -- the deck's UTC day
  player_id   INTEGER,                -- move and run entries (ids, never names)
  run_id      INTEGER,
  n           INTEGER,                -- move number in the run (1, 2, 3...)
  record      TEXT NOT NULL,          -- the sealed JSON record
  prev_hash   TEXT NOT NULL UNIQUE,   -- one entry per chain head: the chain can't fork
  hash        TEXT NOT NULL UNIQUE,   -- SHA-256(prev_hash + "|" + record)
  created_at  INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ledger_one_deal ON ledger (day) WHERE kind = 'deal';
CREATE UNIQUE INDEX IF NOT EXISTS ledger_one_move ON ledger (run_id, n) WHERE kind = 'move';
CREATE UNIQUE INDEX IF NOT EXISTS ledger_one_end ON ledger (run_id) WHERE kind = 'run';
