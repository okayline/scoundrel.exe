# scoundrel.exe (v0.1.0)

A daily seeded Scoundrel game: everyone plays the same 44-card deck each UTC day.
Scoundrel is a solo card game by Zach Gage and Kurt Bieg (2011).

Pure JavaScript modules with no dependencies. The same code runs in the browser, in Cloudflare
Workers and in Node, so the server and the screen can never disagree about the rules.

```
engine/scoundrel.js   the rules: deck, shuffle, actions, scoring, replay, share marks
engine/daily.js       the daily seed (HMAC of the UTC date with a server secret)
test/                 tests (node --test)
src/worker.js         the Cloudflare Worker: daily deal, players, moves, leaderboard
public/index.html     the site (a plain test page for now)
schema.sql            database tables (D1)
wrangler.jsonc        Worker config
play.mjs              play it in a terminal
```

## Setup (once)

The Worker `scoundrel-exe` is connected to this repo, so every push to `main` deploys it.
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

`LAUNCH_DAY` in `wrangler.jsonc` is day #1 for the share cards ("scoundrel.exe #12").

## How the daily game works

- Everyone plays the same deck each **UTC** day. The deck comes from `HMAC(DAILY_SECRET, date)`,
  so nobody can work out tomorrow's.
- **The server deals.** The browser only sees the current room, health, weapon and counts, never
  the deck order. Each move is sent to the server, checked by the engine, and saved.
- **One ranked run a day.** A run started just before midnight can still be finished the next day.
- **Players are a cookie**, no signup. A name is only needed to show up on the leaderboard.
- Once a day is over, its seed is public on the leaderboard, so anyone can check the scores.

## API

```
GET  /api/today                   day number, countdown, your run, your name
POST /api/start                   start today's run (one per UTC day)
POST /api/move  {day, n, action}  a move; n = moves made so far (stops double-sends)
POST /api/name  {name}            pick a name
GET  /api/leaderboard?day=        top 100 (+ your rank); past days include the seed
GET  /api/share?day=              share card text for a finished run
GET  /api/history                 your last 30 runs
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
G.shareMarks(seed, state.log);    // one mark per room for the share card: ↷ ⚔ ✊ ♥ ·
```

State is plain JSON and never mutated, so it's safe to store in D1 or send over the wire.
A whole run is just `seed + actions`, which is all the server needs to check a score and show a replay.
