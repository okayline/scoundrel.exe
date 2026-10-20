// The ledger: one SHA-256 hash chain over every deal, move and finished run, in the order sealed.
//
//   kind "deal" - a day's deck, sealed by the hash of its seed (the seed itself stays secret until
//                 the day ends; then anyone can check it matches)
//   kind "move" - one move in a run, with the whole story: the cards, the blade, damage, HP before and after,
//                 and the next room if one was dealt
//   kind "run"  - a run ended: cleared or deleted, score, HP, room
//
// Admin runs are never sealed (they don't count).
//
//   record = JSON of the event
//   hash   = SHA-256( prev_hash + "|" + record )
//
// The first entry chains from GENESIS. Changing any old record breaks its hash and every hash after it.
// prev_hash is UNIQUE, so two entries can never build on the same head (no forks). Records hold
// player ids, never names.
//
// Moves and run endings are sealed in the same database transaction (a D1 batch) as the move itself,
// so a move is saved if and only if it's on the ledger.

import * as G from "../engine/scoundrel.js";

export const GENESIS = "0".repeat(64);

export async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const code = (c) => G.cardCode(c);

// The engine's events, written down compactly (card codes like "KS", "TD").
export function eventsRecord(events) {
  const out = [];
  for (const e of events) {
    if (e.type === "skip") out.push(["skip", e.cards.map(code)]);
    else if (e.type === "equip") out.push(["equip", code(e.card), e.dropped.map(code)]);
    else if (e.type === "heal") out.push(["heal", code(e.card), e.amount]);
    else if (e.type === "potion_wasted") out.push(["wasted", code(e.card)]);
    else if (e.type === "fight") out.push(["fight", code(e.card), e.armed ? code(e.weapon) : null, e.damage]);
    else if (e.type === "deal") out.push(["deal", e.turn, e.cards.map(code)]);
  }
  return out;
}

export function moveRecord({ day, playerId, runId, n, room, action, before, after, events, t }) {
  return JSON.stringify({
    kind: "move", day, player: playerId, run: runId, n, room,
    action: action.type === "skip" ? "skip" : action.bare ? "take_bare" : "take",
    card: action.type === "take" ? code(before.room[action.card]) : null,
    events: eventsRecord(events),
    hp: [before.health, after.health],
    t,
  });
}

export function runRecord({ day, playerId, runId, state, t }) {
  const left = [...state.room, ...state.deck].filter((c) => c.kind === "monster");
  return JSON.stringify({
    kind: "run", day, player: playerId, run: runId, status: state.status, score: state.score,
    hp: state.health, room: state.turn, moves: state.log.length, demons_left: left.length, t,
  });
}

export function dealRecord({ day, seedHash, t }) {
  return JSON.stringify({ kind: "deal", day, seed_hash: seedHash, t });
}

export async function head(db) {
  const h = await db.prepare("SELECT hash FROM ledger ORDER BY id DESC LIMIT 1").first();
  return h ? h.hash : GENESIS;
}

// Build insert statements for a list of entries chained one after another from `prev`.
// `guard` is an optional SQL condition (with its binds) that must hold for the inserts to happen;
// for moves it's "the run now has exactly this many moves", so nothing is sealed for a move that
// didn't save (and the unique indexes stop a double-sent move being sealed twice).
export async function chainInserts(db, prev, entries, guard = null) {
  const stmts = [];
  let p = prev;
  for (const e of entries) {
    const hash = await sha256(p + "|" + e.record);
    stmts.push(db.prepare(
      `INSERT INTO ledger (kind, day, player_id, run_id, n, record, prev_hash, hash, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? ${guard ? "WHERE " + guard.sql : ""}`)
      .bind(e.kind, e.day, e.playerId ?? null, e.runId ?? null, e.n ?? null, e.record, p, hash, e.t, ...(guard ? guard.args : [])));
    p = hash;
  }
  return stmts;
}

// Check rows (oldest first) form an unbroken chain from GENESIS: { ok: true } or { ok: false, at: id }.
export async function verifyChain(rows) {
  let p = GENESIS;
  for (const r of rows) {
    if (r.prev_hash !== p || (await sha256(p + "|" + r.record)) !== r.hash) return { ok: false, at: r.id };
    p = r.hash;
  }
  return { ok: true };
}

export const isUnique = (e, what) => /UNIQUE/i.test(String(e && e.message)) && (!what || String(e.message).includes(what));

// Seal the day's deal once (the first start or move of the day does it).
export async function ensureDeal(env, day, seed) {
  const db = env.DB;
  if (await db.prepare("SELECT 1 FROM ledger WHERE kind = 'deal' AND day = ?").bind(day).first()) return;
  const t = Math.floor(Date.now() / 1000);
  const record = dealRecord({ day, seedHash: await sha256(seed), t });
  for (let i = 0; i < 6; i++) {
    const stmts = await chainInserts(db, await head(db), [{ kind: "deal", day, record, t }]);
    try { await stmts[0].run(); return; }
    catch (e) {
      if (!isUnique(e)) throw e;
      if (await db.prepare("SELECT 1 FROM ledger WHERE kind = 'deal' AND day = ?").bind(day).first()) return;
      // someone else sealed something first: build on the new head and try again
    }
  }
  throw new Error("The ledger is busy. Try again.");
}
