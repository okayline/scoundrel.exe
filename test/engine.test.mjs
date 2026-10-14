import { test } from "node:test";
import assert from "node:assert/strict";
import * as G from "../engine/scoundrel.js";
import { dailySeed, utcDay, dayNumber, msUntilNextDay } from "../engine/daily.js";

const C = (code) => { // "7S", "TD", "AH" -> card
  const r = { T: 10, J: 11, Q: 12, K: 13, A: 14 }[code[0]] ?? Number(code.slice(0, -1));
  return G.card(code.slice(-1), r);
};
// a game with a hand-built deck (top first)
const rigged = (codes, extra = {}) => {
  const s = G.newGame("x");
  const deck = codes.map(C);
  return { ...s, deck: deck.slice(4), room: deck.slice(0, 4), ...extra };
};
const idx = (s, code) => s.room.findIndex((c) => G.cardCode(c) === code);
const take = (s, code, bare) => G.apply(s, { type: "take", card: idx(s, code), ...(bare ? { bare: true } : {}) });

test("deck is the 44 Scoundrel cards", () => {
  const d = G.fullDeck();
  assert.equal(d.length, 44);
  assert.equal(d.filter((c) => c.kind === "monster").length, 26);
  assert.equal(d.filter((c) => c.kind === "weapon").length, 9);
  assert.equal(d.filter((c) => c.kind === "potion").length, 9);
  assert.ok(!d.some((c) => (c.suit === "D" || c.suit === "H") && c.rank > 10));
  assert.equal(new Set(d.map(G.cardCode)).size, 44);
});

test("same seed, same deck; different seed, different deck", () => {
  const a = G.shuffledDeck("2026-10-14").map(G.cardCode).join();
  assert.equal(G.shuffledDeck("2026-10-14").map(G.cardCode).join(), a);
  assert.notEqual(G.shuffledDeck("2026-10-15").map(G.cardCode).join(), a);
});

test("new game: 20 health, 4 in the room, 40 in the deck", () => {
  const s = G.newGame("seed");
  assert.equal(s.health, 20);
  assert.equal(s.room.length, 4);
  assert.equal(s.deck.length, 40);
  assert.equal(s.turn, 1);
});

test("weapons: damage is monster minus weapon, then only lower monsters", () => {
  let s = rigged(["5D", "9S", "7C", "8C", "2H", "2H", "2H", "2H"]);
  s = take(s, "5D").state;
  let r = take(s, "9S");
  assert.equal(r.state.health, 16);
  s = r.state;
  assert.ok(G.canUseWeaponOn(s, C("8C")));
  assert.ok(!G.canUseWeaponOn(s, C("9C")));
  assert.throws(() => G.apply(s, { type: "take", card: 99 }), G.IllegalMove);
});

test("weapon limit is strict by default, equal allowed with lowerOrEqual", () => {
  const s = { ...G.newGame("x"), weapon: { card: C("5D"), kills: [C("8S")] } };
  assert.ok(!G.canUseWeaponOn(s, C("8C")));
  assert.ok(G.canUseWeaponOn({ ...s, rules: { ...s.rules, weaponLimit: "lowerOrEqual" } }, C("8C")));
});

test("weapon stronger than monster: no damage", () => {
  let s = rigged(["9D", "4S", "2C", "3C", "5H", "5H", "5H", "5H"]);
  s = take(s, "9D").state;
  assert.equal(take(s, "4S").state.health, 20);
});

test("bare hands: full damage, weapon untouched", () => {
  let s = rigged(["5D", "9S", "7C", "3H", "2H", "2H", "2H", "2H"]);
  s = take(s, "5D").state;
  s = take(s, "7C", true).state;
  assert.equal(s.health, 13);
  assert.equal(s.weapon.kills.length, 0);
});

test("no weapon: must fight bare-handed", () => {
  const s = rigged(["9S", "7C", "3C", "2C", "2H", "2H", "2H", "2H"]);
  assert.throws(() => take(s, "9S"), /no weapon/);
  assert.equal(take(s, "9S", true).state.health, 11);
});

test("new weapon throws out the old one and its kills", () => {
  let s = rigged(["5D", "9S", "7D", "2C", "2H", "2H", "2H", "2H"]);
  s = take(s, "5D").state;
  s = take(s, "9S").state;
  const r = take(s, "7D");
  assert.equal(r.state.weapon.card.rank, 7);
  assert.equal(r.state.weapon.kills.length, 0);
  assert.equal(r.state.discard.length, 2);
});

test("potions: heal capped at 20, only one per room", () => {
  let s = rigged(["9S", "8H", "5H", "2C", "2D", "2D", "2D", "2D"]);
  s = take(s, "9S", true).state;           // 11
  s = take(s, "8H").state;                 // 19
  assert.equal(s.health, 19);
  const r = take(s, "5H");                 // wasted (and the room refills)
  assert.equal(r.events[0].type, "potion_wasted");
  assert.equal(r.state.health, 19);
  let t = rigged(["5H", "2C", "3C", "4C", "2D", "2D", "2D", "2D"]);
  t = take(t, "5H").state;
  assert.equal(t.health, 20);
});

test("taking 3 of 4 deals the next room, the 4th stays", () => {
  let s = rigged(["2S", "3S", "4S", "5S", "6S", "7S", "8S", "9S"]);
  s = take(s, "2S", true).state;
  s = take(s, "3S", true).state;
  const r = take(s, "4S", true);
  assert.equal(r.state.room.length, 4);
  assert.equal(G.cardCode(r.state.room[0]), "5S");
  assert.equal(r.state.turn, 2);
  assert.ok(r.events.some((e) => e.type === "deal"));
});

test("skipping: whole room to the bottom, never twice in a row, not once started", () => {
  let s = rigged(["AS", "KS", "QS", "JS", "2H", "3H", "4H", "5H", "6D", "7D", "8D", "9D"]);
  const r = G.apply(s, { type: "skip" });
  assert.deepEqual(r.state.deck.slice(-4).map(G.cardCode), ["AS", "KS", "QS", "JS"]);
  assert.deepEqual(r.state.room.map(G.cardCode), ["2H", "3H", "4H", "5H"]);
  assert.throws(() => G.apply(r.state, { type: "skip" }), /two rooms in a row/);
  // after playing a room through, skipping is allowed again
  let t = r.state;
  t = take(t, "2H").state; t = take(t, "3H").state; t = take(t, "4H").state;
  assert.ok(G.canSkip(t));
  // once you've taken a card, no skipping
  const u = take(t, "5H").state;
  assert.ok(!G.canSkip(u));
});

test("death: score is health minus the monsters still left", () => {
  const s = rigged(["AS", "KS", "QS", "JS", "2C", "3H", "4H", "5H"], { health: 5 });
  const r = take(s, "AS", true);
  assert.equal(r.state.status, "dead");
  // health -9, left: K Q J (36) + 2C (2) = 38 -> -47
  assert.equal(r.state.score, -9 - 38);
  assert.deepEqual(G.legalActions(r.state), []);
  assert.throws(() => G.apply(r.state, { type: "skip" }), /over/);
});

test("winning: score is health, plus a last potion at full health", () => {
  let s = { ...G.newGame("x"), deck: [], room: [C("2S"), C("5H")], health: 18 };
  s = take(s, "2S", true).state;       // 16
  const r = take(s, "5H");             // 20, last card a potion
  assert.equal(r.state.status, "won");
  assert.equal(r.state.score, 25);
  let t = { ...G.newGame("x"), deck: [], room: [C("3S")], health: 10 };
  assert.equal(take(t, "3S", true).state.score, 7);
});

test("the last few cards: room runs down without refilling", () => {
  let s = { ...G.newGame("x"), deck: [], room: [C("2S"), C("3S"), C("4S")] };
  s = take(s, "2S", true).state;
  assert.equal(s.room.length, 2);
  assert.ok(!G.canSkip(s));
});

test("replay rebuilds a game exactly, and random full games stay consistent", () => {
  for (let g = 0; g < 2000; g++) {
    const seed = "fuzz" + g;
    const r = G.rng("pick" + g);
    let s = G.newGame(seed);
    const actions = [];
    while (s.status === "playing") {
      const legal = G.legalActions(s);
      assert.ok(legal.length > 0);
      const a = legal[Math.floor(r() * legal.length)];
      actions.push(a);
      s = G.apply(s, a).state;
      // nothing lost or duplicated
      const all = [...s.deck, ...s.room, ...s.discard, ...(s.weapon ? [s.weapon.card, ...s.weapon.kills] : [])];
      assert.equal(all.length, 44);
      assert.equal(new Set(all.map(G.cardCode)).size, 44);
      assert.ok(s.health <= 20);
    }
    assert.ok(s.status === "won" ? s.score > 0 : s.score <= 0);
    assert.deepEqual(G.replay(seed, actions), s);
    assert.equal(G.shareMarks(seed, actions).length > 0, true);
  }
});

test("publicView never shows the deck order", () => {
  const v = G.publicView(G.newGame("seed"));
  assert.equal(v.deck, undefined);
  assert.equal(v.deckCount, 40);
  assert.equal(JSON.stringify(v).includes('"deck"'), false);
});

test("daily seeds: same day same seed, secret required, UTC days", async () => {
  const a = await dailySeed("s3cret", "2026-10-14");
  assert.equal(a, await dailySeed("s3cret", "2026-10-14"));
  assert.notEqual(a, await dailySeed("s3cret", "2026-10-15"));
  assert.notEqual(a, await dailySeed("other", "2026-10-14"));
  await assert.rejects(() => dailySeed("", "2026-10-14"));
  assert.equal(utcDay(new Date("2026-10-14T23:59:59-10:00")), "2026-10-15");
  assert.equal(dayNumber("2026-10-20", "2026-10-14"), 7);
  assert.equal(msUntilNextDay(new Date("2026-10-14T23:59:00Z")), 60000);
});

test("slots: cards keep their place on the table; new cards fill the gaps left to right", () => {
  let s = rigged(["2S", "3S", "4S", "5S", "6S", "7S", "8S", "9S", "TS", "JS", "QS", "KS"]);
  s = { ...s, slots: s.room.map(G.cardCode) };
  const at = (st) => G.publicView(st).slots.map((k) => (k == null ? null : G.cardCode(st.room[k])));
  assert.deepEqual(at(s), ["2S", "3S", "4S", "5S"]);
  s = take(s, "3S", true).state;
  assert.deepEqual(at(s), ["2S", null, "4S", "5S"]);
  s = take(s, "5S", true).state;
  assert.deepEqual(at(s), ["2S", null, "4S", null]);
  s = take(s, "2S", true).state;            // 3 taken: 4S stays in slot 3, new cards fill 1, 2, 4
  assert.deepEqual(at(s), ["6S", "7S", "4S", "8S"]);
  // a fresh game starts with all four slots filled in deal order, and skipping refills all four
  const g = G.newGame("slots");
  assert.deepEqual(G.publicView(g).slots, [0, 1, 2, 3]);
  const k = G.apply(g, { type: "skip" }).state;
  assert.deepEqual(G.publicView(k).slots, [0, 1, 2, 3]);
});
