# scoundrel.exe Changelog

Newest first. Times are Hawaii time (HST).

---

## v0.8.12 — "Reroll"
**Tue Oct 20, 2026 · 3:35 AM HST**

- **Don't like your random name? Reroll it.** Press [R]EROLL next to your name on the PLAYER screen for a new one. You can still type your own with [N]AME.
- **Admins can switch admin mode off and on** from the PLAYER screen. Off, you play like everyone else and your runs count; switching off throws away your admin runs, which never counted. You can switch it back on before you play that day.
- **[C]ONTINUE** on the title screen when you have a run going (it was [P] CONTINUE). P still works.
- Removed: the [P] label on CONTINUE.

## v0.8.11 — "Name Tag"
**Tue Oct 20, 2026 · 3:24 AM HST**

- **Every player now has a name.** New players start with a random two-word one, like the other 88x31 games (Quiet Heron, Lucky Otter), and players without a name get one the next time they visit. Change it any time from your player screen. No more GUEST at the top after logging in.
- **Removed: the "put your name on the board?" question** after a guest's first run, and the line saying runs without a name don't show. Everyone is on the board now.

## v0.8.10 — "On the Record"
**Tue Oct 20, 2026 · 2:55 AM HST**

- **Every finished run is now written into the shared item registry** used by all the 88x31.app games: the ledger's length and newest fingerprint, so the registry's hourly Bitcoin timestamp covers this game's ledger too. Each line tells how the run ended: the day, cleared or deleted, HP or the room, demons left, score and moves. If you picked a leaderboard name it shows there too (not sealed into the record); without one you're "A Scoundrel". Your cards and moves stay here. You can see these lines on the registry's ledger page.

## v0.8.9 — "One Key"
**Sat Oct 17, 2026 · 2:45 AM HST**

- **Save codes and passkeys now come from one shared accounts system** with the other 88x31 games, so a passkey made on any `88x31.app` address will work on all of them. Your save code keeps working: it moves to your account the first time you're seen.
- **Passkeys you made here before can't carry over** (a passkey belongs to the exact address it was made on), so make a new one. Your save code covers you until then.

## v0.8.8 — "Steady Screen"
**Thu Oct 15, 2026 · 10:25 AM HST**

- **No more full-screen redraws.** The whole screen used to be torn down and rebuilt every second and on every hover, which made the pointer flicker to an arrow, dropped hovers and cut animations short. Now only the lines that actually changed are updated (the countdown, the little v).
- A card **squeezes the instant you pick it**, instead of after the server answers.
- The line under each card is part of the card: pointer and click work there too.
- (Fixes the page not picking up new versions: the script's cache tag was stuck at 0.8.6.)

## v0.8.7 — "Click Through"
**Thu Oct 15, 2026 · 10:20 AM HST**

- **Fixed cards ignoring clicks.** A card used to shrink while you held the click, so pressing near its edge could slide it out from under the cursor and the click got lost. Cards no longer move on press; they squeeze once the pick is made.
- A click made while a move is still going is **held and played** instead of dropped (only if the room is still the same one).

## v0.8.6 — "Countdown"
**Wed Oct 14, 2026 · 6:47 AM HST**

- The top right shows **NEXT DECK DEALT IN** and a countdown again.

## v0.8.5 — "Battle Log"
**Wed Oct 14, 2026 · 6:44 AM HST**

- **HISTORY** under the rooms bar: one mark per room as you go, like the share card. ↷ skipped, ⚔ blade, ‼ bare hands, ♥ healed.
- **LAST** at the bottom right shows your last two moves in words, newest first: `#14 ⚔ slew 7♠`.
- **SLAIN** sits right under CAN HIT.
- New top line: `SCOUNDREL.EXE // NAME // DECK #1` on the left, the date and time on the right.
- Admins can see every move on the ledger.

## v0.8.4 — "Free Play"
**Wed Oct 14, 2026 · 6:35 AM HST**

- **[F]REE PLAY:** a random deck, just for you. It never counts anywhere: not on the board, not on the ledger.
- New here? You get **one free run to learn the rules** before your first daily run.
- After that, free play opens once you've played **today's deck**. Play as many as you like while you wait for tomorrow.
- Your **best free score** is kept on this device.

## v0.8.3 — "Sign Here"
**Wed Oct 14, 2026 · 6:20 AM HST**

- Finished a run as a guest? The game asks **PUT YOUR NAME ON THE BOARD?** Type a name and press ENTER, and your run shows up on the leaderboard. **[ESC] NO THANKS** skips it.
- Taking a card: it **pushes in** while you hold the click and pops back out when you let go.
- The cards sit in the middle of the table.
- What's left in the deck says **IN DECK**, so it's not mixed up with your HP.
- **35 new flavor lines.** Darker, with more static.

## v0.8.2 — "Click Means Click"
**Wed Oct 14, 2026 · 6:12 AM HST**

- **Clicks always count now.** Sometimes a click on a card or a button didn't do anything. Fixed everywhere.
- A card **squeezes** when you take it.
- **NEXT ROOM...** shows for a moment between rooms.
- The bar under the table is **ROOMS** now: room 05 of ~14.
- Your blade says what it **hits up to**. What it has killed is **SLAIN**, at the bottom of the right side.
- What's **LEFT** in the deck is on the right side too. Your HP bar moved down a line.
- The ledger has a **[B]OARD** button to go back to the board.

## v0.8.1 — "Name Tag"
**Wed Oct 14, 2026 · 5:59 AM HST**

- Your name is at the top of every screen (or GUEST).
- **[TAB] BOARD** in the middle of a run. The ledger is inside the board, and ESC takes you back to your run.
- In a run, **[ESC]** takes you to the front page.
- The version in the corner says the right number again.

## v0.8.0 — "Fewer Doors"
**Wed Oct 14, 2026 · 5:55 AM HST**

- The front page is just **[P]LAY**, **[B]OARD**, **[U]SER** and **[?]**. Not logged in, it's **[P]LAY**, **[L]OG IN**, **[B]OARD** and **[?]**.
- **[L]OG IN** opens your passkey right away. No passkey, or cancel it, and you get the save code box.
- No more WHO'S PLAYING? box on the front page.
- **[ESC] TITLE** in the middle of a run takes you back to the front page. Your run waits for you: **[P] CONTINUE**.
- The ledger is inside the board. **[H]ELP** is just **[?]**. **PLAYER** is **USER**.

## v0.7.3 — "Brackets Back"
**Wed Oct 14, 2026 · 5:42 AM HST**

- The front page menu shows [B]OARD, [L]EDGER, [H]ELP and [P]LAYER again.

## v0.7.2 — "Who's Playing?"
**Wed Oct 14, 2026 · 5:38 AM HST**

- The front page asks **WHO'S PLAYING?** with the name box already open. Just type your name and press ENTER to play, or ESC to play as a guest.

## v0.7.1 — "New Address"
**Wed Oct 14, 2026 · 5:27 AM HST**

- **scoundrel.exe has a home: scoundrel.88x31.app!** The old address sends you there.
- **Download your save code** as a .txt file, so it's easy to keep safe.
- Passkeys are **PASS[K]EY** now. If you add one without a save code, the game reminds you to make one too.
- After a run, the menu is just **[S]HARE**, **[B]OARD** and **[ESC] TITLE**. [S]HARE copies your share card.

## v0.7.0 — "Who Goes There?"
**Wed Oct 14, 2026 · 5:10 AM HST**

- **Who's playing?** The first time you press ENTER, the game asks your name right on the title screen. Or press ESC to play as a guest.
- The title says who you're playing as, and ENTER says **PLAY**, **CONTINUE** or **YOUR RUN**.
- **ACCOUNT** is now **PLAYER**, with **[L]OG IN** and **[L]OG OUT**. Log out only works once you have a save code or passkey, so you can always get back in.
- Passkeys are **[K]EY** on the player screen. Deleting a code or passkey is **[D]ELETE**.
- Admin players see **ADMIN · DOESN'T COUNT** at the top of every screen.
- Blades say what they **CAN HIT**: anything, 2 to J, or nothing once they're dull.

## v0.6.1 — "Stay Put"
**Wed Oct 14, 2026 · 4:51 AM HST**

- Cards stay in their spot! When you take a card, the others don't slide over. They keep their place and their number, and new cards fill the empty spots.

## v0.6.0 — "Off the Record"
**Wed Oct 14, 2026 · 4:44 AM HST**

- Admin mode is simpler: admins can restart today's deck any time to try things out, and admin runs don't count. They're never on the Ledger or the leaderboard.
- Tester mode is gone.
- The Ledger was reset, fresh for real players.

## v0.5.0 — "Take It With You"
**Wed Oct 14, 2026 · 4:33 AM HST**

- **Save codes and passkeys!** The new **[A]CCOUNT** screen lets you make a save code or add a passkey. Then you can load your player on another browser or device, with your runs, name and all.
- Your player can be on more than one device at once.
- Lost a device? Forget its code or passkey from the account screen.
- Admins can switch tester mode on and off right in the game. Every switch is written on the Ledger.

## v0.4.0 — "Again!"
**Wed Oct 14, 2026 · 4:25 AM HST**

- **Testers** can restart today's deck as many times as they like (press R twice). Tester runs aren't ranked and stay off the leaderboard.
- Every restart is written on the Ledger, so nothing disappears quietly.

## v0.3.0 — "Paper Trail"
**Wed Oct 14, 2026 · 4:20 AM HST**

- **The real screen is here!** An 80-column text screen in black and white. The only color is the suit in the middle of a card: red hearts, blue diamonds.
- Click a card (a little **v** shows which one) or press 1–4. Under each card you can see what taking it would do.
- **[B]ARE HANDS** lets you fight a demon without dulling your blade.
- Potions are called **HEALTH** now.
- The side panel shows your HP, your blade and its kills, and whether you can still heal or skip this room.
- See how far through the dungeon you are, and what's left in the deck.
- New route marks: ⚔ blade, ‼ bare hands, ↷ skip, ♥ health. No emoji.
- **The Ledger!** Every deal, move and finished run is sealed in one chain that can't be changed. Other players' moves stay hidden until the day is over, then everything shows.
- Leaderboard screen with past days, how to play, and a name box right in the game.

## v0.2.0 — "Same Deal"
**Wed Oct 14, 2026 · 3:46 AM HST**

- **The daily deck is live!** Everyone plays the same deck each day, and a new one deals at midnight UTC.
- **One try a day.** Your ranked run is your run, so make it count.
- **No signup.** Just play. Pick a name if you want to show up on the leaderboard.
- **Leaderboard** for each day, and a **share card** to brag (or cry) with.
- Once a day is over, its deck's seed goes public so anyone can check the scores.
- The page is a plain test screen for now. The real look is coming!

## v0.1.0 — "Shuffle Up"
**Wed Oct 14, 2026 · 3:37 AM HST**

- The rules engine is here! The full 44-card Scoundrel dungeon: rooms of 4, weapons, potions, skipping, scoring.
- Same seed, same deck: the start of one shared deck for everyone each day.
- Play it in a terminal with `node play.mjs` while the real screen is on its way.
