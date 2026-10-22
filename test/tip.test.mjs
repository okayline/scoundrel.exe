// The checkpoint's check of the newest entry (verifyTip in src/ledger.js), against hashes made with node:crypto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { verifyTip } from "../src/ledger.js";

const sha = (t) => createHash("sha256").update(t).digest("hex"), G = "0".repeat(64);
const e1 = { id: 1, record: "{\"a\":1}", prev_hash: G, hash: sha(G + "|{\"a\":1}") };
const e2 = { id: 2, record: "{\"b\":2}", prev_hash: e1.hash, hash: sha(e1.hash + "|{\"b\":2}") };

test("verifyTip passes a newest entry that hashes right and chains from the one before, and nothing else", async () => {
  assert.deepEqual(await verifyTip([e1]), { ok: true }, "the first entry chains from GENESIS");
  assert.deepEqual(await verifyTip([e1, e2]), { ok: true });
  assert.deepEqual(await verifyTip([e1, { ...e2, record: "{\"b\":3}" }]), { ok: false, at: 2 }, "a changed record");
  assert.deepEqual(await verifyTip([{ ...e1, hash: "f".repeat(64) }, e2]), { ok: false, at: 2 }, "a newest entry that doesn't chain from the one before");
  assert.deepEqual(await verifyTip([{ ...e2, id: 1 }]), { ok: false, at: 1 }, "an only entry that isn't chained from GENESIS");
  assert.deepEqual(await verifyTip([e1, { ...e2, id: 3 }]), { ok: false, at: 3 }, "a gap in the ids (the newest id is the count)");
});
