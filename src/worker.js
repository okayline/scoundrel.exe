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
//   GET  /api/share?day=            your share card text for a finished run
//   GET  /api/history               your last 30 runs
//   GET  /api/ledger?before=&limit=  the ledger, newest first; today's moves by other players are hidden
//   POST /api/restart               testers only: throw today's run away and deal it again

import * as G from "../engine/scoundrel.js";
import { dailySeed, utcDay, dayNumber, msUntilNextDay } from "../engine/daily.js";
import { moveRecord, runRecord, voidRecord, chainInserts, head, ensureDeal, isUnique } from "./ledger.js";

const COOKIE = "sx";
const COOKIE_MAX_AGE = 400 * 86400;   // the longest browsers allow
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.\- ]{0,14}[A-Za-z0-9_.\-]$/;
const RESERVED = new Set(["admin", "webmaster", "scoundrel", "scoundrel.exe", "anonymous", "nobody", "system"]);

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
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
  "GET /api/leaderboard": leaderboard,
  "GET /api/share": share,
  "GET /api/history": history,
  "GET /api/ledger": ledger,
  "POST /api/restart": restart,
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
async function findPlayer(req, env) {
  const token = readCookie(req);
  if (!token) return null;
  const p = await env.DB.prepare("SELECT id, name, tester FROM players WHERE token_hash = ?").bind(await sha256(token)).first();
  if (p) await env.DB.prepare("UPDATE players SET seen_at = ? WHERE id = ?").bind(now(), p.id).run();
  return p;
}

// The player behind this request, made on the spot if there isn't one. Returns { player, cookie? }.
async function needPlayer(req, env) {
  const found = await findPlayer(req, env);
  if (found) return { player: found };
  const token = newToken();
  const t = now();
  const r = await env.DB.prepare("INSERT INTO players (token_hash, created_at, seen_at) VALUES (?, ?, ?) RETURNING id, name, tester")
    .bind(await sha256(token), t, t).first();
  return { player: r, cookie: setCookie(token) };
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
    marks: game.status === "playing" ? null : (run.marks ? [...fixMarks(run.marks)] : null),
    ...(events ? { events } : {}),
  };
}

// ---------- routes ----------

async function today(req, env) {
  const info = dayInfo(env);
  const player = await findPlayer(req, env);
  const out = { ...info, name: player?.name ?? null, tester: !!player?.tester, run: null, unfinished: null };
  if (!player) return json(out);
  const run = await env.DB.prepare("SELECT * FROM runs WHERE player_id = ? AND day = ?").bind(player.id, info.day).first();
  if (run) out.run = runView(run, await gameOf(env, run));
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
  // a run id is never reused (a tester's thrown-away run keeps its id on the ledger), so the next id
  // is one past the highest the runs table or the ledger has ever seen
  await env.DB.prepare(
    `INSERT OR IGNORE INTO runs (id, player_id, day, started_at)
     SELECT COALESCE(MAX(m), 0) + 1, ?, ?, ? FROM (SELECT MAX(id) AS m FROM runs UNION ALL SELECT MAX(run_id) FROM ledger)`)
    .bind(player.id, day, now()).run();
  const run = await env.DB.prepare("SELECT * FROM runs WHERE player_id = ? AND day = ?").bind(player.id, day).first();
  return json({ ...dayInfo(env, day), name: player.name, tester: !!player.tester, run: runView(run, await gameOf(env, run)) }, 200, cookie ? { "set-cookie": cookie } : {});
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
  const entries = [{ kind: "move", day, playerId: player.id, runId: run.id, n: game.log.length, t,
    record: moveRecord({ day, playerId: player.id, runId: run.id, n: game.log.length, room: before.turn, action, before, after: game, events: result.events, t }) }];
  if (done) entries.push({ kind: "run", day, playerId: player.id, runId: run.id, t, record: runRecord({ day, playerId: player.id, runId: run.id, state: game, t }) });
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

  return json(runView({ ...run, marks }, game, result.events));
}

async function setName(req, env) {
  const { player, cookie } = await needPlayer(req, env);
  const name = String((await body(req)).name || "").trim().replace(/\s+/g, " ");
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
     WHERE r.day = ? AND r.status != 'playing' AND p.name IS NOT NULL AND p.tester = 0
     ORDER BY r.score DESC, r.finished_at ASC LIMIT 100`).bind(day).all();
  const counts = await env.DB.prepare(
    `SELECT COUNT(*) AS played, SUM(r.status = 'won') AS won, SUM(r.status = 'playing') AS playing
     FROM runs r JOIN players p ON p.id = r.player_id WHERE r.day = ? AND p.tester = 0`).bind(day).first();

  // your own place, named or not
  let you = null;
  const player = await findPlayer(req, env);
  if (player) {
    const mine = await env.DB.prepare("SELECT score, status, finished_at FROM runs WHERE player_id = ? AND day = ?").bind(player.id, day).first();
    if (mine && mine.status !== "playing") {
      const ahead = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM runs r JOIN players p ON p.id = r.player_id WHERE r.day = ? AND r.status != 'playing' AND p.tester = 0
         AND (r.score > ? OR (r.score = ? AND r.finished_at < ?))`).bind(day, mine.score, mine.score, mine.finished_at).first();
      you = { rank: ahead.n + 1, score: mine.score, status: mine.status, named: !!player.name, tester: !!player.tester };
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
    const open = r.kind !== "move" || r.day < t || (player && r.player_id === player.id);   // deals, run ends and voids are open
    const base = { id: r.id, kind: r.kind, day: r.day, name: r.name ?? null, player: r.player_id, n: r.n, hash: r.hash, prev_hash: r.prev_hash, at: r.created_at };
    if (open) return { ...base, record: r.record };
    return { ...base, hidden: true, room: rec.room, action: rec.action === "skip" ? "skip" : "take" };
  });
  return json({ today: t, total, entries, more: rows.length === limit && rows[rows.length - 1].id > 1 });
}

// Testers only: throw today's run away and deal the same deck again. The old run's moves stay on the
// ledger, and a "void" entry seals that it was thrown away. Testers are left off the leaderboard.
async function restart(req, env) {
  const player = await findPlayer(req, env);
  if (!player || !player.tester) throw new Oops("Only testers can do that.", 403);
  const day = utcDay();
  const old = await env.DB.prepare("SELECT * FROM runs WHERE player_id = ? AND day = ?").bind(player.id, day).first();
  if (old) {
    const t = now();
    const entry = { kind: "void", day, playerId: player.id, runId: old.id, t,
      record: voidRecord({ day, playerId: player.id, runId: old.id, moves: old.moves, status: old.status, t }) };
    const del = env.DB.prepare("DELETE FROM runs WHERE id = ? AND moves = ?").bind(old.id, old.moves);
    for (let attempt = 0; ; attempt++) {
      const ins = await chainInserts(env.DB, await head(env.DB), [entry],
        { sql: "NOT EXISTS (SELECT 1 FROM runs WHERE id = ?)", args: [old.id] });
      try { await env.DB.batch([del, ...ins]); break; }
      catch (e) { if (isUnique(e, "prev_hash") && attempt < 8) continue; throw e; }
    }
  }
  return start(req, env);
}
