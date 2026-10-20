-- scoundrel.exe database (Cloudflare D1)
--   npx wrangler d1 execute scoundrel-db --remote --file=schema.sql

-- A player is a browser cookie. The cookie holds a random token; only its SHA-256 hash is stored.
-- Every player has a name: a random two-word one (src/names.js) until they pick their own.
CREATE TABLE IF NOT EXISTS players (
  id          INTEGER PRIMARY KEY,
  token_hash  TEXT NOT NULL UNIQUE,
  name        TEXT,
  name_key    TEXT UNIQUE,            -- lowercase name, so names are unique ignoring case
  created_at  INTEGER NOT NULL,       -- unix seconds
  seen_at     INTEGER NOT NULL,
  tester      INTEGER NOT NULL DEFAULT 0,  -- 1 = unlimited restarts, left off the leaderboard
  admin       INTEGER NOT NULL DEFAULT 0   -- 1 = can switch tester on and off in the game
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

-- extra devices a player is loaded on (the first device keeps using players.token_hash)
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,         -- SHA-256 of the cookie token
  player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  seen_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_player ON sessions (player_id);

-- save codes like K7QM-2XPA-9RTD-HV4C-8NBE; only their hash is stored (up to 5 per player)
CREATE TABLE IF NOT EXISTS save_codes (
  id            INTEGER PRIMARY KEY,
  player_id     INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  code_hash     TEXT NOT NULL UNIQUE,
  created_at    INTEGER NOT NULL,
  last_used_at  INTEGER
);
CREATE INDEX IF NOT EXISTS save_codes_player ON save_codes (player_id);

-- passkeys (WebAuthn): the public half of each key
CREATE TABLE IF NOT EXISTS passkeys (
  id            INTEGER PRIMARY KEY,
  player_id     INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  cred_id       TEXT NOT NULL UNIQUE,
  public_key    TEXT NOT NULL,          -- JWK
  alg           INTEGER NOT NULL,       -- -7 ES256, -257 RS256
  sign_count    INTEGER NOT NULL DEFAULT 0,
  label         TEXT,
  created_at    INTEGER NOT NULL,
  last_used_at  INTEGER
);
CREATE INDEX IF NOT EXISTS passkeys_player ON passkeys (player_id);

CREATE TABLE IF NOT EXISTS passkey_challenges (
  challenge   TEXT PRIMARY KEY,
  player_id   INTEGER,
  kind        TEXT NOT NULL,            -- register | login
  expires_at  INTEGER NOT NULL
);

-- slows down guessing save codes
CREATE TABLE IF NOT EXISTS rate_limits (
  key           TEXT NOT NULL,
  window_start  INTEGER NOT NULL,
  count         INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);
