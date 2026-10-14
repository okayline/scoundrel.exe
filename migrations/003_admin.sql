-- v0.5: admins can switch tester on and off for themselves in the game. Additive.
--   npx wrangler d1 execute scoundrel-db --remote --file=migrations/003_admin.sql
-- Then make yourself an admin (once, by your name in lowercase):
--   npx wrangler d1 execute scoundrel-db --remote --command "UPDATE players SET admin = 1 WHERE name_key = 'kura'"

ALTER TABLE players ADD COLUMN admin INTEGER NOT NULL DEFAULT 0;
