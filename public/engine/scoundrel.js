// Scoundrel rules engine. Pure, deterministic, no I/O, no dependencies.
// Runs the same in the browser, Cloudflare Workers and Node, so server and client can never disagree.
//
// Scoundrel is a solo card game by Zach Gage and Kurt Bieg (2011).
//
// Cards are { suit, rank, kind }:
//   suit: "C" "S" "D" "H"      rank: 2..14 (J=11 Q=12 K=13 A=14)
//   kind: "monster" (clubs, spades), "weapon" (diamonds), "potion" (hearts)
//
// State is plain JSON (safe to store, send and compare). Every function returns a NEW state;
// nothing is mutated. A whole game is just seed + list of actions, so `replay` rebuilds it exactly.
//
// Actions:
//   { type: "skip" }                         avoid the whole room (all 4 go to the bottom of the deck)
//   { type: "take", card: i }                take room card i: equip a weapon, drink a potion,
//                                            or fight a monster with your weapon (if it's allowed)
//   { type: "take", card: i, bare: true }    fight monster i bare-handed (full damage, weapon untouched)

export const VERSION = "0.3.0";
export const MAX_HEALTH = 20;
export const ROOM_SIZE = 4;

export const DEFAULT_RULES = Object.freeze({
  // The published rules: after a weapon kills a monster, it can only be used on monsters of a
  // LOWER value than the last one it killed. Some versions allow equal ("lowerOrEqual").
  weaponLimit: "lower",
  // Bonus on a win: if you finish at full health and the last card you took was a potion,
  // its value is added to your score.
  potionBonus: true,
});

// ---------- seeded randomness ----------

// cyrb128: string -> four 32-bit seeds
function cyrb128(str) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4; h2 ^= h1; h3 ^= h1; h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

// sfc32: four 32-bit seeds -> random float in [0, 1)
function sfc32(a, b, c, d) {
  return () => {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

export function rng(seed) {
  const r = sfc32(...cyrb128(String(seed)));
  for (let i = 0; i < 15; i++) r(); // warm up
  return r;
}

// ---------- cards ----------

const KIND = { C: "monster", S: "monster", D: "weapon", H: "potion" };

export function card(suit, rank) {
  return { suit, rank, kind: KIND[suit] };
}

// The 44-card dungeon: all clubs and spades 2..A, diamonds and hearts 2..10
// (red face cards and red aces are removed).
export function fullDeck() {
  const out = [];
  for (const suit of ["C", "S", "D", "H"]) {
    const top = suit === "C" || suit === "S" ? 14 : 10;
    for (let rank = 2; rank <= top; rank++) out.push(card(suit, rank));
  }
  return out;
}

export function shuffledDeck(seed) {
  const deck = fullDeck();
  const r = rng(seed);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

const RANK_NAME = { 11: "J", 12: "Q", 13: "K", 14: "A" };
const SUIT_SYMBOL = { C: "♣", S: "♠", D: "♦", H: "♥" };
export const cardName = (c) => `${RANK_NAME[c.rank] || c.rank}${SUIT_SYMBOL[c.suit]}`;
export const cardCode = (c) => `${RANK_NAME[c.rank] || (c.rank === 10 ? "T" : c.rank)}${c.suit}`; // "TD", "AS"

// ---------- game ----------

export function newGame(seed, rules = {}) {
  const deck = shuffledDeck(seed);
  return deal({
    v: VERSION,
    seed: String(seed),
    rules: { ...DEFAULT_RULES, ...rules },
    health: MAX_HEALTH,
    deck,                 // top of the deck is deck[0]
    room: [],
    weapon: null,         // { card, kills: [monster cards on it, newest last] }
    discard: [],
    turn: 0,              // rooms dealt so far
    takenThisRoom: 0,
    potionUsedThisRoom: false,
    skippedLastRoom: false,
    lastTaken: null,      // the last card taken (for the potion bonus)
    log: [],              // the actions that were applied, in order
    status: "playing",    // "playing" | "won" | "dead"
    score: null,
  });
}

// Fill the room back up to 4 (or as many as are left) and start a new turn.
// Each card on the table sits in one of 4 slots and keeps it until taken; new cards fill the empty
// slots left to right. (Only for showing the room: actions still point at room[] by index.)
function deal(s) {
  const need = ROOM_SIZE - s.room.length;
  const drawn = s.deck.slice(0, need);
  const slots = [...(s.slots || Array(ROOM_SIZE).fill(null))];
  for (const c of drawn) slots[slots.indexOf(null)] = cardCode(c);
  return {
    ...s,
    slots,
    room: [...s.room, ...drawn],
    deck: s.deck.slice(drawn.length),
    turn: s.turn + 1,
    takenThisRoom: 0,
    potionUsedThisRoom: false,
  };
}

// The value the weapon can still hit, or null if it has no kills yet (anything goes).
function weaponCeiling(s) {
  if (!s.weapon || !s.weapon.kills.length) return null;
  return s.weapon.kills[s.weapon.kills.length - 1].rank;
}

export function canUseWeaponOn(s, monster) {
  if (!s.weapon) return false;
  const top = weaponCeiling(s);
  if (top == null) return true;
  return s.rules.weaponLimit === "lowerOrEqual" ? monster.rank <= top : monster.rank < top;
}

export function canSkip(s) {
  return s.status === "playing" && !s.skippedLastRoom && s.takenThisRoom === 0
    && s.room.length === ROOM_SIZE && s.deck.length > 0;
}

// Every action the player may take right now.
export function legalActions(s) {
  if (s.status !== "playing") return [];
  const out = [];
  if (canSkip(s)) out.push({ type: "skip" });
  s.room.forEach((c, i) => {
    if (c.kind !== "monster") out.push({ type: "take", card: i });
    else {
      if (canUseWeaponOn(s, c)) out.push({ type: "take", card: i });
      out.push({ type: "take", card: i, bare: true });
    }
  });
  return out;
}

export class IllegalMove extends Error {
  constructor(msg) { super(msg); this.name = "IllegalMove"; }
}

// Apply one action. Returns { state, events }. Throws IllegalMove if the action isn't allowed.
// events describe what happened, for the screen to animate and the log to show.
export function apply(s, action) {
  if (s.status !== "playing") throw new IllegalMove("The game is over.");
  const events = [];
  let n = { ...s, log: [...s.log, action] };

  if (action.type === "skip") {
    if (!canSkip(s)) {
      throw new IllegalMove(s.skippedLastRoom ? "You can't skip two rooms in a row."
        : s.takenThisRoom ? "You've already started this room." : "You can't skip this room.");
    }
    events.push({ type: "skip", cards: s.room });
    n = { ...n, deck: [...s.deck, ...s.room], room: [], slots: Array(ROOM_SIZE).fill(null), skippedLastRoom: true };
    n = deal(n);
    events.push({ type: "deal", cards: n.room, turn: n.turn });
    return { state: n, events };
  }

  if (action.type !== "take") throw new IllegalMove(`Unknown action "${action.type}".`);
  const i = action.card;
  if (!Number.isInteger(i) || i < 0 || i >= s.room.length) throw new IllegalMove("No such card in this room.");
  const c = s.room[i];
  n.room = s.room.filter((_, k) => k !== i);
  n.slots = s.slots.map((x) => (x === cardCode(c) ? null : x));
  n.takenThisRoom = s.takenThisRoom + 1;
  n.lastTaken = c;

  if (c.kind === "weapon") {
    if (action.bare) throw new IllegalMove("Only monsters can be fought bare-handed.");
    const dropped = s.weapon ? [s.weapon.card, ...s.weapon.kills] : [];
    n.discard = [...s.discard, ...dropped];
    n.weapon = { card: c, kills: [] };
    events.push({ type: "equip", card: c, dropped });
  } else if (c.kind === "potion") {
    if (action.bare) throw new IllegalMove("Only monsters can be fought bare-handed.");
    n.discard = [...s.discard, c];
    if (s.potionUsedThisRoom) {
      events.push({ type: "potion_wasted", card: c });
    } else {
      const healed = Math.min(MAX_HEALTH, s.health + c.rank) - s.health;
      n.health = s.health + healed;
      n.potionUsedThisRoom = true;
      events.push({ type: "heal", card: c, amount: healed, health: n.health });
    }
  } else {
    const armed = !action.bare;
    if (armed && !s.weapon) throw new IllegalMove("You have no weapon. Fight it bare-handed.");
    if (armed && !canUseWeaponOn(s, c)) {
      throw new IllegalMove(`Your weapon can only hit monsters ${s.rules.weaponLimit === "lowerOrEqual" ? "up to" : "below"} ${weaponCeiling(s)} now.`);
    }
    const damage = armed ? Math.max(0, c.rank - s.weapon.card.rank) : c.rank;
    n.health = s.health - damage;
    if (armed) n.weapon = { card: s.weapon.card, kills: [...s.weapon.kills, c] };
    else n.discard = [...s.discard, c];
    events.push({ type: "fight", card: c, armed, weapon: armed ? s.weapon.card : null, damage, health: n.health });
  }

  // death
  if (n.health <= 0) {
    const left = [...n.room, ...n.deck].filter((x) => x.kind === "monster");
    n.status = "dead";
    n.score = n.health - left.reduce((t, x) => t + x.rank, 0);
    events.push({ type: "dead", score: n.score, monstersLeft: left.length });
    return { state: n, events };
  }

  // dungeon cleared
  if (!n.room.length && !n.deck.length) {
    n.status = "won";
    const bonus = n.rules.potionBonus && n.health === MAX_HEALTH && c.kind === "potion" ? c.rank : 0;
    n.score = n.health + bonus;
    events.push({ type: "won", score: n.score, bonus });
    return { state: n, events };
  }

  // three of four taken (or the room ran out): the next room comes
  if (n.room.length <= ROOM_SIZE - 3 && n.deck.length) {
    n.skippedLastRoom = false;
    n = deal(n);
    events.push({ type: "deal", cards: n.room, turn: n.turn });
  }
  return { state: n, events };
}

// Rebuild a game from its seed and actions. Throws IllegalMove on the first bad action.
export function replay(seed, actions, rules = {}) {
  let s = newGame(seed, rules);
  for (const a of actions) s = apply(s, a).state;
  return s;
}

// What a player is allowed to see: never the order of the deck.
export function publicView(s) {
  const deckMonsters = s.deck.filter((c) => c.kind === "monster").length;
  return {
    health: s.health,
    maxHealth: MAX_HEALTH,
    room: s.room,
    weapon: s.weapon,
    weaponCeiling: weaponCeiling(s),
    deckCount: s.deck.length,
    deckMonsters,
    discardCount: s.discard.length,
    turn: s.turn,
    // where each room card sits on the table: slots[0..3] = an index into room, or null for an empty slot
    slots: s.slots.map((code) => (code ? s.room.findIndex((c) => cardCode(c) === code) : null)),
    canSkip: canSkip(s),
    skippedLastRoom: s.skippedLastRoom,
    takenThisRoom: s.takenThisRoom,
    last: s.lastTaken,
    deckWeapons: s.deck.filter((c) => c.kind === "weapon").length,
    deckPotions: s.deck.filter((c) => c.kind === "potion").length,
    potionUsedThisRoom: s.potionUsedThisRoom,
    legal: legalActions(s),
    status: s.status,
    score: s.score,
  };
}

// A spoiler-free summary for the share card: one mark per room.
//   ↷ skipped   ⚔ used the weapon   ‼ fought bare-handed   ♥ healed   · nothing to fight
// (all single-column text characters, so they line up in a monospace grid; no emoji)
export function shareMarks(seed, actions, rules = {}) {
  let s = newGame(seed, rules);
  const rooms = [];
  let cur = "";
  for (const a of actions) {
    const { state, events } = apply(s, a);
    for (const e of events) {
      if (e.type === "skip") cur += "↷";
      else if (e.type === "fight") cur += e.armed ? "⚔" : "‼";
      else if (e.type === "heal") cur += "♥";
      else if (e.type === "deal" || e.type === "won" || e.type === "dead") { if (cur) rooms.push(cur); cur = ""; }
    }
    s = state;
  }
  if (cur) rooms.push(cur);
  return rooms.map((r) => (r.includes("↷") ? "↷" : r.includes("‼") ? "‼" : r.includes("⚔") ? "⚔" : r.includes("♥") ? "♥" : "·"));
}
