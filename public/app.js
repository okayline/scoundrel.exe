// scoundrel.exe screen: an 80-column text screen in the Daily Digital Demon Dungeon style.
// Everything is drawn as lines of text in one <pre>. A line is a list of segments: plain strings,
// or { t, c (css class), k (a key: clicking it is the same as pressing it), input (a text box) }.
// Every character is one column. Symbols (⚔ ♥ ♠ ♣ ♦ ↷ ‼ █ ░) sit in a 1-column box (.g) so a font
// that draws them wide can never push the line out of place.

const W = 80, IN = W - 4;                     // screen width, and the width inside the frame
const VERSION = "v0.10.0";
const RANK = { 11: "J", 12: "Q", 13: "K", 14: "A" };
const SUIT = { C: "♣", S: "♠", D: "♦", H: "♥" };
const KIND = { monster: "DEMON", weapon: "BLADE", potion: "HEALTH" };
const SUIT_CLASS = { H: "s-heart", D: "s-diamond", S: "", C: "" };   // only the suit in the middle of a card is colored
const KIND_CLASS = { monster: "demon", weapon: "blade", potion: "ichor" };

const $screen = document.getElementById("screen");
let T = null;            // /api/today
let run = null;          // the run on screen
let board = null;        // leaderboard being shown
let boardDay = null;
let share = null;        // share text for boardDay (if you finished it)
let mode = "title";      // title | game | end | board | ledger | run | help | loading
let back = "title";      // where Esc goes from board/help
let bare = false;        // [B] pressed: the next demon is fought bare-handed
let between = false;
// free play: a random deck played only in this browser. Never sent anywhere, never ranked.
let G = null;            // the rules engine, loaded the first time free play starts
let freeRun = null;      // the free run in progress (or just finished)
let everPlayed = false;  // this player has finished a ranked run before (from /api/history)
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* fine */ } } };
const dailyDone = () => !!(T && T.run && T.run.status !== "playing");
// one free run to learn the rules before your first ranked run; after that, free play opens once today's run is done
const canFree = () => !!T && (dailyDone() || (!everPlayed && !T.run && !T.unfinished && !store.get("scoundrel.learned")));
const freeOpen = () => canFree() || !!(freeRun && freeRun.status === "playing");   // a free run you left can always be picked back up
let busy = false;
let deadline = 0;        // when the next deck deals (ms)
let log = ["", "", ""];  // two status lines, then one flavor line
let ledgerData = null;   // the ledger page on screen
let ledgerPages = [];    // the "before" of each newer page, for going back up
let ledgerBefore = null; // this page: entries before this id (null = the newest)
let hoverK = null;        // the card (1-4) the mouse is over: it gets a little v above it

// ---------- small helpers ----------

const pad2 = (n) => String(n).padStart(2, "0");
const rk = (r) => RANK[r] || String(r);
const nm = (c) => rk(c.rank) + SUIT[c.suit];
const len = (segs) => segs.reduce((n, s) => n + (typeof s === "string" ? s.length : s.t.length), 0);
const padTo = (segs, w) => { const n = len(segs); return n < w ? [...segs, " ".repeat(w - n)] : segs; };
const spread = (a, b, w = IN) => { const A = [].concat(a), B = [].concat(b); return [...A, " ".repeat(Math.max(1, w - len(A) - len(B))), ...B]; };
const center = (segs, w = IN) => { segs = [].concat(segs); const n = len(segs); return [" ".repeat(Math.max(0, Math.floor((w - n) / 2))), ...segs]; };
const dots = (label, value, w = 21) => label + " " + ".".repeat(Math.max(2, w - label.length)) + "  ";
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const esc = (t) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const S = (t, c, k) => ({ t, c, k });

function countdown() {
  const ms = Math.max(0, deadline - Date.now());
  const s = Math.floor(ms / 1000);
  return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor(s / 60) % 60)}:${pad2(s % 60)}`;
}
const deckNo = (n) => "#" + String(n).padStart(3, "0");
function nowStamp() {
  const d = new Date();
  const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "2-digit", year: "numeric", timeZone: "UTC" }).toUpperCase().replace(/,/g, "");
  return `${day} // ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC`;
}

// ---------- drawing ----------

// A full screen: "=" and "-" are rules, "~" is stretchy blank space (so every screen is H rows tall),
// anything else is a line inside the frame.
const H = 27;
function frame(rows) {
  const spacers = rows.filter((r) => r === "~").length;
  let extra = Math.max(0, H - (rows.length - spacers));
  rows = rows.flatMap((r, i) => {
    if (r !== "~") return [r];
    const n = Math.ceil(extra / (rows.slice(i).filter((x) => x === "~").length));
    extra -= n;
    return Array(n).fill("");
  });
  let top = true;
  return rows.map((r) => {
    if (r === "=" && top && T && T.admin) {   // admin players: a tag in the top border of every screen
      top = false;
      const tag = " ADMIN · DOESN'T COUNT ";
      const l = Math.floor((W - 2 - tag.length) / 2);
      return [S("+" + "=".repeat(l), "fr"), S(tag, "admintag"), S("=".repeat(W - 2 - l - tag.length) + "+", "fr")];
    }
    if (r === "=") { top = false; return ["+" + "=".repeat(W - 2) + "+"]; }
    if (r === "-") return ["+" + "-".repeat(W - 2) + "+"];
    const segs = [].concat(r);
    return [S("| ", "fr"), ...padTo(segs, IN), S(" |", "fr")];
  }).map((segs) => segs.map((s) => (typeof s === "string" && /^\+[=-]+\+$/.test(s) ? S(s, "fr") : s)));
}

const GLYPH = /[⚔‼♥♠♣♦↷█░·…]/g;
function html(lines) {
  return lines.map((segs) => segs.map((s) => {
    if (typeof s === "string") s = { t: s };
    let t = esc(s.t).replace(GLYPH, (g) => `<span class="g">${g}${g === "⚔" || g === "‼" ? "\uFE0E" : ""}</span>`);
    const isCard = /\b(card|clk)\b/.test(s.c || "");
    const cls = [s.c, s.k ? (isCard ? "clk" : "btn") : ""].filter(Boolean).join(" ");
    return cls || s.k ? `<span${cls ? ` class="${cls}"` : ""}${s.k ? ` data-k="${s.k}"` : ""}>${t}</span>` : t;
  }).join(""));   // one html string per line
}

let drawnMode = null;
let shown = [];   // the html of each line now on the screen
function draw() {
  const same = drawnMode === mode;
  drawnMode = mode;
  const lines = { title: titleScreen, game: gameScreen, end: endScreen, board: boardScreen, ledger: ledgerScreen, run: runScreen, help: helpScreen,
    loading: loadingScreen }[mode]();
  const rows = html(frame(lines));
  const spans = $screen.children;   // one <span class="ln"> per line
  if (same && spans.length === rows.length) {
    // same screen, same size: rewrite only the lines that changed (the countdown, the little v).
    // Everything else stays the very same element, so the pointer, a hover, a click or a
    // running animation is never pulled out from under you.
    rows.forEach((r, i) => { if (r !== shown[i]) spans[i].innerHTML = r; });
  } else {
    $screen.innerHTML = rows.map((r) => `<span class="ln">${r}</span>`).join("\n");
  }
  shown = rows;
}

// a card squeezes the moment you pick it (straight on the element: no redraw, so nothing cuts it short)
function squeeze(k) {
  $screen.querySelectorAll(`[data-k="${k}"]`).forEach((el) => {
    el.classList.add("pulse");
    setTimeout(() => el.classList.remove("pulse"), 260);
  });
}

function header(left) {
  // SCOUNDREL.EXE   //   SCREEN          NEXT DECK DEALT IN hh:mm:ss
  return spread(left.split(/\s{3,}/).join("  //  "), `NEXT DECK DEALT IN ${countdown()}`);
}

const logRow = (i) => [S("> ", "dim"), typeof log[i] === "string" ? S(log[i], i === 2 ? "flavor" : "") : log[i]];
function logRows() { return [0, 1, 2].map(logRow); }

function say(status, flavor) {
  for (const s of [].concat(status || [])) { log[0] = log[1]; log[1] = s; }
  if (flavor !== undefined) log[2] = flavor;
}
function oops(msg) { say(S(msg.toUpperCase(), "demon")); draw(); }

// commands bar: [[label, key, off?, on?], ...]
function bar(cmds) {
  const out = [];
  cmds.forEach(([label, key, off, on], i) => {
    if (i) out.push("   ");
    out.push(S(label, off ? "btn off" : on ? "btn armed" : "", off ? null : key));
  });
  return out;
}

// ---------- the card ----------

// a card as 5 rows of segments; k makes every part of it clickable
function cardRows(c, k) {
  const r = rk(c.rank);
  const P = (t) => S(t, "card", k);
  return [[P(".-------.")], [P("|" + r.padEnd(7) + "|")], [P("|   "), S(SUIT[c.suit], "card " + SUIT_CLASS[c.suit], k), P("   |")], [P("|" + r.padStart(7) + "|")], [P("'-------'")]];
}

// ---------- screens ----------

const LOGO = [
  " ___  ___  ___  _   _  _  _  ___  ___  ___  _      ___ __  __ ___",
  "/ __|/ __|/ _ \\| | | || \\| ||   \\| _ \\| __|| |    | __|\\ \\/ /| __|",
  "\\__ \\ (__| (_) | |_| || .` || |) |   /| _| | |__ _| _|  >  < | _|",
  "|___/\\___|\\___/ \\___/ |_|\\_||___/|_|_\\|___||____(_)___|/_/\\_\\|___|",
];

function titleScreen() {
  const r = T.run;
  const played = board && board.day === T.day ? board.played : null;
  const stat = (label, value) => ["                        ", S(dots(label), "dim"), value];
  let go = ["[P]LAY", "p"];
  if (r && r.status === "playing" || T.unfinished) go = ["[C]ONTINUE", "c"];
  if (r && r.status !== "playing" && !T.unfinished) go = ["[P] YOUR RUN", "p"];
  return ["=", header("SCOUNDREL.EXE"), "=", "~",
    ...LOGO.map((l) => center(S(l, "logo"))), "",
    stat("TODAY'S DECK", deckNo(T.number)),
    stat("DEALT TO", played == null ? "..." : `${played} RUNNER${played === 1 ? "" : "S"}`),
    stat("NEXT DEAL IN", countdown()),
    // (v0.9) the copy you carry in: your account's pinned copy (/api/today carry), gold if the Moon blessed it
    ...(T.carry ? [stat("CARRYING", S((T.carry.name + " #" + T.carry.copy).slice(0, 30), T.carry.blessed ? "blessed" : ""))] : []),
    "",
    center(r && r.status !== "playing" ? (r.status === "won" ? "YOU CLEARED TODAY'S DECK." : "TODAY'S DECK GOT YOU.") : "44 CARDS. 20 HP. ONE RUN."),
    "~", "-", ...logRows(), "-",
    bar([go, ...(freeOpen() ? [["[F]REE PLAY", "f"]] : []), ["[B]OARD", "b"], ["[?]", "?"]]),
    "="];
}

function gameScreen() {
  const v = run.view;
  const room = v.room;
  // left side: 47 wide
  const L = [];
  L.push(spread(`ROOM ${pad2(v.turn)}`, `DECK ${String(v.deckCount).padStart(2)}  (${v.deckMonsters} DEMONS)`, 47));
  L.push([], [], []);
  // the 4 slots on the table: a card keeps its slot (and its number) until it's taken
  const slots = v.slots || room.map((_, i) => i);
  const at = (k) => (between || slots[k] == null ? null : room[slots[k]]);
  const blank = "         ";
  // the little v over the card the mouse is on
  const pad = "  ";   // centers the 42-wide card row in the 47-wide left side
  const pickRow = [pad];
  if (between) pickRow.push(S("                NEXT ROOM...", "dim"));
  else for (let k = 0; k < 4; k++) { if (k) pickRow.push("  "); pickRow.push(at(k) && hoverK === String(k + 1) ? "    v    " : blank); }
  L.push(pickRow);
  const cards = [0, 1, 2, 3].map((k) => (at(k) ? cardRows(at(k), String(k + 1)) : null));
  for (let row = 0; row < 5; row++) {
    const segs = [pad];
    for (let k = 0; k < 4; k++) { if (k) segs.push("  "); if (cards[k]) segs.push(...cards[k][row]); else segs.push(blank); }
    L.push(segs);
  }
  // labels and what each card would do
  const lab = [pad], hint = [pad];
  for (let k = 0; k < 4; k++) {
    if (k) { lab.push("  "); hint.push("  "); }
    const c = at(k);
    lab.push(c ? S(`[${k + 1}]${KIND[c.kind]}`.padEnd(9), KIND_CLASS[c.kind], String(k + 1)) : blank);
    hint.push(c ? S(preview(v, c).padEnd(9), "dim clk", String(k + 1)) : blank);
  }
  L.push(lab, hint, [], [], []);
  // how far through the dungeon, and what's still in the deck
  // rooms: this one, plus one for every 3 cards still in the deck (a guess: skips add rooms)
  const rooms = v.turn + Math.ceil(v.deckCount / 3);
  const fill = Math.round((v.turn / rooms) * 18);
  L.push(["ROOMS    ", "█".repeat(fill), S("░".repeat(18 - fill), "dim"), `  room ${pad2(v.turn)} of ~${rooms}`]);
  // one mark per finished room, like the share card
  const marks = (run.history || []).filter((h) => h.done).map((h) => h.mark);
  if (marks.length) L.push([], ["HISTORY  ", S(marks.join(marks.length > 18 ? "" : " "), "marks")]);

  // right side: 26 wide
  const R = [];
  const hp = Math.max(0, v.health);
  R.push([`HP  ${String(v.health).padStart(2)}/20`]);
  R.push([]);
  R.push(["█".repeat(hp), S("░".repeat(20 - hp), "dim")]);
  R.push([]);
  if (v.weapon) {
    // a blade only hits demons lower than its last kill: say what that leaves
    const top = v.weaponCeiling;
    R.push(["BLADE  ", S(nm(v.weapon.card), "blade"), S(!top ? "  hits anything" : top <= 2 ? "  hits nothing" : `  hits up to ${rk(top - 1)}`, "dim")]);
    R.push(!top ? ["  CAN HIT  anything"] : top <= 2 ? ["  CAN HIT  ", S("nothing (dull)", "dim")] : [`  CAN HIT  2 to ${rk(top - 1)}`]);
    R.push(v.weapon.kills.length ? ["  SLAIN    ", S(v.weapon.kills.slice(-5).map(nm).join(" "), "demon")] : []);   // line 7 is always SLAIN
  } else {
    R.push(["BLADE  ", S("none", "dim")], [S("  BARE HANDS ONLY", "dim")], []);
  }
  R.push([]);
  R.push(["HEAL   ", v.potionUsedThisRoom ? S("used", "dim") : "ready"]);
  R.push(["SKIP   ", v.canSkip ? "ready" : S(skipWhy(v), "dim")]);
  R.push([], ["IN DECK  ", `${String(v.deckMonsters).padStart(2)} DEMON${v.deckMonsters === 1 ? "" : "S"}`],
    ["         ", `${String(v.deckWeapons).padStart(2)} BLADE${v.deckWeapons === 1 ? "" : "S"}`], ["         ", `${String(v.deckPotions).padStart(2)} HEALTH CARD${v.deckPotions === 1 ? "" : "S"}`]);
  // the last two things you did, in words (newest first, next to LAST)
  const said = (x) => x.type === "skip" ? "skipped the room" : x.type === "fight" ? (x.armed ? `⚔ slew ${nm(x.card)}` : `‼ fought ${nm(x.card)} bare`)
    : x.type === "heal" ? `♥ healed with ${nm(x.card)}` : x.type === "potion_wasted" ? `wasted ${nm(x.card)}` : `picked up ${nm(x.card)}`;
  const steps = (run.history || []).flatMap((h) => h.steps);   // one step per move, so its place is the move number
  const last = steps.map((x, i) => [i + 1, x]).slice(-2).reverse();
  if (last.length) R.push([], ...last.map(([n, x], i) => [i ? "     " : "LAST ", S(`#${pad2(n)} `, "dim"), said(x)]));

  const rows = [];
  for (let i = 0; i < 17; i++) rows.push([...padTo(L[i] || [], 47), S(" | ", "fr"), ...(R[i] || [])]);
  const n = room.length;
  return ["=", header(run.free ? "SCOUNDREL.EXE   FREE PLAY" : `SCOUNDREL.EXE   DECK ${deckNo(dayNo(run.day))}`), "=", ...rows, "-", ...logRows(), "-",
    bar([["[1-4] TAKE", null], ["[B]ARE HANDS", "b", !room.some((c) => c.kind === "monster"), bare], ["[S]KIP ROOM", "s", !v.canSkip], ["[TAB] BOARD", "tab"], ["[?]", "?"], ["[ESC]", "esc"],
      ...(T.admin ? [["[R]ESTART", "r"]] : [])]),
    "="];
}

function skipWhy(v) {
  if (v.skippedLastRoom) return "no (just skipped)";
  if (v.takenThisRoom) return "no (started)";
  if (!v.deckCount) return "no (last room)";
  return "no";
}

// what taking a card would do, in 9 columns: "⚔ -3", "‼ -12", "+5 HP", "WASTED", "EQUIP"
function preview(v, c) {
  if (c.kind === "weapon") return "EQUIP";
  if (c.kind === "potion") return v.potionUsedThisRoom ? "WASTED" : `+${Math.min(20, v.health + c.rank) - v.health} HP`;
  const armed = !bare && canHit(v, c);
  const dmg = armed ? Math.max(0, c.rank - v.weapon.card.rank) : c.rank;
  return `${armed ? "⚔" : "‼"} ${dmg ? "-" + dmg : "0"}`;
}
function canHit(v, c) {
  if (!v.weapon) return false;
  if (!v.weaponCeiling) return true;
  return c.rank < v.weaponCeiling;
}

function endScreen() {
  const v = run.view;
  const won = run.status === "won";
  const c = v.last;
  const card = c ? cardRows(c, null) : [[], [], [], [], []];
  const pre = "                      ";
  const you = board && board.day === run.day ? board.you : null;
  const marks = (run.marks || []).join(" ");
  const right = won
    ? [S("DUNGEON CLEARED", "gold"), "", `ROOM ${pad2(v.turn)}  ·  HP ${v.health}/20`, run.score > v.health ? `+${run.score - v.health} HEALTH BONUS` : ""]
    : [S("YOU WERE DELETED", "demon"), "", `ROOM ${pad2(v.turn)}  ·  HP ${v.health}`, `${v.deckMonsters + v.room.filter((x) => x.kind === "monster").length} DEMONS STILL IN THE DECK`];
  const stat = (label, value) => ["                        ", S(dots(label), "dim"), value];
  return ["=", header(run.free ? "SCOUNDREL.EXE   FREE PLAY" : `SCOUNDREL.EXE   DECK ${deckNo(dayNo(run.day))}`), "=", "~",
    [pre, ...padTo(card[0], 9)],
    [pre, ...padTo(card[1], 9), "      ", right[0]],
    [pre, ...padTo(card[2], 9)],
    [pre, ...padTo(card[3], 9), "      ", right[2]],
    [pre, ...padTo(card[4], 9), "      ", right[3]],
    "",
    stat("SCORE", S(String(run.score), won ? "gold" : "demon")),
    run.free ? stat("BEST FREE", store.get("scoundrel.bestFree") || String(run.score)) :
    stat("RANK", T.admin ? "ADMIN RUN (doesn't count)" : you ? `#${you.rank} of ${board.played}` : "..."),
    "",
    ["                        ", S(marks, "marks")],
    "~", "-", ...logRows(), "-",
    run.free ? bar([...(canFree() ? [["[F]REE PLAY AGAIN", "f"]] : []), ["[ESC] TITLE", "esc"]])
      : bar([["[S]HARE", "s"], ["[B]OARD", "b"], ["[ESC] TITLE", "esc"], ...(T.admin ? [["[R]ESTART", "r"]] : [])]),
    "="];
}

function boardScreen() {
  const b = board;
  const rows = [];
  const top = b ? b.top : [];
  const shown = top.slice(0, 12);
  const L = [S("  RANK  NAME              SCORE   STATUS", "dim"), S("  ----  ----------------  -----   -------", "dim")];
  for (const r of shown) {
    const me = T.name && r.name === T.name;
    L.push(S(`  ${String(r.rank).padStart(4)}  ${r.name.padEnd(16)}  ${String(r.score).padStart(5)}   ${r.status === "won" ? "CLEARED" : "DELETED"}`, me ? "you" : r.status === "won" ? "" : "dimmer"));
  }
  if (!shown.length) L.push(S(b ? "  Nobody has finished this deck yet." : "  Loading...", "dim"));
  if (b && b.you && !(T.name && shown.some((r) => r.name === T.name))) {
    L.push(S("        ...", "dim"));
    L.push(S(`  ${String(b.you.rank).padStart(4)}  ${(T.name || "YOU (no name)").padEnd(16)}  ${String(b.you.score).padStart(5)}   ${b.you.status === "won" ? "CLEARED" : "DELETED"}`, "you"));
  }
  const R = [S("SHARE CARD", "dim"), ""];
  if (share) share.text.split("\n").slice(0, 5).forEach((l) => R.push(l.length > 26 ? l.slice(0, 25) + "…" : l));
  else R.push(S(b && b.day === T.day ? "Finish today's run" : "You didn't run this", "dim"), S(b && b.day === T.day ? "to get one." : "deck.", "dim"));
  for (let i = 0; i < 17; i++) rows.push([...padTo([].concat(L[i] || []), 46), S(" | ", "fr"), ...[].concat(R[i] || [])]);
  const first = boardDay <= (T.launch || T.day);
  const last = boardDay >= T.day;
  const info = b ? `${b.played} RAN  ·  ${b.won} CLEARED` : "";
  return ["=", spread(`SCOUNDREL.EXE   LEADERBOARD   DECK ${deckNo(dayNo(boardDay))}`, info), "=", ...rows, "-", ...logRows(), "-",
    bar([["[<]", "left", first], ["[>] DAY", "right", last], ["[S]HARE", "s", !share], ["[L]EDGER", "l"], ["[ESC] BACK", "esc"]]),
    "="];
}

// ---------- the ledger ----------

const card = (code) => { const r = { T: "10", J: "J", Q: "Q", K: "K", A: "A" }[code[0]] || code[0]; return r + SUIT[code.slice(-1)]; };
const fit = (t, w) => (t.length > w ? t.slice(0, w - 1) + "…" : t);

// one ledger entry as words: what happened, from its sealed record
function ledgerText(e) {
  if (e.kind === "deal") { const r = JSON.parse(e.record); return `deck ${deckNo(dayNo(e.day))} dealt · seed hash ${r.seed_hash.slice(0, 6)}…${r.seed_hash.slice(-4)}`; }
  if (e.kind === "run") {
    const r = JSON.parse(e.record);
    return r.status === "won" ? `CLEARED · HP ${r.hp} · score ${r.score}` : `DELETED in room ${pad2(r.room)} · score ${r.score}`;
  }
  const at = `R${pad2(e.hidden ? e.room : JSON.parse(e.record).room)}.${pad2(e.n)} `;
  if (e.hidden) return at + (e.action === "skip" ? "skipped a room" : "took a card");
  const r = JSON.parse(e.record);
  const parts = [];
  for (const ev of r.events) {
    if (ev[0] === "skip") parts.push(`skipped ${ev[1].map(card).join(" ")}`);
    if (ev[0] === "equip") parts.push(`equipped ${card(ev[1])}${ev[2].length ? `, dropped ${card(ev[2][0])}` : ""}`);
    if (ev[0] === "heal") parts.push(`drank ${card(ev[1])}`);
    if (ev[0] === "wasted") parts.push(`${card(ev[1])} wasted`);
    if (ev[0] === "fight") parts.push(ev[2] ? `took ${card(ev[1])} with ${card(ev[2])} · ${ev[3]} dmg` : `bare hands vs ${card(ev[1])} · ${ev[3]} dmg`);
  }
  if (r.hp[0] !== r.hp[1]) parts.push(`HP ${r.hp[0]}->${r.hp[1]}`);
  return at + parts.join(" · ");
}

function ledgerScreen() {
  const L = ledgerData;
  const rows = [S("     #  HASH  DECK  WHO         WHAT", "dim"), S("  ----  ----  ----  ----------  " + "-".repeat(44), "dim")];
  if (!L) rows.push(S("  Loading...", "dim"));
  else if (!L.entries.length) rows.push(S("  Nothing sealed yet.", "dim"));
  else for (const e of L.entries) {
    const who = e.kind === "deal" ? "-" : (e.name || `runner ${e.player}`);
    const head = `${("#" + e.id).padStart(6)}  ${e.hash.slice(0, 4)}  ${deckNo(dayNo(e.day))}  ${fit(who, 10).padEnd(10)}  `;
    const text = fit(ledgerText(e), IN - head.length);
    const mine = T.name && e.name === T.name;
    rows.push([S(head, "dim"), S(text, e.hidden ? "dim" : mine ? "you" : "")]);
  }
  const body = []; for (let i = 0; i < 17; i++) body.push(rows[i] || "");
  return ["=", spread("SCOUNDREL.EXE   LEDGER", L ? `${L.total} ENTRIES SEALED` : ""), "=", ...body, "-", ...logRows(), "-",
    bar([["[<] NEWER", "left", !ledgerPages.length], ["[>] OLDER", "right", !(L && L.more)], ["[B]OARD", "b"], ["[ESC] BACK", "esc"]]),
    "="];
}

async function loadLedger(before) {
  ledgerBefore = before; ledgerData = null; draw();
  try { ledgerData = await api(`/api/ledger?limit=15${before ? `&before=${before}` : ""}`); }
  catch (e) { say(S(e.message.toUpperCase(), "demon")); }
  draw();
}
function openLedger() {
  go("ledger"); ledgerPages = [];
  say("Every deal, move and run end, sealed in one hash chain.", "Today's moves by others stay hidden until 00:00 UTC.");
  return loadLedger(null);
}

// ---------- one finished run's page ----------
// Opened with ?run=FINGERPRINT (the shared registry links a run's entry here): the run's results, route, the deck's seed, and its ledger entry.
let runPage = null, runErr = "";
const utcStamp = (s) => new Date(s * 1000).toLocaleDateString("en-US", { month: "short", day: "2-digit", timeZone: "UTC" }).toUpperCase() + " " + new Date(s * 1000).toISOString().slice(11, 16) + " UTC";
const chunks = (t, w) => { const out = []; for (let i = 0; i < t.length; i += w) out.push(t.slice(i, i + w)); return out; };
function runScreen() {
  const r = runPage, row = (k, v, c) => [S(dots(k, null, 16), "dim"), S(String(v), c || "")];
  const body = [];
  if (runErr) body.push(S("  " + runErr, "dim"));
  else if (!r) body.push(S("  Loading...", "dim"));
  else {
    const won = r.status === "won";
    const marks = r.marks ? [...r.marks] : [];   // the route, spaced like the end screen's, 20 to a row
    body.push(row("RESULT", won ? "CLEARED" : "DELETED", won ? "gold" : "demon"), row("SCORE", r.score), row("RANK", r.of ? `${r.rank} OF ${r.of}` : "-"),
      row("HP LEFT", r.hp), row("ROOM", pad2(r.room)), row("MOVES", r.moves), row("DEMONS LEFT", r.demons_left),
      row("RAN", `${utcStamp(r.startedAt)} - ${r.finishedAt ? utcStamp(r.finishedAt) : "?"}`),
      row("ROUTE", marks.slice(0, 20).join(" ") || "-", "marks"));
    for (let i = 20; i < marks.length; i += 20) body.push([" ".repeat(20), S(marks.slice(i, i + 20).join(" "), "marks")]);
    body.push(row("SEED", r.seed), row("ENTRIES", `deck #${r.deal ? r.deal.entry : "?"}  run #${r.ledger.entry}`));
    for (const [k, v] of [["RECORD", r.ledger.record], ["PREV", r.ledger.prev], ["HASH", r.ledger.hash]]) {
      const [first, ...more] = chunks(k + ": " + v, IN);
      body.push([S(k + ": ", "dim"), first.slice(k.length + 2)], ...more);
    }
  }
  const rows = []; for (let i = 0; i < 17; i++) rows.push(body[i] || "");
  const name = r ? r.name || "A RUNNER" : "";
  return ["=", spread(`SCOUNDREL.EXE   RUN   DECK ${r ? deckNo(r.number) : ""}`, name), "=", ...rows, "-", ...logRows(), "-",
    bar([["[B]OARD", "b", !r], ["[L]EDGER", "l"], ["[R]EGISTRY", "r", !r], ["[ESC] BACK", "esc"]]), "="];
}
async function openRun(hash) {
  mode = "run"; runPage = null; runErr = ""; log = ["", "", ""]; say(["A finished run, from its sealed ledger entry.", "Everything here is public once the day is over."], ""); draw();
  try { runPage = await api("/api/run?hash=" + hash); } catch (e) { runErr = e.message; }
  draw();
}

function helpScreen() {
  const D = (t) => S(t, "demon"), B = (t) => S(t, "blade"), I = (t) => S(t, "ichor");
  return ["=", spread("SCOUNDREL.EXE   HOW TO PLAY", "SCOUNDREL BY ZACH GAGE & KURT BIEG"), "=",
    "Everyone gets the same 44-card deck today. You get one run. Start at 20 HP.",
    "",
    [D("♠♣ DEMONS"), "  hurt you for their value (2-10, J 11, Q 12, K 13, A 14)."],
    [B("♦  BLADES"), "  equip one. A demon then hurts you for its value minus the blade."],
    ["            After a kill, a blade only hits demons LOWER than its last kill."],
    ["            [B]ARE HANDS: take the full hit and keep the blade fresh."],
    [I("♥  HEALTH"), "  heals its value, up to 20. Only one per room works."],
    "",
    "Each ROOM is 4 cards. Take 3. The 4th stays and 3 new ones join it.",
    "You may [S]KIP a room before taking anything. Not two rooms in a row.",
    "",
    ["CLEAR THE DECK: score = HP left (+ the last health if you end at 20 HP)."],
    ["DIE: score = minus every demon you didn't get to."],
    "",
    ["Route marks:  ", S("⚔", "blade"), " blade   ", S("‼", "demon"), " bare hands   ", S("↷", "dim"), " skip   ", S("♥", "ichor"), " health"],
    "~", "-", bar([["[ESC] BACK", "esc"]]), "="];
}


function loadingScreen() {
  return ["=", "SCOUNDREL.EXE", "=", "~", center("DIALING IN..."), "~", "="];
}

// ---------- talking to the server ----------

async function api(path, body) {
  const r = await fetch(path, { method: body ? "POST" : "GET", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  let d = {};
  try { d = await r.json(); } catch { /* not json */ }
  if (!r.ok) { const e = new Error(d.error || `Error ${r.status}`); e.status = r.status; throw e; }
  return d;
}

const dayNo = (day) => {
  const launch = T.launch || T.day;
  return Math.round((Date.parse(day + "T00:00:00Z") - Date.parse(launch + "T00:00:00Z")) / 86400000) + 1;
};
const shiftDay = (day, n) => new Date(Date.parse(day + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

async function loadToday() {
  T = await api("/api/today");
  T.launch = shiftDay(T.day, 1 - T.number);
  deadline = Date.now() + T.nextIn;
  run = T.unfinished || T.run;
}

async function loadBoard(day) {
  boardDay = day;
  board = null; share = null;
  draw();
  try {
    board = await api(`/api/leaderboard?day=${day}`);
    if (board.you) share = await api(`/api/share?day=${day}`).catch(() => null);
  } catch (e) { say(S(e.message.toUpperCase(), "demon")); }
  draw();
}

// ---------- flavor ----------

const FLAVOR = {
  armed: ["The blade bites.", "Clean through.", "It folds around the edge.", "Steel, then silence.", "Black blood on chrome.", "It goes down hissing.", "The edge finds the seam.", "Sparks, then nothing."],
  scratch: ["It never got close.", "Not even a scratch.", "The blade does all the work.", "Over before it started.", "It dies mid-glitch.", "You barely felt the swing."],
  bare: ["Knuckles meet teeth.", "That one will bruise.", "You took that one personally.", "Your hands will remember this.", "Bone on circuitry.", "Your knuckles split. Theirs too.", "It bites. You bite back.", "No edge. Just fists and static."],
  heal: ["It burns going down.", "Warmth spreads.", "The static in your head clears.", "The red fades from your vision.", "Something stitches you back together.", "Cold relief in a dead room."],
  wasted: ["Too much at once. It spills.", "Your body won't take more right now.", "It runs out of you. Nothing left to fix.", "The dose fizzles. Already full."],
  equip: ["It hums in your hand.", "A fresh edge.", "Light catches the blade.", "The grip is still warm.", "Someone died holding this.", "Cold steel, fresh firmware."],
  skip: ["You back out quietly.", "Not this one.", "The door closes on them.", "Not today.", "You slip past in the static.", "They'll still be here later."],
  deal: ["The room shifts. New cards slide in.", "Something moves in the dark.", "Fresh data loads in.", "The walls redraw themselves.", "Another room renders in.", "Something was waiting here.", "The lights flicker on."],
  start: ["The deck is shuffled. Everyone gets the same one.", "Jacking in.", "The dungeon wakes up.", "The dungeon boots up.", "Signal found.", "Forty-four cards. One way out."],
  won: ["The last card falls. Quiet.", "You walk out the other side.", "The feed cuts to white.", "Nothing left breathing in the deck.", "Logged out alive."],
  dead: ["Signal lost.", "The screen goes dark.", "Should have kept the blade fresh.", "Connection terminated.", "Your vitals flatline.", "The dungeon keeps your data."],
};

function tell(events) {
  for (const e of events) {
    if (e.type === "equip") say(`Equipped ${nm(e.card)}.${e.dropped.length ? " The old blade is gone." : ""}`, pick(FLAVOR.equip));
    if (e.type === "heal") say(`Health ${nm(e.card)}. +${e.amount} HP.`, pick(FLAVOR.heal));
    if (e.type === "potion_wasted") say(`${nm(e.card)} wasted. Only one heals per room.`, pick(FLAVOR.wasted));
    if (e.type === "fight" && e.armed) say(e.damage ? `${nm(e.card)} falls to the blade. ${e.damage} damage gets through.` : `${nm(e.card)} falls to the blade. No damage.`, pick(e.damage ? FLAVOR.armed : FLAVOR.scratch));
    if (e.type === "fight" && !e.armed) say(`Bare hands vs ${nm(e.card)}. ${e.damage} damage.`, pick(FLAVOR.bare));
    if (e.type === "skip") say("Room skipped. Those 4 sink to the bottom of the deck.", pick(FLAVOR.skip));
    if (e.type === "deal") say(`Room ${pad2(e.turn)}.`, pick(FLAVOR.deal));
    if (e.type === "won") say(S(`DECK CLEARED. SCORE ${e.score}.`, "gold"), pick(FLAVOR.won));
    if (e.type === "dead") say(S(`DELETED. SCORE ${e.score}.`, "demon"), pick(FLAVOR.dead));
  }
}

// ---------- actions ----------

async function jackIn() {
  if (busy) return;
  if (run && run.status === "playing") { mode = "game"; say(`Room ${pad2(run.view.turn)}. Picking up where you left off.`, pick(FLAVOR.deal)); draw(); return; }
  if (run) { await showEnd(); return; }
  return startRun();
}

async function startRun() {
  if (busy) return;
  busy = true;
  try {
    const d = await api("/api/start", {});
    run = d.run; T.run = d.run;
    mode = "game";
    say(["Deck " + deckNo(T.number) + " dealt.", `Room 01. ${run.view.deckCount} cards wait behind it.`], pick(FLAVOR.start));
  } catch (e) { say(S(e.message.toUpperCase(), "demon")); }
  busy = false;
  draw();
}

// k = the slot on the table (0-3), not the card's place in the room list
let queued = null;   // one card click made while a move was still going: { slot, turn }
async function take(k) {
  if (mode !== "game") return;
  // a click that lands mid-move is held, not dropped, and played when the move finishes
  // (only if the room is the same one: a card's slot means something else in the next room)
  if (busy) { queued = run && run.view ? { slot: k, turn: run.view.turn } : null; return; }
  queued = null;
  const v = run.view;
  const i = v.slots ? v.slots[k] : k;
  const c = i == null ? null : v.room[i];
  if (!c) return;
  const action = { type: "take", card: i };
  if (c.kind === "monster" && (bare || !canHit(run.view, c))) action.bare = true;
  await act(action);
}

async function act(action) {
  busy = true;
  try {
    const r = run.free ? freeMove(action) : await api("/api/move", { day: run.day, n: run.n, action });
    const newRoom = r.status === "playing" && run.view && r.view.turn !== run.view.turn;
    if (newRoom) { between = true; draw(); await new Promise((ok) => setTimeout(ok, 900)); between = false; }
    run = r;
    if (r.free) freeRun = r;
    else if (run.day === T.day) T.run = r; else if (r.status !== "playing") T.unfinished = null;
    bare = false;
    tell(r.events || []);
    if (r.status !== "playing") { queued = null; busy = false; draw(); setTimeout(showEnd, 1400); return; }
  } catch (e) {
    queued = null;
    if (e.status === 409) { await loadToday().catch(() => {}); }
    say(S(e.message.toUpperCase(), "demon"));
  }
  busy = false;
  draw();
  const q = queued; queued = null;
  if (q && mode === "game" && run.status === "playing" && run.view.turn === q.turn) take(q.slot);
}

// admins: a fresh deal of today's deck, any time (admin runs don't count anywhere)
async function restartRun() {
  if (busy) return;
  busy = true;
  try {
    const d = await api("/api/restart", {});
    run = d.run; T.run = d.run; bare = false;
    mode = "game";
    say(["Fresh deal.", `Room 01. ${run.view.deckCount} cards wait behind it.`], "Admin run: this one doesn't count.");
  } catch (e) { say(S(e.message.toUpperCase(), "demon")); }
  busy = false;
  draw();
}

// free play: start one (or pick the current one back up)
async function startFree() {
  if (busy || !freeOpen()) return;
  if (freeRun && freeRun.status === "playing") { run = freeRun; mode = "game"; say("Back in the free run.", pick(FLAVOR.deal)); return draw(); }
  busy = true;
  try { G = G || await import(`./engine/scoundrel.js?v=${VERSION.slice(1)}`); }
  catch { busy = false; return oops("Couldn't load free play."); }
  if (!dailyDone()) store.set("scoundrel.learned", "1");   // the one learning run is used up
  const seed = [...crypto.getRandomValues(new Uint32Array(2))].map((x) => x.toString(16)).join("");
  freeRun = freeView(G.newGame(seed), null);
  run = freeRun; mode = "game"; bare = false; busy = false;
  say(["Free play. A random deck, just for you.", "It never counts anywhere."], pick(FLAVOR.start));
  draw();
}
function freeView(state, events) {
  const done = state.status !== "playing";
  return { free: true, state, day: T.day, n: state.log.length, status: state.status, score: state.score, view: G.publicView(state),
    marks: done ? G.shareMarks(state.seed, state.log) : null, history: G.roomHistory(state.seed, state.log), ...(events ? { events } : {}) };
}
function freeMove(action) {
  try { const { state, events } = G.apply(run.state, action); return freeView(state, events); }
  catch (e) { throw new Error(e.message); }
}
// back to the front page from a free run: the daily run is "run" again
function leaveFree() { run = T.unfinished || T.run; mode = "title"; draw(); }

async function showEnd() {
  if (!run || run.status === "playing") return;   // an admin restarted before the end screen came up
  if (run.free) {
    const best = store.get("scoundrel.bestFree");
    if (best == null || run.score > Number(best)) store.set("scoundrel.bestFree", String(run.score));
    mode = "end"; return draw();
  }
  mode = "end";
  draw();
  try { board = await api(`/api/leaderboard?day=${run.day}`); boardDay = run.day; share = await api(`/api/share?day=${run.day}`).catch(() => null); } catch { /* still show the end */ }
  draw();
}

async function copyShare() {
  if (!share) { try { share = await api(`/api/share?day=${run ? run.day : T.day}`); } catch (e) { return oops(e.message); } }
  try { await navigator.clipboard.writeText(share.text); say("Your share card is copied. Paste it anywhere.", "No spoilers in it. Just the route."); }
  catch { say("Couldn't copy. Your browser said no.", ""); }
  draw();
}

function go(to) { back = ["board", "help", "ledger"].includes(mode) ? back : mode; mode = to; }
// (v0.10.0) the ≡ under the screen: the shared save codes / passkeys / carry window (dungeon-items, through /api/carry)
// pops up above it, over whatever screen is up. ≡ again, a click anywhere else or Esc closes it.
const $carry = document.getElementById("carry");
function showCarry(on) {
  if ($carry.hidden === !on) return;
  $carry.hidden = !on; $carry.src = on ? "/api/carry?embed=1" : "about:blank";
}
// once it has loaded: as tall as what it holds (the page caps it with max-height)
function fitCarry(f) { try { const b = f.contentDocument && f.contentDocument.body; if (b) f.style.height = Math.ceil(b.scrollHeight) + "px"; } catch { /* fine */ } }
document.getElementById("acct").addEventListener("click", (e) => { e.stopPropagation(); showCarry($carry.hidden); });
document.addEventListener("click", () => showCarry(false));

async function key(k) {
  if (mode === "loading") return;
  if (mode === "ledger") {
    if (k === "esc" || k === "l") { mode = back; return draw(); }
    if (k === "b") { go("board"); return loadBoard(boardDay || T.day); }
    if (k === "right" && ledgerData && ledgerData.more) { ledgerPages.push(ledgerBefore); return loadLedger(ledgerData.entries[ledgerData.entries.length - 1].id); }
    if (k === "left" && ledgerPages.length) return loadLedger(ledgerPages.pop());
    return;
  }
  if (mode === "run") {
    if (k === "esc") { history.replaceState(null, "", location.pathname); mode = "title"; return draw(); }
    if (k === "b" && runPage) { go("board"); return loadBoard(runPage.day); }
    if (k === "l") return openLedger();
    if (k === "r" && runPage) { window.open("https://88x31.app/registry?head=" + runPage.ledger.hash, "_blank", "noopener"); return; }
    return;
  }
  if (mode === "board" && k === "l") return openLedger();
  if (mode === "help" || mode === "board") {
    if (k === "esc" || (k === "h" || k === "?") && mode === "help" || k === "b" && mode === "board") { mode = back; return draw(); }
    if (mode === "board" && k === "left" && boardDay > (T.launch || T.day)) return loadBoard(shiftDay(boardDay, -1));
    if (mode === "board" && k === "right" && boardDay < T.day) return loadBoard(shiftDay(boardDay, 1));
    if (mode === "board" && k === "s" && share) return copyShare();
    return;
  }
  if (k === "h" || k === "?") { go("help"); return draw(); }
  if (mode === "title") {
    if (k === "p" || k === "c" || k === "enter") return jackIn();
    if (k === "b") { go("board"); return loadBoard(T.day); }
    if (k === "f" && freeOpen()) return startFree();
  }
  if (k === "r" && T.admin && !run.free && (mode === "game" || mode === "end")) return restartRun();
  if (mode === "game") {
    if (/^[1-4]$/.test(k)) return take(Number(k) - 1);
    if (k === "b" && run.view.room.some((c) => c.kind === "monster")) { bare = !bare; say(bare ? "Bare hands. Pick a demon." : "Blade back up.", undefined); return draw(); }
    if (k === "s") { if (run.view.canSkip) return act({ type: "skip" }); say(S(`CAN'T SKIP: ${skipWhy(run.view).replace(/^no \(|\)$/g, "").toUpperCase()}.`, "demon")); return draw(); }
    if (k === "esc" && bare) { bare = false; return draw(); }
    if (k === "esc") { if (run.free) return leaveFree(); mode = "title"; return draw(); }
    if (k === "tab") { go("board"); return loadBoard(run.day); }
  }
  if (mode === "end" && run.free) {
    if (k === "f" && canFree()) { freeRun = null; return startFree(); }
    if (k === "esc" || k === "enter") return leaveFree();
    return;
  }
  if (mode === "end") {
    if (k === "s") return copyShare();
    if (k === "b") { go("board"); return loadBoard(run.day); }
    if (k === "l") return openLedger();
    if (k === "esc" || k === "enter") { mode = "title"; return draw(); }
  }
}

const KEYS = { Enter: "enter", Escape: "esc", Tab: "tab", ArrowLeft: "left", ArrowRight: "right", "?": "?" };
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "Escape" && !$carry.hidden) { e.preventDefault(); return showCarry(false); }
  const k = KEYS[e.key] || (e.key.length === 1 ? e.key.toLowerCase() : null);
  if (!k) return;
  e.preventDefault();
  if (mode === "game" && /^[1-4]$/.test(k) && !busy) squeeze(k);
  key(k);
});
$screen.addEventListener("mouseover", (e) => {
  const b = e.target.closest("[data-k]");
  const k = mode === "game" && b && /^[1-4]$/.test(b.dataset.k) ? b.dataset.k : null;
  if (k !== hoverK) { hoverK = k; draw(); }
});
$screen.addEventListener("mouseleave", () => { if (hoverK) { hoverK = null; draw(); } });
// The screen redraws every second (and on hover), so a press and a release can land on different
// elements and the browser drops the click. So act on a press and release over the same key instead.
// (Nothing redraws or resizes the card on press: a card that shrinks under the cursor can slip out
// from under it before the release, and the click is lost.)
let downK = null;
$screen.addEventListener("pointerdown", (e) => {
  const b = e.target.closest("[data-k]");
  downK = b && !b.classList.contains("off") ? b.dataset.k : null;
});
$screen.addEventListener("pointerup", (e) => {
  const b = e.target.closest("[data-k]");
  const k = b && !b.classList.contains("off") ? b.dataset.k : null;
  const was = downK; downK = null;
  if (k && k === was) {
    if (mode === "game" && /^[1-4]$/.test(k) && !busy) squeeze(k);
    key(k);
  }
});

// the clock: redraw each second, and a new deck at midnight UTC
setInterval(async () => {
  if (!T) return;
  if (Date.now() >= deadline) {
    await loadToday().catch(() => {});
    if (mode === "title") board = null;
    say(`A new deck is dealt: ${deckNo(T.number)}.`, "Everyone starts again.");
  }
  if (mode === "title" || mode === "game" || mode === "end") draw();
}, 1000);

// ---------- start ----------

(async () => {
  mode = "loading"; draw();
  try { await loadToday(); }
  catch (e) { $screen.textContent = "COULDN'T REACH THE SERVER.\n" + e.message; return; }
  document.getElementById("ver").textContent = VERSION;
  mode = "title";
  if (T.unfinished) say(S("You have an unfinished run from yesterday's deck.", "gold"), "It still counts. Jack back in to finish it.");
  else if (T.run && T.run.status === "playing") say("Your run today is still going.", "The cards are where you left them.");
  else if (T.run) say(`You already ran today's deck. Score ${T.run.score}.`, "A new deck deals at midnight UTC.");
  else say(["A fresh deck is dealt. Everyone gets the same one.", "You get one run at it. No do-overs."], "");
  const linked = (new URLSearchParams(location.search).get("run") || "").toLowerCase();
  if (/^[0-9a-f]{64}$/.test(linked)) openRun(linked); else draw();   // ?run=FINGERPRINT (the registry's link) opens that run's page
  api(`/api/leaderboard?day=${T.day}`).then((b) => { board = b; boardDay = T.day; if (mode === "title") draw(); }).catch(() => {});
  api("/api/history").then((h) => {
    everPlayed = h.runs.some((x) => x.status !== "playing");
    if (mode === "title" && canFree() && !dailyDone() && !log[2]) say(undefined, "New here? Try [F]REE PLAY first. It never counts.");   // a first-timer's one practice run
    if (mode === "title") draw();
  }).catch(() => {});
})();
