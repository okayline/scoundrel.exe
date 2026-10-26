// scoundrel.exe Worker: the daily deck, cookie players, one ranked run a day, the leaderboard.
//
// The server deals. The browser only ever gets publicView (the room, health, weapon, counts),
// never the deck order, and every move is checked by the same engine the tests use.
// A run is stored as its list of moves; the deck comes back from the day's seed, so nothing to cheat with.
//
// API (all JSON):
//   GET  /api/today                 today's day number, countdown, your run (or not started), your name
//   POST /api/start                 start today's ranked run (one per UTC day)
//   POST /api/move  {day, n, action}   make a move; n = how many moves you've made (stops double-sends)
//   POST /api/name  {name}          pick a name (needed to show on the leaderboard)
//   GET  /api/leaderboard?day=      a day's top 100; past days also reveal their seed
//   GET  /api/run?hash=             one finished run's page, found by its ledger fingerprint; only once its day is over
//   GET  /api/share?day=            your share card text for a finished run
//   GET  /api/history               your last 30 runs
//   GET  /api/ledger?before=&limit=  the ledger, newest first; today's moves by other players are hidden
//   POST /api/restart               admins only: throw today's run away and deal it again (admin runs don't count)
//   GET  /api/account               your name, flags, save codes and passkeys (never the codes themselves)
//   POST /api/codes {action: "new" | "remove", id}   make a save code (shown once) or forget one
//   POST /api/load {code}           load the player a save code belongs to on this device (log in)
//   POST /api/logout                this browser forgets its player (needs a save code or passkey first)
//   POST /api/passkey {action ...}  register_options / register / login_options / login / remove

import * as G from "../engine/scoundrel.js";
import { dailySeed, utcDay, dayNumber, msUntilNextDay } from "../engine/daily.js";
import { moveRecord, runRecord, chainInserts, head, ensureDeal, isUnique, verifyTip } from "./ledger.js";
import { hashCode, newSession, rateLimit } from "./saves.js";
import { giveName } from "./names.js";

const COOKIE = "sx";
const COOKIE_MAX_AGE = 400 * 86400;   // the longest browsers allow
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.\- ]{0,14}[A-Za-z0-9_.\-]$/;
const RESERVED = new Set(["admin", "webmaster", "scoundrel", "scoundrel.exe", "anonymous", "nobody", "system"]);

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    // one home: the old workers.dev address redirects to the real domain
    if (env.CANONICAL_HOST && url.hostname.endsWith(".workers.dev")) {
      return Response.redirect(`https://${env.CANONICAL_HOST}${url.pathname}${url.search}`, 301);
    }
    if (!url.pathname.startsWith("/api/")) return env.ASSETS ? env.ASSETS.fetch(req) : new Response("Not found", { status: 404 });
    try {
      if (!env.DAILY_SECRET) return json({ error: "The server has no DAILY_SECRET set." }, 500);
      const route = ROUTES[`${req.method} ${url.pathname}`];
      if (!route) return json({ error: "No such thing." }, 404);
      return await route(req, env, url);
    } catch (e) {
      if (e instanceof Oops) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "Something broke. Try again in a moment." }, 500);
    }
  },
};

class Oops extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const ROUTES = {
  "GET /api/today": today,
  "POST /api/start": start,
  "POST /api/move": move,
  "POST /api/name": setName,
  "POST /api/admin": adminSwitch,
  "GET /api/leaderboard": leaderboard,
  "GET /api/run": runPage,
  "GET /api/share": share,
  "GET /api/history": history,
  "GET /api/ledger": ledger,
  "POST /api/restart": restart,
  "GET /api/account": account,
  "POST /api/codes": codes,
  "POST /api/load": loadCode,
  "POST /api/logout": logout,
  "GET /api/carry": carryPage,
  "POST /api/pin": pinCopy,
  "POST /api/passkey": passkey,
};

// ---------- helpers ----------

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

const now = () => Math.floor(Date.now() / 1000);

// marks saved before v0.3 used an emoji fist; bare hands is ‼ now (one column, no emoji)
const fixMarks = (m) => (m == null ? m : String(m).replace(/[\u270A\u00D7]/g, "‼"));

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function newToken() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function readCookie(req) {
  const m = (req.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]{20,})`));
  return m ? m[1] : null;
}

const setCookie = (token) => `${COOKIE}=${token}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;

// The player behind this request's cookie, or null. Never creates one (so crawlers don't make players).
// A player with no name gets a random one here (src/names.js), so players from before random names get one too.
// A player's first device uses players.token_hash; devices it was loaded on later (save code or passkey)
// each have a row in sessions.
async function findPlayer(req, env) {
  const token = readCookie(req);
  if (!token) return null;
  const h = await sha256(token);
  let p = await env.DB.prepare("SELECT id, name, admin = 1 AS admin, admin > 0 AS can_admin FROM players WHERE token_hash = ?").bind(h).first();
  if (!p) {
    p = await env.DB.prepare(
      "SELECT p.id, p.name, p.admin = 1 AS admin, p.admin > 0 AS can_admin FROM sessions s JOIN players p ON p.id = s.player_id WHERE s.token_hash = ?").bind(h).first();
    if (p) await env.DB.prepare("UPDATE sessions SET seen_at = ? WHERE token_hash = ?").bind(now(), h).run();
  }
  if (p) await env.DB.prepare("UPDATE players SET seen_at = ? WHERE id = ?").bind(now(), p.id).run();
  return giveName(env, p);
}

// The player behind this request, made on the spot if there isn't one. Returns { player, cookie? }.
async function needPlayer(req, env) {
  const found = await findPlayer(req, env);
  if (found) return { player: found };
  const token = newToken();
  const t = now();
  const r = await env.DB.prepare("INSERT INTO players (token_hash, created_at, seen_at) VALUES (?, ?, ?) RETURNING id, name, admin")
    .bind(await sha256(token), t, t).first();
  return { player: await giveName(env, r), cookie: setCookie(token) };
}

async function body(req) {
  try { return await req.json(); } catch { throw new Oops("That request didn't make sense."); }
}

function checkDay(day) {
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day + "T00:00:00Z"))) {
    throw new Oops("Bad day.");
  }
  return day;
}

const yesterday = (day) => new Date(Date.parse(day + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);

// Rebuild a run's game from its day's seed and its moves.
async function gameOf(env, run) {
  return G.replay(await dailySeed(env.DAILY_SECRET, run.day), JSON.parse(run.actions));
}

function dayInfo(env, day = utcDay()) {
  const launch = env.LAUNCH_DAY || day;
  return { day, number: dayNumber(day, launch), nextIn: msUntilNextDay() };
}

// What the browser gets for a run: the public view (no deck order), plus the run's own bits.
function runView(run, game, events) {
  return {
    day: run.day,
    n: game.log.length,
    status: game.status,
    score: game.score,
    view: G.publicView(game),
    history: G.roomHistory(game.seed, game.log),   // what happened in each room so far (cards already seen)
    marks: game.status === "playing" ? null : (run.marks ? [...fixMarks(run.marks)] : null),
    ...(events ? { events } : {}),
  };
}

// ---------- routes ----------

async function today(req, env) {
  const info = dayInfo(env);
  const player = await findPlayer(req, env);
  const out = { ...info, name: player?.name ?? null, admin: !!player?.admin, run: null, unfinished: null };
  if (!player) return json(out);
  const run = await env.DB.prepare("SELECT * FROM runs WHERE player_id = ? AND day = ?").bind(player.id, info.day).first();
  if (run) out.run = runView(run, await gameOf(env, run));
  out.carry = !run || run.status === "playing" ? carryView(await carried(env, player.id)) : null;
  // a run started just before midnight can still be finished the next day
  const old = await env.DB.prepare("SELECT * FROM runs WHERE player_id = ? AND day = ? AND status = 'playing'")
    .bind(player.id, yesterday(info.day)).first();
  if (old) out.unfinished = runView(old, await gameOf(env, old));
  return json(out);
}

async function start(req, env) {
  const { player, cookie } = await needPlayer(req, env);
  const day = utcDay();
  await ensureDeal(env, day, await dailySeed(env.DAILY_SECRET, day));
  // a run id is never reused (an admin's thrown-away run may have been sealed before they were admin), so the next id
  // is one past the highest the runs table or the ledger has ever seen
  await env.DB.prepare(
    `INSERT OR IGNORE INTO runs (id, player_id, day, started_at)
     SELECT COALESCE(MAX(m), 0) + 1, ?, ?, ? FROM (SELECT MAX(id) AS m FROM runs UNION ALL SELECT MAX(run_id) FROM ledger)`)
    .bind(player.id, day, now()).run();
  const run = await env.DB.prepare("SELECT * FROM runs WHERE player_id = ? AND day = ?").bind(player.id, day).first();
  return json({ ...dayInfo(env, day), name: player.name, admin: !!player.admin, run: runView(run, await gameOf(env, run)) }, 200, cookie ? { "set-cookie": cookie } : {});
}

async function move(req, env) {
  const player = await findPlayer(req, env);
  if (!player) throw new Oops("Start a run first.", 401);
  const b = await body(req);
  const day = checkDay(b.day);
  const today = utcDay();
  if (day !== today && day !== yesterday(today)) throw new Oops("That run's day is over.");
  const run = await env.DB.prepare("SELECT * FROM runs WHERE player_id = ? AND day = ?").bind(player.id, day).first();
  if (!run) throw new Oops("No run for that day. Start one first.", 404);
  if (run.status !== "playing") throw new Oops("That run is already over.", 409);
  if (b.n !== run.moves) throw new Oops("Out of step. Reload to catch up.", 409);

  const a = b.action || {};
  const action = a.type === "skip" ? { type: "skip" }
    : a.type === "take" ? { type: "take", card: a.card, ...(a.bare ? { bare: true } : {}) }
    : null;
  if (!action) throw new Oops("Unknown move.");

  const seed = await dailySeed(env.DAILY_SECRET, day);
  const actions = JSON.parse(run.actions);
  const before = G.replay(seed, actions);
  let result;
  try { result = G.apply(before, action); }
  catch (e) { if (e instanceof G.IllegalMove) throw new Oops(e.message, 422); throw e; }
  const game = result.state;
  const done = game.status !== "playing";
  const marks = done ? G.shareMarks(seed, game.log).join("") : null;
  const t = now();

  // the move and its ledger entries are one transaction: the run only updates if nobody else moved
  // in the meantime (two tabs, double clicks), the entries only go in if the run now has this move,
  // and a double-sent move can't be sealed twice (unique run+n). If another entry took the chain
  // head first, the whole thing rolls back and we build on the new head and try again.
  await ensureDeal(env, day, seed);
  // admin runs don't count: they're never sealed on the ledger (and never on the leaderboard)
  const entries = player.admin ? [] : [{ kind: "move", day, playerId: player.id, runId: run.id, n: game.log.length, t,
    record: moveRecord({ day, playerId: player.id, runId: run.id, n: game.log.length, room: before.turn, action, before, after: game, events: result.events, t }) }];
  if (done && !player.admin) entries.push({ kind: "run", day, playerId: player.id, runId: run.id, t, record: runRecord({ day, playerId: player.id, runId: run.id, state: game, t }) });
  const update = env.DB.prepare(
    `UPDATE runs SET actions = ?, moves = ?, status = ?, score = ?, health = ?, marks = ?, finished_at = ?
     WHERE id = ? AND moves = ?`)
    .bind(JSON.stringify(game.log), game.log.length, game.status, game.score, game.health, marks, done ? t : null, run.id, run.moves);
  for (let attempt = 0; ; attempt++) {
    const inserts = await chainInserts(env.DB, await head(env.DB), entries,
      { sql: "EXISTS (SELECT 1 FROM runs WHERE id = ? AND moves = ?)", args: [run.id, game.log.length] });
    let res;
    try { res = await env.DB.batch([update, ...inserts]); }
    catch (e) {
      if (isUnique(e, "prev_hash") && attempt < 8) continue;   // the head moved: try again on top of it
      if (isUnique(e)) throw new Oops("Out of step. Reload to catch up.", 409);
      throw e;
    }
    if (!res[0].meta.changes) throw new Oops("Out of step. Reload to catch up.", 409);
    break;
  }
  if (done && !player.admin) await checkpoint(env, run.id);
  if (done && !player.admin && game.status === "won") await markCarry(env, player.id, "cleared_deck", "run:" + run.id);   // (v0.9) a cleared deck marks the carried copy

  return json(runView({ ...run, marks }, game, result.events));
}

// After every finished run, the ledger up to that run's end goes into the shared registry (dungeon-items, bound as
// REGISTRY) as a checkpoint: its entry count and that entry's fingerprint, which covers every entry before it. The
// registry is timestamped on Bitcoin, so this ledger is too. Only an entry that checks out is sent (verifyTip reads it and
// the one before it, so this costs the same however long the ledger is; entries are never deleted, so an entry's id is the
// count up to it). A registry that's away never stops the run: the next finished run's checkpoint covers this one.
async function checkpoint(env, runId) {
  try {
    const end = await env.DB.prepare("SELECT l.id, l.record, p.name FROM ledger l LEFT JOIN players p ON p.id = l.player_id WHERE l.kind = 'run' AND l.run_id = ?").bind(runId).first();
    if (!end) return;
    const rows = (await env.DB.prepare("SELECT id, record, prev_hash, hash FROM ledger WHERE id <= ? ORDER BY id DESC LIMIT 2").bind(end.id).all()).results.reverse();
    const v = await verifyTip(rows);
    if (!v.ok) return console.error("The ledger is broken at entry " + v.at + ": no checkpoint sent.");
    // the run's end, as sealed (already public on this game's ledger as soon as it's sealed), and the player's leaderboard
    // name if they picked one: sent beside the record, so the registry shows it but never seals it
    const run = JSON.parse(end.record);
    const detail = { day: dayNumber(run.day, env.LAUNCH_DAY), status: run.status, score: run.score, hp: run.hp, room: run.room, moves: run.moves, demons_left: run.demons_left };
    const r = await env.REGISTRY.checkpoint({ game: "scoundrel", entries: end.id, head: rows[rows.length - 1].hash, detail, name: end.name ?? null });
    if (r && r.error) console.error("The registry refused the checkpoint: " + r.error);
  } catch (e) { console.error(e); }
}

async function setName(req, env) {
  const { player, cookie } = await needPlayer(req, env);
  const b = await body(req);
  if (b.reroll) {
    const p = await giveName(env, player, { reroll: true });
    if (p.name === player.name) throw new Oops("Couldn't find a free name. Try again.");
    return json({ name: p.name }, 200, cookie ? { "set-cookie": cookie } : {});
  }
  const name = String(b.name || "").trim().replace(/\s+/g, " ");
  if (!NAME_RE.test(name)) throw new Oops("Names are 2 to 16 letters, numbers, spaces, - _ or .");
  const key = name.toLowerCase();
  if (RESERVED.has(key)) throw new Oops("That name is taken.");
  try {
    await env.DB.prepare("UPDATE players SET name = ?, name_key = ? WHERE id = ?").bind(name, key, player.id).run();
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) throw new Oops("That name is taken.", 409);
    throw e;
  }
  return json({ name }, 200, cookie ? { "set-cookie": cookie } : {});
}

async function leaderboard(req, env, url) {
  const t = utcDay();
  const day = checkDay(url.searchParams.get("day") || t);
  if (day > t) throw new Oops("That day hasn't happened yet.");
  const top = await env.DB.prepare(
    `SELECT p.name, r.score, r.status, r.marks, r.finished_at
     FROM runs r JOIN players p ON p.id = r.player_id
     WHERE r.day = ? AND r.status != 'playing' AND p.name IS NOT NULL AND p.admin != 1
     ORDER BY r.score DESC, r.finished_at ASC LIMIT 100`).bind(day).all();
  const counts = await env.DB.prepare(
    `SELECT COUNT(*) AS played, SUM(r.status = 'won') AS won, SUM(r.status = 'playing') AS playing
     FROM runs r JOIN players p ON p.id = r.player_id WHERE r.day = ? AND p.admin != 1`).bind(day).first();

  // your own place, named or not
  let you = null;
  const player = await findPlayer(req, env);
  if (player) {
    const mine = await env.DB.prepare("SELECT score, status, finished_at FROM runs WHERE player_id = ? AND day = ?").bind(player.id, day).first();
    if (mine && mine.status !== "playing") {
      const ahead = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM runs r JOIN players p ON p.id = r.player_id WHERE r.day = ? AND r.status != 'playing' AND p.admin != 1
         AND (r.score > ? OR (r.score = ? AND r.finished_at < ?))`).bind(day, mine.score, mine.score, mine.finished_at).first();
      you = { rank: ahead.n + 1, score: mine.score, status: mine.status, named: !!player.name, admin: !!player.admin };
    }
  }

  return json({
    ...dayInfo(env, day),
    played: counts.played || 0, won: counts.won || 0, playing: counts.playing || 0,
    top: top.results.map((r, i) => ({ rank: i + 1, name: r.name, score: r.score, status: r.status, marks: fixMarks(r.marks) })),
    you,
    // once a day is over its seed is public, so anyone can check the deck and the scores
    seed: day < t ? await dailySeed(env.DAILY_SECRET, day) : null,
  });
}

// One finished run's page, found by the fingerprint of its "run" ledger entry (the shared registry's checkpoint carries it as
// `head`). Only once the run's day is over: until then the other players' routes stay hidden, as on the ledger.
// The name is the leaderboard name; the record is shown as it was sealed (it holds the player's number, as it does on the ledger).
async function runPage(req, env, url) {
  const hash = String(url.searchParams.get("hash") || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Oops("No such run.", 404);
  const e = await env.DB.prepare("SELECT id, day, run_id, record, prev_hash, hash FROM ledger WHERE kind = 'run' AND hash = ?").bind(hash).first();
  if (!e) throw new Oops("No such run.", 404);
  if (e.day >= utcDay()) throw new Oops("This run's page opens when its day ends, at 00:00 UTC.", 404);
  const run = await env.DB.prepare("SELECT r.status, r.score, r.health, r.marks, r.started_at, r.finished_at, p.name FROM runs r JOIN players p ON p.id = r.player_id WHERE r.id = ?").bind(e.run_id).first();
  if (!run) throw new Oops("No such run.", 404);
  const rec = JSON.parse(e.record);
  const ahead = await env.DB.prepare(`SELECT COUNT(*) AS n FROM runs r JOIN players p ON p.id = r.player_id WHERE r.day = ?1 AND r.status != 'playing' AND p.admin != 1
    AND (r.score > ?2 OR (r.score = ?2 AND r.finished_at < ?3))`).bind(e.day, run.score, run.finished_at).first();
  const of = await env.DB.prepare("SELECT COUNT(*) AS n FROM runs r JOIN players p ON p.id = r.player_id WHERE r.day = ? AND r.status != 'playing' AND p.admin != 1").bind(e.day).first();
  const d = await env.DB.prepare("SELECT id, record FROM ledger WHERE kind = 'deal' AND day = ?").bind(e.day).first();
  return json({
    day: e.day, number: dayNumber(e.day, env.LAUNCH_DAY || e.day),
    name: run.name, status: run.status, score: run.score, hp: run.health, room: rec.room, moves: rec.moves, demons_left: rec.demons_left,
    marks: fixMarks(run.marks), rank: ahead.n + 1, of: of.n, startedAt: run.started_at, finishedAt: run.finished_at,
    seed: await dailySeed(env.DAILY_SECRET, e.day),   // public once the day is over, like the leaderboard's
    deal: d ? { entry: d.id, seed_hash: JSON.parse(d.record).seed_hash } : null,
    ledger: { entry: e.id, record: e.record, prev: e.prev_hash, hash: e.hash },
  });
}

async function share(req, env, url) {
  const player = await findPlayer(req, env);
  if (!player) throw new Oops("No runs yet.", 404);
  const day = checkDay(url.searchParams.get("day") || utcDay());
  const run = await env.DB.prepare("SELECT * FROM runs WHERE player_id = ? AND day = ?").bind(player.id, day).first();
  if (!run || run.status === "playing") throw new Oops("Finish the run first!", 404);
  const n = dayNumber(day, env.LAUNCH_DAY || day);
  const marks = [...(fixMarks(run.marks) || "")];
  const rows = [];
  for (let i = 0; i < marks.length; i += 7) rows.push(marks.slice(i, i + 7).join(""));
  const head = run.status === "won" ? `cleared ♥${run.health} · score ${run.score}` : `died · score ${run.score}`;
  const text = [`scoundrel.exe #${n}`, head, ...rows, new URL(req.url).origin].join("\n");
  return json({ day, number: n, text });
}

async function history(req, env) {
  const player = await findPlayer(req, env);
  if (!player) return json({ runs: [] });
  const r = await env.DB.prepare(
    "SELECT day, status, score, marks FROM runs WHERE player_id = ? ORDER BY day DESC LIMIT 30").bind(player.id).all();
  const launch = env.LAUNCH_DAY;
  return json({ runs: r.results.map((x) => ({ ...x, marks: fixMarks(x.marks), number: launch ? dayNumber(x.day, launch) : null })) });
}

// The ledger, newest first. Today's (and any not-yet-over day's) moves by other players are hidden:
// you see that they moved, not what they took. Your own moves, deals and finished runs show in full.
// Once a day is over, everything from it shows in full, and its seed is public on the leaderboard,
// so anyone can replay every run and check every hash.
async function ledger(req, env, url) {
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 15));
  const before = Number(url.searchParams.get("before")) || null;
  const player = await findPlayer(req, env);
  const t = utcDay();
  const rows = (await env.DB.prepare(
    `SELECT l.id, l.kind, l.day, l.player_id, l.n, l.record, l.prev_hash, l.hash, l.created_at, p.name
     FROM ledger l LEFT JOIN players p ON p.id = l.player_id
     ${before ? "WHERE l.id < ?" : ""} ORDER BY l.id DESC LIMIT ?`).bind(...(before ? [before, limit] : [limit])).all()).results;
  const total = (await env.DB.prepare("SELECT COUNT(*) AS n FROM ledger").first()).n;
  const entries = rows.map((r) => {
    const rec = JSON.parse(r.record);
    // deals, run ends and voids are open; admins see every move
    const open = r.kind !== "move" || r.day < t || (player && (r.player_id === player.id || player.admin));
    const base = { id: r.id, kind: r.kind, day: r.day, name: r.name ?? null, player: r.player_id, n: r.n, hash: r.hash, prev_hash: r.prev_hash, at: r.created_at };
    if (open) return { ...base, record: r.record };
    return { ...base, hidden: true, room: rec.room, action: rec.action === "skip" ? "skip" : "take" };
  });
  return json({ today: t, total, entries, more: rows.length === limit && rows[rows.length - 1].id > 1 });
}

// Admins only: throw today's run away and deal the same deck again. Admin runs don't count anywhere:
// not on the ledger, not on the leaderboard.
async function restart(req, env) {
  const player = await findPlayer(req, env);
  if (!player || !player.admin) throw new Oops("Only admins can do that.", 403);
  await env.DB.prepare("DELETE FROM runs WHERE player_id = ? AND day = ?").bind(player.id, utcDay()).run();
  return start(req, env);
}

// Admins only: admin mode on or off. players.admin is 1 (on), 2 (an admin with it off) or 0. Off, you play like
// anyone else. On is refused once you have a run today (or one from yesterday still going): that run counts.
// Off throws away your runs that never reached the ledger (admin runs, which never counted), so today starts fresh.
async function adminSwitch(req, env) {
  const player = await findPlayer(req, env);
  if (!player || !player.can_admin) throw new Oops("Only admins can do that.", 403);
  const on = !!(await body(req)).on, t = utcDay();
  if (on && !player.admin) {
    const run = await env.DB.prepare("SELECT 1 AS x FROM runs WHERE player_id = ? AND (day = ? OR (day = ? AND status = 'playing'))")
      .bind(player.id, t, yesterday(t)).first();
    if (run) throw new Oops("You've played today, and that run counts. Switch admin on tomorrow, before you play.");
  }
  if (!on && player.admin) {
    await env.DB.prepare("DELETE FROM runs WHERE player_id = ? AND id NOT IN (SELECT run_id FROM ledger WHERE run_id IS NOT NULL)").bind(player.id).run();
  }
  await env.DB.prepare("UPDATE players SET admin = ? WHERE id = ?").bind(on ? 1 : 2, player.id).run();
  return json({ admin: on });
}

// ---------- save codes and passkeys (kept by the shared Accounts service in dungeon-items) ----------
// This game keeps its own players and cookie. Save codes and passkeys belong to an account there; the account says
// which player here is yours (account_players). A player gets an account the first time they make a code or passkey.

const GAME = "scoundrel";
const ACC = (env) => { if (!env.ACCOUNTS) throw new Oops("Accounts are unavailable right now. Try again in a moment.", 503); return env.ACCOUNTS; };
const ipOf = (req) => req.headers.get("cf-connecting-ip") || "unknown";
const ok = (r) => { if (r && r.error) throw new Oops(r.error, r.status || 400); return r; };

// This player's account id (or null). Players from before accounts existed have save codes in this game's own table:
// the first time we see one, its codes move to the account and the table's rows are deleted.
async function accountFor(env, player, make = false) {
  const acc = ACC(env);
  let id = (await acc.accountOf(GAME, player.id)).accountId;
  const legacy = (await env.DB.prepare("SELECT code_hash FROM save_codes WHERE player_id = ?").bind(player.id).all()).results;
  if (!id && !make && !legacy.length) return null;
  if (!id) {
    id = (await acc.createAccount()).accountId;
    if (!ok(await acc.link(id, GAME, player.id)).linked) throw new Oops("That didn't work. Try again.");
  }
  for (const r of legacy) await acc.importCode(id, r.code_hash);
  if (legacy.length) await env.DB.prepare("DELETE FROM save_codes WHERE player_id = ?").bind(player.id).run();
  return id;
}

// Log this browser in as the account's player here: the one it already has, else this browser's own player (if it has
// no account yet), else a new one. Returns { player, cookie }.
async function enter(req, env, accountId) {
  const acc = ACC(env);
  let { playerId } = await acc.playerFor(accountId, GAME);
  if (!playerId) {
    const cur = await findPlayer(req, env);
    if (cur && !(await acc.accountOf(GAME, cur.id)).accountId) playerId = cur.id;
    else {
      if (!(await rateLimit(env, req, "new-player", 20, 3600))) throw new Oops("Too many new players from here. Try again later.", 429);
      const t = now();
      playerId = (await env.DB.prepare("INSERT INTO players (token_hash, created_at, seen_at) VALUES (?, ?, ?) RETURNING id").bind(await sha256(newToken()), t, t).first()).id;
    }
    playerId = ok(await acc.link(accountId, GAME, playerId)).playerId;
  }
  const p = await giveName(env, await env.DB.prepare("SELECT id, name FROM players WHERE id = ?").bind(playerId).first());
  if (!p) throw new Oops("That player is gone.", 404);
  return { player: p, cookie: setCookie(await newSession(env, p.id)) };
}

async function account(req, env) {
  const player = await findPlayer(req, env);
  if (!player) return json({ player: false, name: null, codes: [], passkeys: [], devices: 0 });
  const id = await accountFor(env, player);
  const ways = id ? ok(await ACC(env).info(id)) : { codes: [], passkeys: [] };
  const devices = 1 + (await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE player_id = ?").bind(player.id).first()).n;
  return json({ player: true, name: player.name, admin: !!player.admin, canAdmin: !!player.can_admin, codes: ways.codes, passkeys: ways.passkeys, devices });
}

async function codes(req, env) {
  const b = await body(req);
  if (b.action === "new") {
    const { player, cookie } = await needPlayer(req, env);
    const r = ok(await ACC(env).addCode(await accountFor(env, player, true)));
    return json({ code: r.code }, 200, cookie ? { "set-cookie": cookie } : {});
  }
  if (b.action === "remove") {
    const player = await findPlayer(req, env);
    if (!player) throw new Oops("No player here.", 401);
    const id = await accountFor(env, player);
    if (!id) throw new Oops("No such save code.", 404);
    ok(await ACC(env).removeCode(id, Number(b.id)));
    return json({ ok: true });
  }
  throw new Oops("Unknown action.");
}

// Type a save code: this device becomes that player (the player it was before stays where it is).
async function loadCode(req, env) {
  const code = (await body(req)).code;
  const r = await ACC(env).loginCode({ code, ip: ipOf(req) });
  let accountId = r.accountId;
  if (r.error) {
    if (r.status !== 404) ok(r);
    // a code from before accounts: this game's own table still has it until its player is next seen
    if (!(await rateLimit(env, req, "load", 10, 900))) throw new Oops("Too many tries. Wait 15 minutes and try again.", 429);
    const old = await env.DB.prepare("SELECT player_id FROM save_codes WHERE code_hash = ?").bind(await hashCode(code)).first();
    if (!old) ok(r);
    accountId = await accountFor(env, await env.DB.prepare("SELECT id, name, admin FROM players WHERE id = ?").bind(old.player_id).first(), true);
  }
  const { player, cookie } = await enter(req, env, accountId);
  return json({ name: player.name }, 200, { "set-cookie": cookie });
}

async function passkey(req, env) {
  const b = await body(req), acc = ACC(env), origin = new URL(req.url).origin;
  if (b.action === "login_options") return json(ok(await acc.passkeyLoginOptions({ origin, ip: ipOf(req) })));
  if (b.action === "login") {
    const r = ok(await acc.passkeyLogin({ origin, ip: ipOf(req), credential: b.credential }));
    const { player, cookie } = await enter(req, env, r.accountId);
    return json({ name: player.name }, 200, { "set-cookie": cookie });
  }
  if (b.action === "register_options" || b.action === "register") {
    const { player, cookie } = await needPlayer(req, env);
    const headers = cookie ? { "set-cookie": cookie } : {};
    const accountId = await accountFor(env, player, true);
    if (b.action === "register_options") return json(ok(await acc.passkeyRegisterOptions({ accountId, origin })), 200, headers);
    return json(ok(await acc.passkeyRegister({ accountId, origin, credential: b.credential, label: b.label })), 200, headers);
  }
  if (b.action === "remove") {
    const player = await findPlayer(req, env);
    if (!player) throw new Oops("No player here.", 401);
    const id = await accountFor(env, player);
    if (!id) throw new Oops("No such passkey.", 404);
    return json(ok(await acc.passkeyRemove(id, Number(b.id))));
  }
  throw new Oops("Unknown action.");
}

// Log out: this browser forgets its player. Only once the player has a save code or passkey, so nobody
// locks themselves out. A device loaded later just loses its session; the first device's token is
// replaced with one nobody has, so that old cookie stops working too.
async function logout(req, env) {
  const player = await findPlayer(req, env);
  const clear = `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
  if (!player) return json({ ok: true }, 200, { "set-cookie": clear });
  const id = await accountFor(env, player);
  const ways = id ? await ACC(env).waysIn(id) : 0;
  if (!ways) throw new Oops("Make a save code or passkey first, or you'd have no way back in.");
  const h = await sha256(readCookie(req));
  const s = await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(h).run();
  if (!s.meta.changes) await env.DB.prepare("UPDATE players SET token_hash = ? WHERE id = ? AND token_hash = ?").bind(await sha256(newToken()), player.id, h).run();
  return json({ ok: true }, 200, { "set-cookie": clear });
}

// ---------- the carried copy (copied from TILT.EXE v0.19) ----------
// Your account's pinned copy from any game (dungeon-items registry.js pinned: the pin, else your newest copy), read when
// a run starts so the page can show it, and read again when a memorable moment marks it (markCarried: a deed mark made
// in this game, keyed so a retry makes no second mark). A Moon-blessed copy (a 4Dungeon mark) shows in gold. A registry
// that's away, or no copy, carries nothing and never stops a run.
async function carried(env, playerId) {
  try {
    const c = env.REGISTRY && env.REGISTRY.pinned ? await env.REGISTRY.pinned(GAME, playerId) : null;
    return c && c.itemId ? { ...c, blessed: c.marks.some((m) => m.kind === "moon" && m.value === "blessed") ? 1 : 0 } : null;
  } catch (e) { console.error(e); return null; }
}
const carryView = (c) => c ? { name: c.item.name, copy: c.copy, blessed: c.blessed } : null;
async function markCarry(env, playerId, value, key) {
  const c = await carried(env, playerId);
  if (!c) return;
  try {
    const r = await env.REGISTRY.markCarried({ itemId: c.itemId, copy: c.copy, by: { game: GAME, playerId }, kind: "deed", value, key });
    if (r && r.error) console.error("The registry refused the mark: " + r.error);
  } catch (e) { console.error(e); }
}

// The carry window ([C]ARRY in PLAYER): the registry's own page of every copy your account holds in any game, in
// scoundrel.exe's frame (dungeon-items carry-window.js). Its buttons pin through POST /api/pin. (v0.9.2) It also holds the
// save codes and passkeys and logging in and out (the routes above), which PLAYER no longer shows.
//   GET  /api/carry               the window, as a page
//   POST /api/pin {itemId, copy}  pin it: every game carries it from your next run
async function carryPage(req, env) {
  const player = await findPlayer(req, env);
  if (!env.REGISTRY || !env.REGISTRY.carryWindow) throw new Oops("The registry is unavailable right now. Try again in a moment.", 503);
  const id = player ? await accountFor(env, player) : null;   // (v0.9.2) the window also shows save codes and passkeys
  const ways = { player: !!player, ...(id ? ok(await ACC(env).info(id)) : { codes: [], passkeys: [] }) };
  const html = await env.REGISTRY.carryWindow({ game: GAME, playerId: player ? player.id : 0, pinUrl: "/api/pin", back: "/", ways, embed: new URL(req.url).searchParams.get("embed") === "1",
    frame: { title: "SCOUNDREL.EXE   CARRY", paper: "#07090a", ink: "#e4e4df", edge: "#8f8f8a", accent: "#e3b341", font: '"VT323", ui-monospace, monospace' } });
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
async function pinCopy(req, env) {
  const player = await findPlayer(req, env);
  if (!player) throw new Oops("Make a save code or passkey first.", 401);
  const b = await body(req);
  const r = await env.REGISTRY.pin({ game: GAME, playerId: player.id, itemId: Number(b.itemId), copy: Number(b.copy) });
  if (r && r.error) throw new Oops(r.error);
  return json({ ok: true });
}
