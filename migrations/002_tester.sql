-- v0.4: tester players (unlimited restarts, left off the leaderboard). Additive.
--   npx wrangler d1 execute scoundrel-db --remote --file=migrations/002_tester.sql
-- Then make someone a tester (by their name, any case):
--   npx wrangler d1 execute scoundrel-db --remote --command "UPDATE players SET tester = 1 WHERE name_key = 'kura'"

ALTER TABLE players ADD COLUMN tester INTEGER NOT NULL DEFAULT 0;
