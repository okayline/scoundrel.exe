# scoundrel.exe (v0.1.0)

A daily seeded Scoundrel game: everyone plays the same 44-card deck each UTC day.
Scoundrel is a solo card game by Zach Gage and Kurt Bieg (2011).

Pure JavaScript modules with no dependencies. The same code runs in the browser, in Cloudflare
Workers and in Node, so the server and the screen can never disagree about the rules.

```
engine/scoundrel.js   the rules: deck, shuffle, actions, scoring, replay, share marks
engine/daily.js       the daily seed (HMAC of the UTC date with a server secret)
test/                 tests (node --test)
play.mjs              play it in a terminal
```

## Try it

```
node play.mjs            a random deck
node play.mjs hello      the same deck every time for seed "hello"
npm test                 run the tests
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
