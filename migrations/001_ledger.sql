-- v0.3: the ledger. One SHA-256 hash chain over every deal, move and finished run, in the order sealed.
--   npx wrangler d1 execute scoundrel-db --remote --file=migrations/001_ledger.sql
-- Additive only, safe to run twice.

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
