# scoundrel.exe: working notes

## This repo

A daily seeded Scoundrel game (the solo card game by Zach Gage and Kurt Bieg): everyone plays the same 44-card deck each UTC day. Live at scoundrel.88x31.app. The Worker `scoundrel-exe` is connected to this repo, so every push to `main` deploys it.

**Layout**
- `public/engine/scoundrel.js` is the rules (deck, shuffle, actions, scoring, replay, share marks). `engine/scoundrel.js` only re-exports it. Pure JavaScript with no dependencies, so the browser, the Worker and Node run the same code. Change a rule there, once.
- `engine/daily.js` makes the day's seed: an HMAC of the UTC date with the Worker secret `DAILY_SECRET`. Never change that secret: it changes every day's deck.
- `src/worker.js` is the Worker, `src/ledger.js` the hash chain over every deal, move and finished run, `src/saves.js` cookie tokens, extra devices and rate limits, `src/names.js` the names.
- `public/index.html` and `public/app.js` are the 80-column text screen. `play.mjs` plays the game in a terminal.
- `migrations/` (001 to 004) and `schema.sql` are the D1 database `scoundrel-db`.

**Services.** Save codes and passkeys are the shared Accounts service, and every finished run checkpoints this ledger in the shared copy registry. Both are the dungeon-items Worker (`ACCOUNTS`, `REGISTRY`), so deploy dungeon-items first.

**Testing.** `npm test` runs `node --test test/*.test.mjs`.

**Versions.** The real version is `data-version` on the footer script in `public/index.html` (v0.11.4 now); `app.js` reads it. The title line in `README.md` says v0.8.9 and is out of date, so don't trust it. A release bumps `data-version` and adds an entry at the top of `CHANGELOG.md`. No test checks that these match, so check by hand. The detailed dev entry goes in `scoundrel.exe/changelog-v0.1.md` in the private dungeon-notes repo.

<!-- BEGIN SHARED RULES v7 (2026-10-31). One copy of this block is in every Dungeons repo's CLAUDE.md. The source is dungeon-notes/SHARED-RULES.md. Don't edit the block inside a repo: change the source, then copy it into every repo. -->
## Working rules (shared by every repo)

"kura" is the owner. "4Dungeon" is the repo `daily-dungeon`. Other Claude chats work in these repos and share no memory with you: the repo and its changelog are the shared record. A repo section above beats a rule below, except rules 1 to 4.

**Honesty (never broken)**
1. Never lie. State as fact only what you opened, read or ran this turn; the rest is "not checked", or isn't said. Label opinions "my opinion". "Should work" and "probably" count as not checked.
2. Answers about code or data end with "Not checked:".
3. Check first, then reply once. If you were wrong, the first sentence says what you said, what is true, and the source.
4. Never say something was done, pushed or fixed unless you saw it succeed. Report failures plainly.

**Searching**
5. Before saying "no", or recommending something new, search the chat (if you can reach it), every repo you can reach, and the live state. Say what you searched and what you found. Say "I couldn't find it", never "that isn't true". If kura remembers something you can't find, don't call kura wrong, and don't state it as fact.

**Design**
6. Give honest answers, including "this isn't worth building". Give one recommendation. Never tell kura to playtest the game.
7. Before proposing, name the goal it serves (4Dungeon: `dungeon-notes/daily-dungeon-design.md`, section 15) and how it would most likely fail. No goal, no proposal. Propose the smallest version first.

**Building**
8. Commit locally as asked. Push only when kura says to. "Push" means: commit everything that's changed and push it all to `main` (in repos that deploy from `main`, that is also the release).
9. Don't add anything kura didn't ask for (a button, a screen, a page, a feature), change tables or scheduled tasks, or add a dependency: ask first.
10. Delete, don't park: no new flags or "off for now" code. Fix a shared problem once, in the shared place. Prefer changing what exists to adding a file. Each changelog line says what was removed as well as what was added.
11. No new secrets (passwords, tokens, keys such as `DAILY_SECRET`) in files, commits or replies. If you find one already committed, tell kura, and don't repeat it.

**Working with kura**
12. Don't act without kura's explicit permission. A question gets an answer, not an action: "Can you remove that rule?" is a request; "What happens if we remove that rule?" is a question. If you can't tell which, answer, then ask "want me to do it?" and wait. Reading and searching to find the answer is fine.
13. Disagree before building, not after. Silence means "not now": raise each item once.

**Defaults**
- Testing takes 2 to 3 minutes in total, with no edge cases. A repo's required check (such as `npm test`) counts toward that. Need more? Ask first.
- Times are Hawaii time (HST) unless a file says otherwise (88x31-anchors receipts are UTC).
- Some repos get automated commits: fetch before you push.
<!-- END SHARED RULES v7 -->
