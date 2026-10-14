# scoundrel.exe (v0.8.3)

A daily seeded Scoundrel game: everyone plays the same 44-card deck each UTC day.
Scoundrel is a solo card game by Zach Gage and Kurt Bieg (2011).

Pure JavaScript modules with no dependencies. The same code runs in the browser, in Cloudflare
Workers and in Node, so the server and the screen can never disagree about the rules.

```
engine/scoundrel.js   the rules: deck, shuffle, actions, scoring, replay, share marks
engine/daily.js       the daily seed (HMAC of the UTC date with a server secret)
test/                 tests (node --test)
src/worker.js         the Cloudflare Worker: daily deal, players, moves, leaderboard, ledger
src/ledger.js         the ledger: one hash chain over every deal, move and finished run
src/saves.js          save codes, extra devices, rate limits
src/passkeys.js       passkeys (WebAuthn), no libraries (ported from the 88x31 cLuB)
public/index.html     the site: an 80-column text screen (app.js draws it), VT323 font (fonts/OFL.txt)
migrations/           database changes for an existing database
schema.sql            database tables (D1)
wrangler.jsonc        Worker config
play.mjs              play it in a terminal
```

## Setup (once)

Live at **https://scoundrel.88x31.app** (a custom domain on the Worker, set in `wrangler.jsonc`; the old
workers.dev address redirects there). The Worker `scoundrel-exe` is connected to this repo, so every push
to `main` deploys it.
It needs a database and a secret first. From a terminal in this folder, with Node.js installed
(PowerShell works as-is):

```
npx wrangler login
npx wrangler d1 create scoundrel-db
```

Copy the `database_id` it prints into `wrangler.jsonc` (already done for the live database), then:

```
npx wrangler d1 execute scoundrel-db --remote --file=schema.sql
npx wrangler secret put DAILY_SECRET
```

For `DAILY_SECRET`, paste any long random text (a password manager's 40+ character password is
perfect). It decides every day's deck. Keep it secret and never change it: a new secret means a
different deck for today, and past days' decks would no longer match their scores.

### Updating an existing database

v0.3 adds the ledger. Run once, right after pushing v0.3 (starting a run errors until it's done):

```
curl.exe -O https://raw.githubusercontent.com/okayline/scoundrel.exe/main/migrations/001_ledger.sql
npx wrangler d1 execute scoundrel-db --remote --file=001_ledger.sql
```

v0.4–v0.5 migrations (the `tester` column from 002 is no longer used; it's harmless):

```
curl.exe -O https://raw.githubusercontent.com/okayline/scoundrel.exe/main/migrations/002_tester.sql
npx wrangler d1 execute scoundrel-db --remote --file=002_tester.sql
curl.exe -O https://raw.githubusercontent.com/okayline/scoundrel.exe/main/migrations/003_admin.sql
npx wrangler d1 execute scoundrel-db --remote --file=003_admin.sql
curl.exe -O https://raw.githubusercontent.com/okayline/scoundrel.exe/main/migrations/004_saves.sql
npx wrangler d1 execute scoundrel-db --remote --file=004_saves.sql
```

(002 and 003 stop with "duplicate column name" if they've already run: that's fine.)

### Admin

Make yourself an admin once, by your leaderboard name in lowercase:

```
npx wrangler d1 execute scoundrel-db --remote --command "UPDATE players SET admin = 1 WHERE name_key = 'kura'"
```

Admins can press [R]ESTART any time for a fresh deal of today's deck, to try the game and its screens.
Admin runs don't count: they're never on the ledger or the leaderboard. `admin = 0` turns it off.

To wipe the ledger and start it over (it re-seals today's deal on the next player's start or move):

```
npx wrangler d1 execute scoundrel-db --remote --command "DELETE FROM ledger"
```

`LAUNCH_DAY` in `wrangler.jsonc` is day #1 for the share cards ("scoundrel.exe #12").

## How the daily game works

- Everyone plays the same deck each **UTC** day. The deck comes from `HMAC(DAILY_SECRET, date)`,
  so nobody can work out tomorrow's.
- **The server deals.** The browser only sees the current room, health, weapon and counts, never
  the deck order. Each move is sent to the server, checked by the engine, and saved.
- **One ranked run a day.** A run started just before midnight can still be finished the next day.
- **Players are a cookie**, no signup. A name is only needed to show up on the leaderboard.
- **Save codes and passkeys** (PLAYER screen) log you in as the same player on another browser or device.
  [L]OG OUT makes this browser a guest again (only once you have a save code or passkey to get back in).
  Only hashes of codes and cookie tokens are stored. Code guesses are limited to 10 per 15 minutes.
  Passkeys belong to the site's address: if the game moves to a new domain, use a save code there.
  Adding a passkey without a save code nudges you to make one as a backup. Save codes can be downloaded as a .txt.
- Once a day is over, its seed is public on the leaderboard, so anyone can check the scores.

## The ledger

One SHA-256 hash chain over everything: `hash = SHA-256(prev_hash + "|" + record)`, starting from 64 zeros.
Changing any old record breaks every hash after it, and `prev_hash` is unique so the chain can't fork.

- **deal**: the first start of each day seals the hash of that day's seed. When the seed goes public
  after the day, anyone can check the deck was never changed.
- **move**: every move with the whole story (cards, blade, damage, HP before and after, the next room).
  A move and its entry are saved in one transaction: a move is saved only if it's sealed.
- **run**: a run ended (cleared or deleted, score, HP, room).
Admin runs are never sealed.

Records hold player ids, never names. Today's moves by other players are hidden on the ledger
("took a card") until the day ends; your own moves, deals and run endings always show in full.

## API

```
GET  /api/today                   day number, countdown, your run, your name
POST /api/start                   start today's run (one per UTC day)
POST /api/move  {day, n, action}  a move; n = moves made so far (stops double-sends)
POST /api/name  {name}            pick a name
GET  /api/leaderboard?day=        top 100 (+ your rank); past days include the seed
GET  /api/share?day=              share card text for a finished run
GET  /api/history                 your last 30 runs
GET  /api/ledger?before=&limit=   the ledger, newest first (today's moves by others hidden)
POST /api/restart                 admins only: a fresh deal of today's deck (admin runs don't count)
GET  /api/account                 your name, flags, save codes and passkeys (never the codes)
POST /api/codes   {action, id}    "new" makes a save code (shown once), "remove" forgets one
POST /api/load    {code}          load the player a save code belongs to on this browser
POST /api/logout                  this browser forgets its player (needs a save code or passkey first)
POST /api/passkey {action, ...}   register_options, register, login_options, login, remove
```

## Try it

```
node play.mjs            a random deck
node play.mjs hello      the same deck every time for seed "hello"
npm test                 run the tests (engine + the Worker on a stand-in database)
```

In the terminal: `1`–`4` take a card (monsters get your weapon if it can hit them, bare hands if not),
`b1`–`b4` fight bare-handed on purpose, `s` skip the room, `q` quit.

## Rules as built

- **Deck:** 44 cards. Clubs and spades 2–A are monsters (A = 14). Diamonds 2–10 are weapons,
  hearts 2–10 are potions. Red face cards and red aces are out.
- **Health:** start at 20, never above 20.
- **Rooms:** 4 cards. Take 3; the 4th stays and 3 new cards join it. You may skip a whole room
  (it goes to the bottom of the deck), but not two in a row, and not once you've taken a card.
  At the end the room just runs down with no refill.
- **Weapons:** taking one equips it and throws out the old one with its kills. Fighting with it does
  monster − weapon damage (never below 0). After a kill, it can only hit monsters **lower** than the
  last one it killed. Bare hands take full damage and don't touch the weapon.
- **Potions:** one heals per room; a second one in the same room is wasted.
- **Score:** clear the deck and your score is your health, plus the potion's value if you're at 20 and
  the last card was a potion. Die and it's your health minus every monster left (always ≤ 0).

Two rule options (`newGame(seed, { ... })`):
- `weaponLimit: "lower"` (published rules, default) or `"lowerOrEqual"` (common house rule).
- `potionBonus: true` (default) or `false`.

## Using it

```js
import * as G from "./engine/scoundrel.js";
import { dailySeed, utcDay } from "./engine/daily.js";

const seed = await dailySeed(env.DAILY_SECRET, utcDay());   // server only
let s = G.newGame(seed);
const { state, events } = G.apply(s, { type: "take", card: 2 });   // throws G.IllegalMove if not allowed
G.publicView(state);              // what the browser may see: never the deck order
G.legalActions(state);            // every allowed action right now
G.replay(seed, state.log);        // rebuild the exact game from its actions
G.shareMarks(seed, state.log);    // one mark per room for the share card: ↷ ⚔ ‼ ♥ ·
```

State is plain JSON and never mutated, so it's safe to store in D1 or send over the wire.
A whole run is just `seed + actions`, which is all the server needs to check a score and show a replay.
