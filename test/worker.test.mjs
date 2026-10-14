// End-to-end tests of the Worker API, with Node's built-in SQLite standing in for D1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker from "../src/worker.js";
import * as G from "../engine/scoundrel.js";
import { dailySeed, utcDay } from "../engine/daily.js";

// a tiny D1 lookalike: prepare().bind().first()/all()/run()
function fakeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  const prep = (sql, args = []) => ({
    bind: (...a) => prep(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: r.changes } }; },
  });
  return { prepare: (sql) => prep(sql), raw: db };
}

const SECRET = "test-secret";
function makeEnv() { return { DB: fakeD1(), DAILY_SECRET: SECRET, LAUNCH_DAY: utcDay() }; }

// a browser: keeps its cookie
function browser(env) {
  let cookie = "";
  return async (path, body) => {
    const req = new Request("https://scoundrel.example" + path, {
      method: body ? "POST" : "GET",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const res = await worker.fetch(req, env);
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return { status: res.status, data: await res.json(), cookie: set };
  };
}

// play a whole run through the API with a simple bot (weapon when it can, potions, else bare)
async function playThrough(call, run) {
  let r = run;
  while (r.status === "playing") {
    const legal = r.view.legal;
    const pick = legal.find((a) => a.type === "take" && !a.bare && r.view.room[a.card].kind !== "monster")
      || legal.find((a) => a.type === "take" && !a.bare)
      || legal.find((a) => a.type === "take");
    const res = await call("/api/move", { day: r.day, n: r.n, action: pick });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    r = res.data;
  }
  return r;
}

test("today without a cookie: day info, no player made", async () => {
  const env = makeEnv();
  const call = browser(env);
  const r = await call("/api/today");
  assert.equal(r.status, 200);
  assert.equal(r.data.day, utcDay());
  assert.equal(r.data.number, 1);
  assert.equal(r.data.run, null);
  assert.equal(r.cookie, null);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM players").get().n, 0);
});

test("start gives a cookie, a room of 4, and never the deck", async () => {
  const env = makeEnv();
  const call = browser(env);
  const r = await call("/api/start", {});
  assert.equal(r.status, 200);
  assert.match(r.cookie, /^sx=.+HttpOnly; Secure; SameSite=Lax/);
  assert.equal(r.data.run.view.room.length, 4);
  assert.equal(r.data.run.view.deckCount, 40);
  assert.ok(!JSON.stringify(r.data).includes('"deck"'));
  assert.ok(!JSON.stringify(r.data).includes("seed"));
  // the stored token is hashed, not the cookie itself
  const token = r.cookie.split(";")[0].slice(3);
  assert.notEqual(env.DB.raw.prepare("SELECT token_hash FROM players").get().token_hash, token);
});

test("everyone gets the same deck today", async () => {
  const env = makeEnv();
  const a = await browser(env)("/api/start", {});
  const b = await browser(env)("/api/start", {});
  assert.deepEqual(a.data.run.view.room, b.data.run.view.room);
  const expected = G.newGame(await dailySeed(SECRET, utcDay())).room;
  assert.deepEqual(a.data.run.view.room, expected);
});

test("one ranked run a day: starting again returns the same run", async () => {
  const env = makeEnv();
  const call = browser(env);
  const first = (await call("/api/start", {})).data.run;
  const m = await call("/api/move", { day: first.day, n: 0, action: first.view.legal.find((a) => a.type === "take") });
  assert.equal(m.status, 200);
  const again = (await call("/api/start", {})).data.run;
  assert.equal(again.n, 1);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM runs").get().n, 1);
});

test("moves are checked: illegal moves, double-sends and other days are refused", async () => {
  const env = makeEnv();
  const call = browser(env);
  const run = (await call("/api/start", {})).data.run;
  let r = await call("/api/move", { day: run.day, n: 0, action: { type: "take", card: 9 } });
  assert.equal(r.status, 422);
  r = await call("/api/move", { day: run.day, n: 5, action: { type: "skip" } });
  assert.equal(r.status, 409);
  r = await call("/api/move", { day: "2020-01-01", n: 0, action: { type: "skip" } });
  assert.equal(r.status, 400);
  r = await call("/api/move", { day: run.day, n: 0, action: { type: "teleport" } });
  assert.equal(r.status, 400);
  // the same move sent twice: only the first counts
  const a = run.view.legal.find((x) => x.type === "take");
  const [one, two] = await Promise.all([
    call("/api/move", { day: run.day, n: 0, action: a }),
    call("/api/move", { day: run.day, n: 0, action: a }),
  ]);
  assert.deepEqual([one.status, two.status].sort(), [200, 409]);
  // no cookie, no moves
  r = await browser(env)("/api/move", { day: run.day, n: 0, action: a });
  assert.equal(r.status, 401);
});

test("a full run: score matches the engine, leaderboard, share card, history", async () => {
  const env = makeEnv();
  const call = browser(env);
  await call("/api/name", { name: "KURA" });
  const run = (await call("/api/start", {})).data.run;
  const end = await playThrough(call, run);
  assert.ok(end.status === "won" || end.status === "dead");
  assert.ok(end.marks.length > 0);

  // the server's score is what the engine says for those moves
  const row = env.DB.raw.prepare("SELECT * FROM runs").get();
  const check = G.replay(await dailySeed(SECRET, row.day), JSON.parse(row.actions));
  assert.equal(row.score, check.score);
  assert.equal(end.score, check.score);

  // finished runs take no more moves
  const more = await call("/api/move", { day: end.day, n: end.n, action: { type: "skip" } });
  assert.equal(more.status, 409);

  const board = (await call("/api/leaderboard")).data;
  assert.equal(board.top[0].name, "KURA");
  assert.equal(board.top[0].score, end.score);
  assert.equal(board.you.rank, 1);
  assert.equal(board.seed, null);   // today's seed stays secret

  const share = (await call(`/api/share?day=${end.day}`)).data;
  assert.match(share.text, /^scoundrel\.exe #1\n/);
  assert.ok(share.text.includes(String(end.score)));

  const hist = (await call("/api/history")).data;
  assert.equal(hist.runs.length, 1);
  assert.equal(hist.runs[0].number, 1);

  const t = (await call("/api/today")).data;
  assert.equal(t.run.status, end.status);
  assert.equal(t.name, "KURA");
});

test("leaderboard: unnamed players are counted but not listed; ties go to whoever finished first", async () => {
  const env = makeEnv();
  const named = browser(env);
  await named("/api/name", { name: "First" });
  await playThrough(named, (await named("/api/start", {})).data.run);
  const anon = browser(env);
  await playThrough(anon, (await anon("/api/start", {})).data.run);
  const second = browser(env);
  await second("/api/name", { name: "Second" });
  await playThrough(second, (await second("/api/start", {})).data.run);

  const b = (await anon("/api/leaderboard")).data;
  assert.equal(b.played, 3);
  assert.deepEqual(b.top.map((r) => r.name), ["First", "Second"]);   // same deck + same bot = same score
  assert.equal(b.you.named, false);
});

test("names: rules, reserved, unique ignoring case", async () => {
  const env = makeEnv();
  const a = browser(env), b = browser(env);
  assert.equal((await a("/api/name", { name: "x" })).status, 400);
  assert.equal((await a("/api/name", { name: "no<script>" })).status, 400);
  assert.equal((await a("/api/name", { name: "Admin" })).status, 400);
  assert.equal((await a("/api/name", { name: "  Pixie   Dust " })).data.name, "Pixie Dust");
  assert.equal((await b("/api/name", { name: "pixie dust" })).status, 409);
  assert.equal((await a("/api/name", { name: "Pixie" })).status, 200);   // renaming frees the old one
  assert.equal((await b("/api/name", { name: "PIXIE DUST" })).status, 200);
});

test("past days reveal their seed; future days are refused", async () => {
  const env = makeEnv();
  const call = browser(env);
  const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const r = (await call(`/api/leaderboard?day=${y}`)).data;
  assert.equal(r.seed, await dailySeed(SECRET, y));
  assert.equal((await call("/api/leaderboard?day=2999-01-01")).status, 400);
  assert.equal((await call("/api/leaderboard?day=bogus")).status, 400);
});

test("a run started yesterday can still be finished today", async () => {
  const env = makeEnv();
  const call = browser(env);
  await call("/api/start", {});
  const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  env.DB.raw.prepare("UPDATE runs SET day = ?").run(y);
  const t = (await call("/api/today")).data;
  assert.equal(t.run, null);
  assert.equal(t.unfinished.day, y);
  const end = await playThrough(call, t.unfinished);
  assert.notEqual(end.status, "playing");
  // and today's run is still there to start
  const fresh = (await call("/api/start", {})).data.run;
  assert.equal(fresh.day, utcDay());
  assert.equal(fresh.n, 0);
});

test("no secret: the API says so instead of dealing a guessable deck", async () => {
  const env = { ...makeEnv(), DAILY_SECRET: "" };
  const r = await browser(env)("/api/today");
  assert.equal(r.status, 500);
  assert.match(r.data.error, /DAILY_SECRET/);
});
