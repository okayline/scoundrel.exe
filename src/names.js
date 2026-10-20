// Random player names: two words, like Dawn Baton and irl-dungeon (the word lists are copied from irl-dungeon
// src/names.js, which copied dawn-baton engine/baton.js). Here a name is plain text, the same as one a player types,
// so they can change it with NAME any time. Every player gets one when they're made or next seen: nobody is nameless.
const ADJECTIVES = [
  "Quiet", "Amber", "Early", "Gentle", "Bright", "Sleepy", "Golden", "Misty", "Rosy", "Brisk",
  "Hushed", "Warm", "Pale", "Slow", "Steady", "Wandering", "Soft", "Silver", "Crisp", "Drowsy",
  "Humble", "Eager", "Lucky", "Patient", "Little", "Cheerful", "Faint", "Glowing", "Distant", "Tender",
  "Rested", "Windy", "Dewy", "Calm", "Merry", "Shy", "Nimble", "Sunny", "Mellow", "Dappled",
];
const NOUNS = [
  "Heron", "Lantern", "Sparrow", "Kettle", "Meadow", "Thistle", "Harbor", "Wren", "Compass", "Fern",
  "Moth", "Orchard", "Ferry", "Pebble", "Robin", "Willow", "Teapot", "Comet", "Lark", "Cedar",
  "Beacon", "Marmot", "Otter", "Clover", "Ember", "Finch", "Tide", "Bramble", "Lamp", "Poppy",
  "Swallow", "Sundial", "Quill", "Hedgehog", "Trellis", "Rooster", "Weathervane", "Kingfisher", "Pigeon", "Lighthouse",
];
// names are at most 16 characters (NAME_RE in worker.js), so only the pairs that fit
const PAIRS = ADJECTIVES.flatMap((a) => NOUNS.map((n) => `${a} ${n}`)).filter((s) => s.length <= 16);

// Give this player a random name nobody has, if they have none (or a different one, with reroll). Returns the player
// with its name (unchanged only if every try hit a taken name, which won't happen until most of the pairs are used).
export async function giveName(env, p, { reroll = false, rand = Math.random } = {}) {
  if (!p || (p.name && !reroll)) return p;
  for (let i = 0; i < 40; i++) {
    const name = PAIRS[Math.floor(rand() * PAIRS.length)];
    if (name === p.name) continue;
    try {
      const r = await env.DB.prepare(`UPDATE players SET name = ?, name_key = ? WHERE id = ?${reroll ? "" : " AND name IS NULL"}`)
        .bind(name, name.toLowerCase(), p.id).run();
      if (!r.meta.changes) return { ...p, ...(await env.DB.prepare("SELECT name FROM players WHERE id = ?").bind(p.id).first()) };
      return { ...p, name };
    } catch (e) {
      if (!String(e.message).includes("UNIQUE")) throw e;   // taken: try another
    }
  }
  return p;
}
