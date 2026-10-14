// Play Scoundrel in a terminal:  node play.mjs [seed]
// Commands: 1-4 take that card (monsters: with your weapon if you can) · b1-b4 fight bare-handed · s skip · q quit
import readline from "node:readline";
import * as G from "./engine/scoundrel.js";

const seed = process.argv[2] || String(Date.now());
let s = G.newGame(seed);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const bar = (h) => "█".repeat(Math.max(0, h)) + "░".repeat(Math.max(0, 20 - h));
function show() {
  const v = G.publicView(s);
  console.log(`\n── Room ${v.turn} ── deck ${v.deckCount} (${v.deckMonsters} monsters) ──`);
  console.log(`HP ${String(v.health).padStart(2)} ${bar(v.health)}`);
  const w = v.weapon ? `${G.cardName(v.weapon.card)}${v.weaponCeiling ? `  (only below ${v.weaponCeiling}${s.rules.weaponLimit === "lowerOrEqual" ? " or equal" : ""})` : "  (fresh)"}` : "none";
  console.log(`Weapon: ${w}${v.potionUsedThisRoom ? "   (potion used this room)" : ""}`);
  console.log(v.room.map((c, i) => `[${i + 1}] ${G.cardName(c).padEnd(3)} ${c.kind}`).join("   "));
  console.log(v.canSkip ? "s = skip room" : "");
}
function say(events) {
  for (const e of events) {
    if (e.type === "equip") console.log(`Equipped ${G.cardName(e.card)}.`);
    if (e.type === "heal") console.log(`Healed ${e.amount}. HP ${e.health}.`);
    if (e.type === "potion_wasted") console.log(`${G.cardName(e.card)} wasted (one potion per room).`);
    if (e.type === "fight") console.log(`${e.armed ? "Weapon" : "Bare hands"} vs ${G.cardName(e.card)}: ${e.damage} damage. HP ${e.health}.`);
    if (e.type === "skip") console.log("Skipped the room.");
    if (e.type === "won") console.log(`\nYOU CLEARED THE DUNGEON! Score ${e.score}${e.bonus ? ` (+${e.bonus} potion bonus)` : ""}`);
    if (e.type === "dead") console.log(`\nYOU DIED. Score ${e.score} (${e.monstersLeft} monsters left).`);
  }
}

console.log(`Scoundrel, seed "${seed}". 1-4 take · b1-b4 bare-handed · s skip · q quit`);
show(); process.stdout.write("> ");
for await (const line of rl) {
  const cmd = line.trim().toLowerCase();
  if (cmd === "q") break;
  const a = cmd === "s" ? { type: "skip" }
    : /^b[1-4]$/.test(cmd) ? { type: "take", card: Number(cmd[1]) - 1, bare: true }
    : /^[1-4]$/.test(cmd) ? { type: "take", card: Number(cmd) - 1 }
    : null;
  if (!a) { console.log("?"); process.stdout.write("> "); continue; }
  // a monster you can't hit with your weapon: fight it bare-handed automatically
  const c = a.type === "take" ? s.room[a.card] : null;
  if (c && c.kind === "monster" && !a.bare && !G.canUseWeaponOn(s, c)) a.bare = true;
  try { const r = G.apply(s, a); s = r.state; say(r.events); }
  catch (e) { if (e instanceof G.IllegalMove) console.log(e.message); else throw e; }
  if (s.status !== "playing") break;
  show(); process.stdout.write("> ");
}
if (s.status !== "playing") console.log("Rooms:", G.shareMarks(seed, s.log).join(""));
rl.close();
