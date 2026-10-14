// End-to-end tests of the Worker API, with Node's built-in SQLite standing in for D1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker from "../src/worker.js";
import * as G from "../engine/scoundrel.js";
import { dailySeed, utcDay } from "../engine/daily.js";
import { sha256, GENESIS } from "../src/ledger.js";

// a tiny D1 lookalike: prepare().bind().first()/all()/run(), and batch() as one transaction
export function fakeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  const prep = (sql, args = []) => ({
    sql, args,
    bind: (...a) => prep(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: r.changes } }; },
  });
  const batch = async (stmts) => {
    db.exec("BEGIN");
    try {
      const out = stmts.map((st) => ({ meta: { changes: db.prepare(st.sql).run(...st.args).changes } }));
      db.exec("COMMIT");
      return out;
    } catch (e) { db.exec("ROLLBACK"); throw e; }
  };
  return { prepare: (sql) => prep(sql), batch, raw: db };
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

// ---------- the ledger ----------

function chainOk(db) {
  const rows = db.prepare("SELECT * FROM ledger ORDER BY id").all();
  return rows;
}
async function verify(rows) {
  let prev = GENESIS;
  for (const r of rows) {
    assert.equal(r.prev_hash, prev, `entry ${r.id} builds on the wrong head`);
    assert.equal(r.hash, await sha256(prev + "|" + r.record), `entry ${r.id} hash`);
    prev = r.hash;
  }
}

test("ledger: deal, every move and the run end are sealed, and the chain checks out", async () => {
  const env = makeEnv();
  const a = browser(env), b = browser(env);
  await a("/api/name", { name: "KURA" });
  const ra = (await a("/api/start", {})).data.run;
  const rb = (await b("/api/start", {})).data.run;
  // interleave two players' moves
  let x = ra, y = rb;
  for (let i = 0; i < 3; i++) {
    x = (await a("/api/move", { day: x.day, n: x.n, action: x.view.legal.find((q) => q.type === "take") })).data;
    y = (await b("/api/move", { day: y.day, n: y.n, action: y.view.legal[0] })).data;
  }
  const end = await playThrough(a, x);
  const rows = chainOk(env.DB.raw);
  await verify(rows);
  assert.equal(rows.filter((r) => r.kind === "deal").length, 1);
  const deal = JSON.parse(rows[0].record);
  assert.equal(deal.seed_hash, await sha256(await dailySeed(SECRET, utcDay())));
  const mine = rows.filter((r) => r.kind === "move" && r.run_id === 1);
  assert.equal(mine.length, end.n);
  assert.deepEqual(mine.map((r) => r.n), [...Array(end.n)].map((_, i) => i + 1));
  const last = rows.filter((r) => r.kind === "run");
  assert.equal(last.length, 1);
  assert.equal(JSON.parse(last[0].record).score, end.score);

  // the sealed story matches a replay of the moves
  const seed = await dailySeed(SECRET, utcDay());
  let s = G.newGame(seed);
  for (const r of mine) {
    const rec = JSON.parse(r.record);
    const act = rec.action === "skip" ? { type: "skip" } : { type: "take", card: s.room.findIndex((c) => G.cardCode(c) === rec.card), ...(rec.action === "take_bare" ? { bare: true } : {}) };
    assert.equal(rec.hp[0], s.health);
    s = G.apply(s, act).state;
    assert.equal(rec.hp[1], s.health);
  }
  assert.equal(s.score, end.score);
});

test("ledger: double-sent moves are sealed once, the chain never forks", async () => {
  const env = makeEnv();
  const call = browser(env);
  const run = (await call("/api/start", {})).data.run;
  const act = run.view.legal.find((q) => q.type === "take");
  const res = await Promise.all([1, 2, 3].map(() => call("/api/move", { day: run.day, n: 0, action: act })));
  assert.equal(res.filter((r) => r.status === 200).length, 1);
  const rows = chainOk(env.DB.raw);
  assert.equal(rows.filter((r) => r.kind === "move").length, 1);
  await verify(rows);
});

test("ledger: today's moves by others are hidden, yours and run ends are open; past days open up", async () => {
  const env = makeEnv();
  const a = browser(env), b = browser(env);
  await a("/api/name", { name: "KURA" }); await b("/api/name", { name: "PIXIE" });
  const ra = (await a("/api/start", {})).data.run;
  await a("/api/move", { day: ra.day, n: 0, action: ra.view.legal.find((q) => q.type === "take") });
  const rb = (await b("/api/start", {})).data.run;
  await playThrough(b, rb);

  const seen = (await a("/api/ledger?limit=100")).data;
  const mine = seen.entries.filter((e) => e.name === "KURA" && e.kind === "move");
  const theirs = seen.entries.filter((e) => e.name === "PIXIE" && e.kind === "move");
  assert.ok(mine.length && mine.every((e) => e.record && !e.hidden));
  assert.ok(theirs.length && theirs.every((e) => e.hidden && !e.record));
  assert.ok(!JSON.stringify(theirs).includes('"card"'));
  assert.ok(seen.entries.find((e) => e.kind === "run" && e.name === "PIXIE").record);
  assert.ok(seen.entries.find((e) => e.kind === "deal").record);
  // someone with no cookie sees everyone's moves hidden
  const anon = (await browser(env)("/api/ledger?limit=100")).data;
  assert.ok(anon.entries.filter((e) => e.kind === "move").every((e) => e.hidden));
  // paging
  const p1 = (await a("/api/ledger?limit=3")).data;
  const p2 = (await a(`/api/ledger?limit=3&before=${p1.entries[2].id}`)).data;
  assert.ok(p2.entries[0].id < p1.entries[2].id);
  // the day ends: everything opens
  env.DB.raw.prepare("UPDATE ledger SET day = '2020-01-01'").run();
  const later = (await browser(env)("/api/ledger?limit=100")).data;
  assert.ok(later.entries.every((e) => e.record));
});

// ---------- save codes and passkeys ----------

test("save codes: load your player on another device; codes are hashed, limited and removable", async () => {
  const env = makeEnv();
  const home = browser(env);
  await home("/api/name", { name: "KURA" });
  const run = (await home("/api/start", {})).data.run;
  await home("/api/move", { day: run.day, n: 0, action: run.view.legal.find((q) => q.type === "take") });
  const { code } = (await home("/api/codes", { action: "new" })).data;
  assert.match(code, /^[2-9A-HJKMNP-Z]{4}(-[2-9A-HJKMNP-Z]{4}){4}$/);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM save_codes WHERE code_hash LIKE ?").get("%" + code + "%").n, 0);

  // a phone: wrong code, then the right one typed sloppily
  const phone = browser(env);
  assert.equal((await phone("/api/load", { code: "AAAA-BBBB-CCCC-DDDD-EEEE" })).status, 404);
  const loaded = await phone("/api/load", { code: code.toLowerCase().replace(/-/g, " ") });
  assert.equal(loaded.status, 200);
  assert.equal(loaded.data.name, "KURA");
  const t = (await phone("/api/today")).data;
  assert.equal(t.name, "KURA");
  assert.equal(t.run.n, 1);                 // the same run, mid-game
  const m = await phone("/api/move", { day: t.run.day, n: 1, action: t.run.view.legal.find((q) => q.type === "take") });
  assert.equal(m.status, 200);
  assert.equal((await home("/api/today")).data.run.n, 2);   // both devices see it

  // the admin flag follows the player
  env.DB.raw.prepare("UPDATE players SET admin = 1").run();
  assert.equal((await phone("/api/today")).data.admin, true);

  const acc = (await phone("/api/account")).data;
  assert.equal(acc.devices, 2);
  assert.equal(acc.codes.length, 1);
  assert.ok(!JSON.stringify(acc).includes(code));
  for (let i = 0; i < 4; i++) assert.equal((await home("/api/codes", { action: "new" })).status, 200);
  assert.equal((await home("/api/codes", { action: "new" })).status, 400);
  assert.equal((await phone("/api/codes", { action: "remove", id: acc.codes[0].id })).status, 200);
  assert.equal((await browser(env)("/api/load", { code })).status, 404);   // forgotten codes stop working
});

test("save codes: guessing is rate limited", async () => {
  const env = makeEnv();
  const guesser = browser(env);
  const res = [];
  for (let i = 0; i < 12; i++) res.push((await guesser("/api/load", { code: "ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZ" + (i % 9 + 1) })).status);
  assert.deepEqual(res.slice(0, 10), Array(10).fill(404));
  assert.equal(res[10], 429);
});

// a software passkey (ES256), standing in for a phone's fingerprint / face / PIN
const b64u = (b) => Buffer.from(b).toString("base64url");
function cborEnc(v) {
  const head = (major, n) => n < 24 ? [major << 5 | n] : n < 256 ? [major << 5 | 24, n] : [major << 5 | 25, n >> 8, n & 255];
  if (typeof v === "number") return Uint8Array.from(v >= 0 ? head(0, v) : head(1, -1 - v));
  if (typeof v === "string") { const b = new TextEncoder().encode(v); return Uint8Array.from([...head(3, b.length), ...b]); }
  if (v instanceof Uint8Array) return Uint8Array.from([...head(2, v.length), ...v]);
  if (v instanceof Map) { const parts = [...v].flatMap(([k, x]) => [...cborEnc(k), ...cborEnc(x)]); return Uint8Array.from([...head(5, v.size), ...parts]); }
  throw new Error("cbor?");
}
async function softPasskey() {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
  const credId = crypto.getRandomValues(new Uint8Array(16));
  const rpHash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("scoundrel.example")));
  let count = 0;
  const authData = (attested) => {
    const flags = 1 | 4 | (attested ? 64 : 0);
    const cnt = [0, 0, 0, count];
    if (!attested) return Uint8Array.from([...rpHash, flags, ...cnt]);
    const cose = cborEnc(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, "base64url")], [-3, Buffer.from(jwk.y, "base64url")]]));
    return Uint8Array.from([...rpHash, flags, ...cnt, ...new Uint8Array(16), 0, credId.length, ...credId, ...cose]);
  };
  const client = (type, challenge) => new TextEncoder().encode(JSON.stringify({ type, challenge, origin: "https://scoundrel.example" }));
  return {
    create(opts) {
      count++;
      const att = cborEnc(new Map([["fmt", "none"], ["attStmt", new Map()], ["authData", authData(true)]]));
      return { id: b64u(credId), response: { clientDataJSON: b64u(client("webauthn.create", opts.challenge)), attestationObject: b64u(att) } };
    },
    async get(opts) {
      count++;
      const ad = authData(false);
      const cd = client("webauthn.get", opts.challenge);
      const h = new Uint8Array(await crypto.subtle.digest("SHA-256", cd));
      const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, kp.privateKey, Uint8Array.from([...ad, ...h])));
      // WebAuthn sends ECDSA signatures DER-encoded
      const int = (x) => { let i = 0; while (i < 31 && x[i] === 0) i++; x = x.slice(i); return x[0] & 0x80 ? [0, ...x] : [...x]; };
      const r = int(raw.slice(0, 32)), s = int(raw.slice(32));
      const der = Uint8Array.from([0x30, r.length + s.length + 4, 2, r.length, ...r, 2, s.length, ...s]);
      return { id: b64u(credId), response: { clientDataJSON: b64u(cd), authenticatorData: b64u(ad), signature: b64u(der) } };
    },
  };
}

test("passkeys: add one on this device, load the player on another, stale or forged answers fail", async () => {
  const env = makeEnv();
  const home = browser(env);
  await home("/api/name", { name: "KURA" });
  await home("/api/start", {});
  const key = await softPasskey();
  const ro = (await home("/api/passkey", { action: "register_options" })).data;
  assert.equal(ro.rp.name, "scoundrel.exe");
  assert.equal(ro.user.name, "KURA");
  const reg = await home("/api/passkey", { action: "register", label: "test phone", credential: key.create(ro) });
  assert.equal(reg.status, 200, JSON.stringify(reg.data));
  assert.equal((await home("/api/account")).data.passkeys.length, 1);

  const laptop = browser(env);
  const lo = (await laptop("/api/passkey", { action: "login_options" })).data;
  const got = await laptop("/api/passkey", { action: "login", credential: await key.get(lo) });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.equal(got.data.name, "KURA");
  assert.equal((await laptop("/api/today")).data.name, "KURA");

  // the same answer can't be used twice (its challenge is used up)
  const lo2 = (await laptop("/api/passkey", { action: "login_options" })).data;
  const answer = await key.get(lo2);
  assert.equal((await browser(env)("/api/passkey", { action: "login", credential: answer })).status, 200);
  assert.equal((await browser(env)("/api/passkey", { action: "login", credential: answer })).status, 400);
  // a different key claiming the same credential id fails the signature
  const fake = await softPasskey();
  const lo3 = (await laptop("/api/passkey", { action: "login_options" })).data;
  const forged = await fake.get(lo3);
  forged.id = answer.id;
  assert.equal((await browser(env)("/api/passkey", { action: "login", credential: forged })).status, 400);
});

test("admins: unlimited fresh deals of today's deck; admin runs are never sealed and never ranked", async () => {
  const env = makeEnv();
  const call = browser(env), other = browser(env);
  await call("/api/name", { name: "KURA" }); await other("/api/name", { name: "PIXIE" });
  assert.equal((await call("/api/restart", {})).status, 403);   // not an admin yet
  env.DB.raw.prepare("UPDATE players SET admin = 1 WHERE name_key = 'kura'").run();
  assert.equal((await call("/api/today")).data.admin, true);
  const first = (await call("/api/start", {})).data.run;
  await playThrough(call, first);
  for (let i = 0; i < 3; i++) {
    const again = (await call("/api/restart", {})).data.run;
    assert.equal(again.n, 0);
    assert.deepEqual(again.view.room, first.view.room);   // same deck
    await call("/api/move", { day: again.day, n: 0, action: again.view.legal.find((q) => q.type === "take") });
  }
  assert.equal((await other("/api/restart", {})).status, 403);
  await playThrough(other, (await other("/api/start", {})).data.run);

  const rows = env.DB.raw.prepare("SELECT * FROM ledger ORDER BY id").all();
  await verify(rows);
  assert.equal(rows.filter((r) => r.player_id === 1).length, 0);   // nothing from the admin
  assert.ok(rows.filter((r) => r.player_id === 2).length > 0);
  const b = (await call("/api/leaderboard")).data;
  assert.deepEqual(b.top.map((r) => r.name), ["PIXIE"]);
  assert.equal(b.played, 1);
});

test("log out: needs a way back in first; then this browser is a guest and can log back in", async () => {
  const env = makeEnv();
  const home = browser(env);
  await home("/api/name", { name: "KURA" });
  assert.equal((await home("/api/logout", {})).status, 400);         // no save code or passkey yet
  assert.equal((await home("/api/today")).data.name, "KURA");
  const { code } = (await home("/api/codes", { action: "new" })).data;
  // a second device, then log out of the first (original) one
  const phone = browser(env);
  await phone("/api/load", { code });
  const out = await home("/api/logout", {});
  assert.equal(out.status, 200);
  assert.match(out.cookie, /Max-Age=0/);
  assert.equal((await home("/api/today")).data.name, null);         // guest now
  assert.equal((await phone("/api/today")).data.name, "KURA");      // the other device is still in
  // log out of the phone too, then back in on the first browser
  assert.equal((await phone("/api/logout", {})).status, 200);
  assert.equal((await phone("/api/today")).data.name, null);
  await home("/api/load", { code });
  assert.equal((await home("/api/today")).data.name, "KURA");
});

test("the old workers.dev address redirects to the real domain", async () => {
  const env = { ...makeEnv(), CANONICAL_HOST: "scoundrel.88x31.app" };
  const r = await worker.fetch(new Request("https://scoundrel-exe.someone.workers.dev/api/today?x=1"), env);
  assert.equal(r.status, 301);
  assert.equal(r.headers.get("location"), "https://scoundrel.88x31.app/api/today?x=1");
  const ok = await worker.fetch(new Request("https://scoundrel.88x31.app/api/today"), env);
  assert.equal(ok.status, 200);
});
