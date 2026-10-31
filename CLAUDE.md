# scoundrel.exe: working notes

## This repo

A daily seeded Scoundrel game (the solo card game by Zach Gage and Kurt Bieg): everyone plays the same 44-card deck each UTC day. Live at scoundrel.88x31.app. The Worker `scoundrel-exe` is connected to this repo, so every push to `main` deploys it.

**Layout**
- `public/engine/scoundrel.js` is the rules (deck, shuffle, actions, scoring, replay, share marks). `engine/scoundrel.js` only re-exports it. Pure JavaScript with no dependencies, so the browser, the Worker and Node run the same code. Change a rule there, once.
- `engine/daily.js` makes the day's seed: an HMAC of the UTC date with the Worker secret `DAILY_SECRET`. Never change that secret: it changes every day's deck.
- `src/worker.js` is the Worker, `src/ledger.js` the hash chain over every deal, move and finished run, `src/saves.js` cookie tokens, extra devices and rate limits, `src/names.js` the names.
- `public/index.html` and `public/app.js` are the 80-column text screen. `play.mjs` plays the game in a terminal.
- `migrations/` (001 to 004) and `schema.sql` are the D1 database `scoundrel-db`.

**Services.** Save codes and passkeys are the shared Accounts service, and every finished run checkpoints this ledger in the shared copy registry. Both are the dungeon-items Worker (`ACCOUNTS`, `REGISTRY`), so deploy dungeon-items first.

**Testing.** `npm test` runs `node --test test/*.test.mjs`.

**Versions.** The real version is `data-version` on the footer script in `public/index.html`; `app.js` reads it. The title line in `README.md` says v0.8.9 and is out of date, so don't trust it. A release bumps `data-version` and adds an entry at the top of `CHANGELOG.md`. No test checks that these match, so check by hand. The detailed dev entry goes in `scoundrel.exe/changelog-v0.1.md` in the private dungeon-notes repo.
