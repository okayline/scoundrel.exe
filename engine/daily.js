// The daily deck: everyone gets the same shuffle each UTC day, and nobody can work it out ahead of time.
// Seed = HMAC-SHA256(secret, "YYYY-MM-DD"). The secret lives only on the server (a Cloudflare secret),
// so the browser never sees a seed until the day is over. Uses Web Crypto: works in Workers, browsers, Node 18+.

export function utcDay(date = new Date()) {
  return date.toISOString().slice(0, 10); // "2026-10-14"
}

// Day number since launch, for "Scoundrel #123" style share cards.
export function dayNumber(day, launchDay) {
  return Math.round((Date.parse(day + "T00:00:00Z") - Date.parse(launchDay + "T00:00:00Z")) / 86400000) + 1;
}

export async function dailySeed(secret, day = utcDay()) {
  if (!secret) throw new Error("dailySeed needs the server secret.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`Bad day "${day}".`);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode("daily:" + day)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Milliseconds until the next deck.
export function msUntilNextDay(now = new Date()) {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return next - now.getTime();
}
