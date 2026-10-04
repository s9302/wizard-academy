# Wizard Academy

A small multiplayer low-poly 3D browser game: walk, run, and jump around in
first person with friends. Built in phases. **Phase 12** added class abilities (wizards
reshape the arena; rogues teleport and vanish; knights charge and fortify)
and three more story trials (Chapters IV–VI, through the Sanctum).

- **Client:** TypeScript, Three.js (rendering), Rapier (physics and character
  controller), built with Vite.
- **Server:** Node.js 24 + TypeScript, WebSockets via `ws`. Node runs the `.ts`
  files directly, so the server has no build step.
- **Database:** Postgres 17 for accounts, XP and best times.
- **Deployment:** Docker Compose. Caddy serves the built client and proxies
  `/ws` and `/api/*` to the game server.

## Where it runs

VM 104 `game` on `pve2` (Ubuntu 24.04), in `~/wizard-academy` as user `spencer`.

| Address | Who can reach it |
|---|---|
| `http://game:8080` (Tailscale IP) | Tailnet devices only |
| `http://127.0.0.1:8081` | The VM itself: this is where cloudflared connects |
| `https://wizardgame.spencersmith.win` | The internet, via the Cloudflare Tunnel |

Both Caddy listeners serve the same site behind the same PIN gate. They differ
only in where the visitor's IP address comes from (see [Access PIN](#access-pin)).

It is **not** reachable from the apartment LAN. That is deliberate, see
[Host firewall](#host-firewall).

## Start, stop, update

On `game`:

```sh
cd ~/wizard-academy
docker compose up -d --build   # start (or rebuild after changes)
docker compose down            # stop
docker compose ps              # status
docker compose logs -f server  # follow the game server log (joins/leaves)
```

Containers restart automatically after a crash or reboot.

**To update**, push new commits to the `game` remote from the dev machine,
then on `game`:

```sh
cd ~/wizard-academy
git pull
docker compose up -d --build
```

Connected players are disconnected during the restart and need to reload.

## First-time setup

```sh
cp .env.example .env
chmod 600 .env
# fill in TAILNET_IP (tailscale ip -4), GAME_PIN, SESSION_SECRET (openssl rand -hex 32),
# POSTGRES_PASSWORD (openssl rand -hex 24)
docker compose up -d --build
```

`.env` is gitignored. Compose refuses to start if `TAILNET_IP`, `GAME_PIN`,
`SESSION_SECRET` or `POSTGRES_PASSWORD` is missing, and the server refuses a PIN shorter than 6
characters or a secret shorter than 32.

## Testing

The check scripts create test accounts, so run them against a **separate
test copy** of the stack, never the real one. On `game`, with a `.env.test`
(different ports, its own secrets, `COOKIE_SECURE=false`,
`ROUND_TIME_SCALE=0.25`; `.env.*` is gitignored):

```sh
docker compose -p wizard-test --env-file .env.test up -d --build   # own containers + database
# ...run the scripts against http://game:<its HTTP_PORT>, e.g.
GAME_PIN=<test pin> node server/scripts/accounts-check.ts http://game:8090
docker compose -p wizard-test --env-file .env.test down -v         # delete it all
```

Scripts: `security-check`, `parkour-check`, `chase-check`, `bots-check`,
`hub-check`, `royale-check`, `classes-check`, `abilities-check`, `arena-check`, `unlocks-check`, `story-check`, `admin-check`,
`trials-check`, `features-check`, `boss-check`, `teams-check`, `ready-check` (needs `ROUND_READY=on`), `mastery-check` (needs an admin account) (the boss ones want `BOSS_HP_SCALE=0.05` on the server),
`accounts-check` (run it last:
it trips the login rate limit for your IP). Each new test account starts with
a failed login (try login, then register), so running everything back to
back can trip the limit too: restart the test server between batches.


- Open `http://game:8080` on a tailnet device, enter a name, click into the
  page to capture the mouse. **WASD** move, **Shift** run, **Space** jump,
  **Esc** releases the mouse.
- Open a second browser window (or have someone else on the tailnet join) to
  see another wizard move.
- No second person handy? Run test bots that log in with the PIN and walk in
  circles near spawn (optionally in another room, e.g. `trial1`):

  ```sh
  npm install                 # once, on a machine with Node 24
  GAME_PIN=... node server/scripts/bot.ts http://game:8080 3 [room]
  ```

- Check the in-game protections (speed/teleport/fly rejection, respawn rules,
  flood limit) after changing `MoveCheck.ts` or the limits:

  ```sh
  GAME_PIN=... node server/scripts/security-check.ts http://game:8080
  ```

## Accounts, XP and levels

Past the PIN, everyone signs in with their own account (username + password,
created from the same screen). Your username is your in-game name. There's
no guest play: XP and best times need an owner.

- **Passwords** are hashed with **argon2id** (19 MiB memory, 2 passes; OWASP's
  recommended minimum) and never stored or logged in plain text.
- **Login cookie** `wa_account`: 30 days, HttpOnly, SameSite=Lax, Secure in
  production, signed with `SESSION_SECRET`. It carries a session version, so
  bumping `accounts.session_version` logs that account out everywhere.
- **Login limits:** 10 failed logins per IP and per username per 15 minutes;
  20 sign-ups per IP per hour (friends in one house share an IP). Wrong
  username and wrong password get the same message and take the same time,
  so the login can't be used to find out which usernames exist.
- **One connection per account:** joining from another tab or device
  disconnects the first (otherwise extra tabs would multiply XP).
- The API (`/api/register`, `/api/login`, `/api/logout`, `/api/me`) only
  accepts JSON from this site (Content-Type + Origin checks), which blocks
  cross-site form posts.

**XP** (all awarded by the server; amounts in `server/src/xp.ts`):

| | XP |
|---|---|
| First clear of Trial I / II / III | 100 / 150 / 200 |
| First clear of Trial IV / V / VI | 250 / 300 / 400 |
| Clearing it again | a quarter of that, +25 for a new personal best |
| Killing a monster (battle royale, the Tyrant's wolves) | Slime 8, Shadow Wolf 10, Stone Golem 25; at most 12 kills pay XP per 5 minutes |
| Finishing a tag or infection round | 20 |
| Tag: least time as It | +40 |
| Infection: surviving the curse | +50 |
| Each tag / curse you land (max 10 per round) | +5 / +10 |
| Finishing a battle royale round | 20 |
| Battle royale: last wizard standing / 2nd or 3rd | +75 / +20 |
| Each elimination (max 10 per round) | +15 |
| Rounds with only you and bots | half XP (practice) |

**Levels:** level 2 needs 100 XP, then each level needs 50 more than the last
(`shared/src/progression.ts`). Levels unlock things: see
[Story, spells and unlocks](#story-spells-and-unlocks).

**Database:** Postgres runs in its own container with no published port; only
the game server can reach it. Data lives in the `pgdata` Docker volume, so
it survives rebuilds (`docker compose down -v` would delete it!) and is part
of the VM's nightly Proxmox backup. Schema changes are numbered SQL files in
`server/migrations/`, applied automatically at server start.

```sh
# Poke at the database
docker compose exec postgres psql -U wizard -d wizard
#   SELECT username, xp FROM accounts ORDER BY xp DESC;
#   SELECT * FROM xp_events ORDER BY id DESC LIMIT 20;
```

## The Academy (hub)

After logging in, **Enter the Academy** puts you in the courtyard in front of
the academy building. Seven portal arches stand in a ring around the plaza:
the three trials on the west side, Tag, Infection and the Playground on the
east, and the Battle Royale at the north end, in front of the academy door.
Walk into one to go there.

- Each portal has a sign with the room's name, how many people are in it
  right now (bots not counted; refreshed every 2 s), and for trials your
  best time.
- **Esc** opens the pause panel. In a room, **Back to the Academy** returns
  you to the hub, standing in front of the portal you used and facing the
  plaza. In the hub, **Exit to menu** goes back to your profile.
- A dropped connection returns you to the menu with the reason.

How it works: every room switch is a fresh WebSocket that says `hello` to the
new room, with `from` set to the room you left. The hub uses `from` to place
you at that room's portal (`server/src/rooms/HubRoom.ts`). The client detects
walking into a portal, which is fine because any room is open to join anyway;
there is nothing to cheat. Portals can only be entered from the front (a back
wall blocks the other side), and one only fires after you've first been
outside all of them, so arriving next to one can't bounce you straight back.

```sh
node client/scripts/walk-hub.ts   # physics bot walks into every portal, and tries the backs
GAME_PIN=... node server/scripts/hub-check.ts http://localhost:3000   # arrival spots, live counts, bad input
```

## Parkour

| Trial | What it asks of you |
|---|---|
| I: The Floating Steps | The gentle one: wide stones, a couple of 4 m running jumps |
| II: The Spiral Spire | Three laps, ~20 running jumps in a row that each climb 0.8 m onto 1.5 m stones; a slip costs a lap |
| III: The Shattered Bridge | 6 m running leaps, 1 m pillars that each rise a full metre, a 0.4 m tightrope |
| IV: The Storm Gate | A zig-zag climb of gate stones, narrow beams with sharp turns, a row of storm teeth, long leaps down |
| V: The Hollow Stair | A broken stair down, tiny stones offset both ways, rising columns, a tightrope that turns |
| VI: The Eye of the Storm | Long leaps down, pillars a full metre apart, a ring of stones round the eye, one last tightrope |

Trials IV–VI are reached through portals inside the **Sanctum** (back wall):
Trial IV opens with the Sanctum (Chapter III), V needs Chapter IV and VI
needs Chapter V; until then a barrier stands in front of the portal.

- The timer starts when you step off the start platform. Reach the three
  checkpoints (teal platforms, crystals light up green) in order, then the
  golden arch.
- Fall off and you reappear at your last checkpoint; the clock keeps running.
  **R** restarts the run; walking back onto the start platform also resets it.
- The leaderboard (top right) shows the best time per account, from Postgres.

The **server judges every run**: it starts the clock, checks checkpoints in
order against the positions it accepted, and stops the clock at the finish.
The client only displays what it's told, so a modified client can't submit a
fake time.

Levels are plain data in `shared/src/levels/` (boxes, spawn, kill height, and
for parkour the start/checkpoint/finish zones), used by both client and
server. `courseKit.ts` has helpers for platforms, checkpoints and the finish
arch. To add a course, copy a trial, register it in `levels/index.ts`, and
check it's beatable with real physics. Varying the bot's jump timing and aim
shows how forgiving it is:

```sh
node client/scripts/simulate-course.ts trial1   # bot runs the course in Rapier
node client/scripts/simulate-course.ts trial3 0.6 4   # ...jumping 0.6 m early with 4 deg aim error
GAME_PIN=... node server/scripts/parkour-check.ts http://game:8080   # rules, via the server
```

## Tag and infection

Both are played in **the Courtyard**, an arena with a fountain, pillars,
raised walkways with ramps, low walls you can vault and tall ones you can't.

- **Tag:** one player is **It** (red aura, red hat, red glow around your
  screen). Look at someone within reach (the crosshair turns into a red ring)
  and **click** to tag them; they become It. No instant tag-backs: the new It
  waits 2 s. Least total time as It wins.
- **Infection, the spreading curse:** one wizard starts cursed (two if 6+ are
  playing). Anyone the cursed touch is cursed too, for the rest of the round.
  Survivors win if anyone is uncursed when time runs out; the curse wins if
  it takes everyone. Late joiners arrive cursed.

**Bots:** press **Esc** in a tag or infection room and use **Bots [−] [+]**
in the pause panel (anyone in the room can, up to 6). Bots count as players,
so one person plus a bot is enough for a round. Bot chasers hunt the nearest
runner; bot runners flee from chasers and otherwise wander. They move at
~85% of your running speed, and their tags go through the same server checks
as yours. They leave when the last real player does.

Bots run on the server. To get around walls they use a **walking map**
(`server/src/bots/NavGrid.ts`): a 2D grid of floor heights built from the
level's boxes, with A* pathfinding. That's not physics; the server still has
no collision engine. A bot can hop up 1 m (crates, low walls, the fountain
rim) and drop down, so ramps work and walls and pillars don't.

**Rounds:** a round starts once 2+ players are in the room: 5 s countdown
(everyone is moved to a different spawn point), 3 minutes of play (chasers
can't tag for the first 3 s, so runners can scatter), then 8 s of results,
then the next countdown. If players leave and fewer than 2 remain, the round
is cancelled rather than declaring a winner.

**Shared code:** both modes are the same rules engine,
`server/src/rooms/ChaseRoom.ts` (tag checks, who's chasing), on top of
`RoundRoom.ts` (the round cycle, bots and XP payout, shared with the battle
royale).
`TagRoom.ts` and `InfectionRoom.ts` only define what a tag *does*, when a
round ends early, and the results.

**Tags are checked by the server:** the round must be live, you must be a
chaser and off cooldown, and the target must have been within 2.2 m of you
at some point in the last 0.4 s. That window is *lag compensation*: you see
other players ~120 ms in the past and your click takes time to arrive, so
checking only the target's newest position would reject fair tags.

```sh
# Plays tag and infection rounds with fake players and checks the rules.
# Needs shortened rounds (testing only):
ROUND_TIME_SCALE=0.25 GAME_PIN=... SESSION_SECRET=... node server/src/index.ts
GAME_PIN=... node server/scripts/chase-check.ts http://localhost:3000
GAME_PIN=... node server/scripts/bots-check.ts http://localhost:3000   # bots: add/remove, no wall clipping, tagging
```

## Battle royale

**Last wizard standing**, in **the Ruins**: an 84 m walled bowl with a raised
dais in the middle, a ring of broken walls (tall ones to hide behind, waist
high ones to shoot over), arches, scattered cover, and four watchtowers with
ramps. Same round cycle as tag: 2+ players (bots count) to start, a 5 s
countdown, then play until one wizard is left.

- **Health 100.** A **Ward** shield (up to 50) soaks damage first. Out of
  health and you're out of the round: you keep walking around as an invisible
  spectator (the screen goes grey) until the next round, or press Esc to leave.
- **Left click** casts the spell you picked in the hub's Spellbook. They share
  one cooldown, so switching can't fire faster:
  - **Arcane Bolt** (everyone): 20 damage, a fast glowing projectile you can
    see coming and dodge. 0.55 s cooldown.
  - **Frost Shard** (Chapter I): 14 damage, and the target moves at 60% speed
    for 1.5 s. 0.55 s cooldown.
  - **Spark Volley** (Chapter II): three sparks in a 12-degree fan, 9 damage
    each, but they only fly 20 m. 0.75 s cooldown.
- **Fireball** (right click): needs charges from a **Fire Tome** pickup (3 per
  tome, up to 6). Slower, 40 on a direct hit, and it explodes: 25 down to 8
  damage to anyone within 3.5 m, unless a wall is between them and the blast.
- **Pickups** float on glowing spots around the arena (the dais, the tower
  tops, inside the arches and the wall ring). Walk into one to take it:
  Fire Tome, Healing Draught (+40 health) or Ward (+50 shield). You only pick
  up what you can use; a taken pickup comes back after 25 s.
- **The storm.** The safe circle starts covering the whole arena, then
  shrinks in four stages to nothing. Each stage waits (the next circle shows
  as a white ring on the ground), then closes in. Outside it you take 5, 8, 12,
  then 20 damage a second (30 once it covers everything), and the screen goes purple. About 3.5 minutes in
  all; most rounds end sooner.
- **Bots:** Esc, then Bots [+]. They head into the circle when the storm
  comes, strafe and shoot when they see someone (aiming a little ahead, with
  some error so moving targets can dodge), and grab potions and tomes when
  hurt or out of fireballs. They pause briefly before the first shot at
  someone they just spotted.

**What the server decides:** everything that matters. A cast message only
says "this spell, from here, in this direction". The server checks the
cooldown, the charges, and that "from here" is within 1.5 m of where it
thinks your eyes are (otherwise it uses its own idea). Then it flies the
spell itself, 20 steps a second, testing each step's line segment against
the level's boxes and every player's capsule
(`shared/src/levels/geometry.ts`). That's straight-line math, not a physics
engine: the server still has no collision code for movement. Health, damage,
pickups, the storm and the winner all live on the server.

**Prediction:** your own spells are drawn the moment you click (waiting for
the server would feel laggy); when the server's copy arrives it takes over.
Everyone's spells are drawn on the server's clock, so a bolt flying at you is
where the server thinks it is, and dodging works the way it looks.

Numbers (damage, speeds, cooldowns, storm stages, pickups) are all in
`shared/src/combat.ts`; the arena is `shared/src/levels/arena.ts`.

```sh
node client/scripts/walk-arena.ts   # spell-vs-wall math vs Rapier; ramps walkable; spawns/pickups reachable
ROUND_TIME_SCALE=0.25 GAME_PIN=... SESSION_SECRET=... node server/src/index.ts
GAME_PIN=... node server/scripts/royale-check.ts http://localhost:3000   # combat rules, round, XP
GAME_PIN=... node server/scripts/bots-check.ts http://localhost:3000     # includes a bots-only royale round
```

## Arenas (battle royale)

Nine arenas, three of each size, all with high ground: ramps lead up
everything you're meant to stand on.

| Small (48 m) | Medium (84 m) | Large (120 m) |
|---|---|---|
| **The Pit**: a sunken floor under a raised rim, a tower in the middle | **The Ruins**: the dais, the wall ring, corner watchtowers | **The Highlands**: mesas from 2.5 to 8 m over open grass |
| **Twin Towers**: two 6 m towers and the bridge between | **Sky Bridges**: four 7 m towers joined by a ring of bridges | **The Fortress**: walk the battlements, over the corner towers, hold the keep |
| **The Ziggurat**: a stepped pyramid, corner watchtowers | **The Canyon**: two plateaus, bridges across, a mesa below | **The Rooftops**: a city of roofs, ramps up, a bridge ring at 6 m |

- **Voting:** while the room is waiting and on the results screen (now 12 s),
  one arena of each size is on offer: Esc to vote, the tally shows on screen.
  When the next countdown starts, the most votes wins (ties, or no votes:
  random among the leaders). The world is rebuilt in place, no reconnect.
- **The storm** starts at each arena's size (35 / 50 / 72 m) and its stages
  scale with it.
- **Falling** more than 4 m hurts: 8 per meter beyond (an 8 m fall is 32).
  Only real falls count (falling faster than 9 m/s at some point), so walking
  down a ramp, however long, never does.
- **Landing on someone** while falling hurts them (25 + 3 per meter fallen,
  shields don't help), bounces you off, and spares you the fall damage.
  Once per fall.
- Both are worked out by the server from the positions players send
  (it has no collision for movement), and admins are immune as usual.

Arenas are built with a small kit (`shared/src/levels/arenaKit.ts`: blocks,
ramps between two heights, bridges, walls) in `shared/src/levels/arenas.ts`.
Bridges and arches are marked `overhead`: the bots' walking map plans one
floor per spot, so bots walk under them and don't use them.

```sh
node client/scripts/walk-arenas.ts   # every arena: spawns open, pickups reachable by bots, and
                                     # the real movement can follow the bots' route to each
# A bots-only round in one arena (ROYALE_ARENA pins the arena, testing only):
ROYALE_ARENA=fortress ROUND_TIME_SCALE=0.25 ... node server/src/index.ts
GAME_PIN=... node server/scripts/arena-bots-check.ts http://localhost:3000 fortress
GAME_PIN=... node server/scripts/arena-check.ts http://localhost:3000   # vote, falls, stomps
```

`royale-check`, `classes-check` and `bots-check` are written for The Ruins:
run them against a server started with `ROYALE_ARENA=arena`.

## Abilities (battle royale)

Every class has two, on **E** and **R** (cooldowns show in their HUD slots):

| | E | R |
|---|---|---|
| **Wizard** | **Stone Wall**: a 4.5 x 2.6 m wall where you aim (up to 18 m), for 15 s. Cooldown 12 s | **Earth Pillar**: a 3.5 m pillar where you aim, for 12 s; aim at your feet to ride it up. 14 s |
| **Rogue** | **Shadow Step**: teleport up to 12 m where you look, not through walls. 9 s | **Vanish**: invisible for 4 s, or until you attack. 16 s |
| **Knight** | **Charge**: rush 11 m; everyone you plow through takes 35, is shoved aside and slowed for 1.2 s. 7 s | **Fortify**: heal 25, take 30% damage for 6 s, and nothing can slow or shove you. 13 s |

**More abilities unlock as you level**: each class keeps the two above, and
the rest of its list unlocks one at a time at levels 3, 5, 7, 9 and 11 (the
order in the table below). You pick which two go on E and R in the Esc
panel (under Class; saved per class in your loadout as `abil`); hover any
ability or class there for its numbers. The extra ones are deliberately over
the top, and bots never get them. Numbers in `shared/src/abilities.ts`, hover
text in `shared/src/abilityInfo.ts`.

| Class | Mastery abilities |
|---|---|
| **Wizard** | **Tornado** (rolls 30 m; catches enemies and monsters for 25, carries and spins them around the funnel for 1.6 s, then flings them), **Wall of Flame** (12 m line, 7 s, 24/s), **Pit to Hell** (3.6 m, 5 s: drags in, slows, 36/s), **Inversion** (30 m curse: your screen upside down for 10 s), **Shockwave** (9 m blast: 18 damage; enemies, bots and monsters thrown back) |
| **Knight** | **Null Zone** (7 m, 7 s: no ranged attacks at all inside, arrows included, and no Wizard/Rogue/Cleric abilities), **Giant Form** (8 s: double size, melee 1.6x and 1.5x reach, 35% less damage taken), **Chain Pull** (hook the first enemy in 20 m to you, 12 damage) |
| **Rogue** | **Mirror Images** (two copies run off for 7 s; players, bots and monsters fall for them; one hit breaks one), **Glide** (a high leap, then 9 s of very slow falling and 80% more speed, no fall damage), **Smoke Bomb** (5 m cloud, 8 s: anyone inside is hidden) |

Being thrown (Shockwave, Tornado, Chain Pull, the pit's drag) is a "knock"
message to that player's own client, which moves them; the server grants
the extra distance in their movement check. Check script: `mastery-check`
(needs an admin account, since admins have every unlock).

What the server does (all of it):
- **Walls and pillars** are placed where your aim meets something to stand
  on; one that would land on someone isn't placed (and costs nothing).
  While up, they're part of the level for everything: spells and arrows,
  line of sight, melee, and the bots' walking map (bots go around them).
- **Shadow Step** goes as far as your aim allows short of a wall, then comes
  back half a meter at a time until there's room to stand.
- **Vanish**: while hidden, the server doesn't send your position to anyone
  (so a modified client can't see you either); attacking ends it.
- **Charge** is your own movement, so the server allows the extra distance
  for that moment and checks your path for the first enemy.
- Bots use them too, when hurt: wizards wall off someone at range, rogues
  step away from someone close, knights fortify.

Numbers: `shared/src/abilities.ts`.

```sh
ROYALE_ARENA=arena ROYALE_STORM=off ROUND_TIME_SCALE=0.25 ... node server/src/index.ts
GAME_PIN=... node server/scripts/abilities-check.ts http://localhost:3000
```

`ROYALE_STORM=off` (testing only) turns the storm off for exact damage checks.

## Classes (battle royale)

Pick a class in the arena's pause panel (Esc). It's saved to your account;
picked mid-round, it applies from the next round. Classes only exist in the
battle royale.

| | Knight | Rogue | Wizard | Cleric |
|---|---|---|---|---|
| Health | 180 | 85 | 100 | 120 |
| Speed | 92% | 112% | 100% | 97% |
| Defense | takes 15% less damage | none | none | takes 10% less damage |
| Main hand (1) | **Sword**: 28, hits everyone in a 110-degree arc, 2.8 m reach | **Longbow**: 34, arrows fly 90 m and drop with distance | your **Spellbook spell** | **Mace**: 24, 2.6 m reach |
| Backup (2) | **Shield**: blocks 80% from the front (140 degrees), 75% speed while held; click to bash (10) | **Daggers**: 14, fast; double from behind (backstab) | **Staff**: 18, close range | **Holy Light**: 15, straight shots, 42 m |

The **Cleric** hits softer than the others and makes up for it by healing:
**Healing Light** (E, 12 s) heals 35, and every teammate within 9 m in a team
round or the boss fight; **Divine Smite** (R, 11 s) marks a spot up to 25 m
away and a pillar of light lands 0.7 s later (40 within 3 m, and slowed).
Level 11 adds **Sanctuary** (a 6 m circle healing you and teammates 12/s for
6 s), **Aegis** (a 50 shield on the teammate you aim at, or yourself) and
**Judgment** (the enemy you aim at takes 35% more damage for 15 s). Bots
don't play Clerics.

- **1 / 2 / mouse wheel** switch hands. Switching takes 0.4 s (no attacking
  meanwhile), so it can't be used to skip a cooldown; both hands share one
  cooldown.
- **Right click** is still a Fireball, for every class (Fire Tome pickups).
- **Ready vote:** a battle royale round (and each attempt at the Tyrant)
  starts only when more than half of the real players have voted: press
  **Enter** between rounds, or the button at the top of the Esc panel's
  column. Bots don't count. `ready-check` tests it (the test server runs
  with `ROUND_READY=off` otherwise, so other checks start rounds on their own).
- **Teams or Free-for-all:** a switch in the Esc panel (anyone can flip
  it; it applies from the next round). In Teams, each player picks Red or
  Blue there (or leaves it to be balanced at the start), and each bot's team
  is set in the bot list. Teams show as colored rings at players' feet. You
  can't hurt teammates (your spells pass through them), and the last team
  standing wins: 50 XP each for the winners. `teams-check` and `ready-check`
  test it (`ROYALE_TEAMS=1` pins team rounds, testing only).
- **Bots' classes** are set per bot in the Esc panel's bot list (any class,
  Cleric included: bot Clerics fight up close and heal when hurt).
- **Bots** take turns: Knight, Rogue, Wizard (six bots = two of each).
  Knights charge in and raise the shield when hurt at range, Rogues keep
  their distance and pull daggers up close, Wizards cast and use the staff
  up close. Rogue bots aim their arrows with the arc in mind.

**What the server checks:** your class and the hand you hold live on the
server. A click sends only "attack, from here, this way"; the server picks
the weapon. Swings are judged like tags (who was within reach and in front
of you over the last 0.3 s, with no wall in between); the shield, defense
and backstabs are worked out from where the hit came from and where the
target is facing. Arrows fly like spells, with gravity, on the server.
Casting a spell directly is refused unless you're a Wizard holding your
spell; "arrow" can't be cast at all.

Class numbers: `shared/src/classes.ts`; the arrow: `shared/src/combat.ts`.

```sh
GAME_PIN=... node server/scripts/classes-check.ts http://localhost:3000   # health, hands, reach, walls, shield, backstab, arrows
```

## Trial VII: the Storm Tyrant (boss fight)

The seventh trial isn't a course: it's a boss fight, fought with your
**battle royale class** (Knight, Rogue or Wizard; change it in the Esc
panel). Its portal is on the Sanctum's east wall, behind a barrier until
Chapter VI is done.

- **The arena** (`shared/src/levels/trial7.ts`): an 80 x 80 m ruin with
  pillars to hide behind (they stop boulders and orbs), four raised
  platforms with ramps, lava pools, jump pads, and potions and wards.
- **The Tyrant** (`server/src/bosses/Boss.ts`, numbers in
  `shared/src/bosses.ts` `TYRANT`) walks after the nearest fighter on the
  bots' walking map. Phase 1: ground slam (a shockwave ring: jump it),
  boulders, and a leap at whoever is furthest away (a marked circle; it lands
  3 m short of you). Below 66%: lightning, rings of storm orbs, and storm
  wolves (two at a time, at most four). Below 33%: meteor rain and more speed.
  It has 2200 health alone, +60% for each extra fighter.
- **A round is an attempt** (`server/src/rooms/BossRoom.ts`, built on the
  battle royale room with the storm, the vote and friendly fire turned off).
  Everyone still standing when it falls clears the trial: a best time, 600 XP
  the first time (Chapter VII and the Tyrant's crown), less after. If
  everyone goes down, it heals and you try again. **Bots** added from the
  Esc panel fight on your side.

## Story, spells and unlocks

**The story** is told through the trials and the hub. Headmaster Orrin Vale
vanished into the storm (the battle royale's), leaving three trials for a
successor; three more, through the Sanctum, follow him into it; and in the
seventh, the storm comes back as the Storm Tyrant. Each trial is a chapter: its opening text appears when you
arrive, and its ending (plus what it unlocked) the first time you clear it.
A chapter is complete once you have a time on its trial. The text is in
`shared/src/story.ts`.

**In the hub:**
- **Spellbook** (lectern, left of the arrival path): choose your left-click
  spell; see your perks.
- **Wardrobe** (right of the path): hat and robe. Everyone in the hub sees
  the change right away.
- **The Chronicle** (board on the far side of the plaza): the chapters so far.
- **Hidden areas** behind magic barriers, opened by chapters: the **Spell
  Garden** (southwest corner), the **Observatory** (southeast, with a tower),
  and the **Headmaster's Sanctum** (the academy's great doors open). Each has a
  lore tablet.

Walk up to a station and press **E**; Esc or Close to leave it.

**Unlocks** (`shared/src/unlocks.ts`). They add options, not power: the new
spells are alternatives for the same slot, perks only move you, the rest is
looks.

| Unlock | How |
|---|---|
| Crimson robe | Level 2 |
| **Double Jump** (Space again in mid-air) | Level 3 |
| Emerald robe | Level 4 |
| **Blink Dash** (Q: ~3.5 m burst, every 2 s) | Level 5 |
| Tall hat | Level 6 |
| Midnight robe | Level 7 |
| Gold robe | Level 10 |
| Each class's extra E/R abilities, one at a time (pick them in the arena's Esc panel) | Levels 3, 5, 7, 9, 11 |
| **Frost Shard**, the Spell Garden | Chapter I (clear Trial I) |
| **Spark Volley**, the Observatory, Starry hat | Chapter II |
| The Sanctum (and Trial IV), Headmaster's crown, Ivory robe | Chapter III |
| Trial V, Storm robe | Chapter IV |
| Trial VI, Ember robe | Chapter V |
| Stormcaller's hat, Trial VII | Chapter VI |
| Tyrant's crown | Chapter VII |

**Perks are off in the trials**, so trial times stay comparable.

**What the server checks:** your saved loadout (spell, hat, robe) lives in
the `accounts.loadout` column (migration `002_loadout.sql`). Every time it's
read or changed, each choice is checked against your unlocks, worked out
fresh from your XP and best times; anything locked falls back to the
default. Loadouts can only be changed in the hub (at most every 0.4 s, since
each is a database write). In the arena, casting a spell you haven't
unlocked is ignored. The barriers are the exception: movement is
client-side, so each player's game just leaves out the barriers they've
opened, and a modified client could walk through one. Behind them is only
scenery and lore, so that's fine. Perks are the same: the server's movement
check already allows short bursts (built for lag spikes), and a dash fits
within it.

```sh
GAME_PIN=... node server/scripts/unlocks-check.ts http://localhost:3000   # clears Trial I for real, checks what unlocks
node client/scripts/walk-hub.ts   # also: areas blocked when locked, reachable when open
```

## Admin accounts

An admin **can't be hurt** (spells, the storm), **can fly** (F toggles it;
Space up, C down, Shift faster; flying passes through walls), and has
**everything unlocked**. Everyone sees an admin's gold name tag with a star.
Admins earn no XP and their trial times aren't recorded (they can fly, after
all). In a battle royale an admin is in the round but can't be eliminated,
so with an admin playing, a round ends when everyone else is out or time
runs out.

The flag is `accounts.is_admin` (migration `003_admin.sql`). Nothing in the
API or the game can set it; only the server's command line can:

```sh
# On game: make an account an admin, creating it with a random password if it
# doesn't exist. The new username and password go only into the file.
cd ~/wizard-academy
umask 077; docker compose exec -T server node server/src/tools/make-admin.ts Admin > ~/admin-credentials.txt
cat ~/admin-credentials.txt   # then store it somewhere safe and delete the file

# Take admin away again:
docker compose exec postgres psql -U wizard -d wizard -c "UPDATE accounts SET is_admin = false WHERE username_lower = 'admin'"
```

On the server, admins skip the movement speed check (that's what flying
is); everything else about them is checked as usual.

## Graphics

- **The sky** (`client/src/Sky.ts`) is a dome with a color gradient, a sun
  and its glow, and drifting low-poly clouds; the fog uses the horizon color.
  Two looks: day (most places) and dusk (the battle royale arena), set per
  level with `skyStyle`.
- **Every block** is shaded a little darker toward the bottom, with a slight
  random tint. All the solid blocks of a level are merged into one mesh, so
  the whole level is one draw call (it was ~390).
- **Quality** (the pause panel's "Graphics: High/Low" button, remembered per
  browser; phones start on Low). High adds grass tufts, pebbles on sand
  (`client/src/levels/Decor.ts`, instanced: one draw call each), clouds,
  sharper shadows, and full resolution on high-DPI screens. Measured in the
  hub: Low 72 draw calls / 7k triangles, High 78 / 79k. Both are light for
  any laptop's graphics chip.

## Access PIN

Every request needs a session cookie, except the PIN page itself. Without one,
any URL (including the game's JavaScript) returns only the small PIN page.

**See the current PIN:** `grep GAME_PIN ~/wizard-academy/.env` on `game`.

**Change the PIN:** edit `GAME_PIN` in `.env`, then run `docker compose up -d`.
Compose recreates the server with the new value. Everyone is logged out,
because the PIN is part of the cookie signature. Rotating `SESSION_SECRET`
does the same without changing the PIN.

How it works:

- Caddy asks the game server (`/auth/check`) about every request before
  serving it (`forward_auth`). The server checks the cookie again on the
  WebSocket upgrade, along with the `Origin` header, so other websites can't
  open a socket with a visitor's cookie.
- The cookie is `wa_session`, valid 30 days: `HttpOnly`, `SameSite=Lax`,
  `Secure` when `COOKIE_SECURE=true`. Its value is an expiry time plus an
  HMAC-SHA256 signature, so it can't be forged or extended.
- PINs are compared in constant time (both sides are hashed, then compared
  with `timingSafeEqual`).
- **Rate limit:** 5 *failed* attempts per IP per 15 minutes. IPv6 visitors are
  grouped by /64, since one person typically controls a whole /64. There is
  also a global cap of 100 failures per 15 minutes. If someone with many
  addresses trips it, new logins pause for a while, but people already
  logged in keep playing.
- **Which IP counts:** Caddy sends the server `X-Client-IP`, overwriting
  anything the client sent. On the tailnet listener (`:8080`) that is the real
  connecting address, and a `CF-Connecting-IP` header is ignored. On the
  tunnel listener (`127.0.0.1:8081`), where only cloudflared connects, it is
  `CF-Connecting-IP`, the visitor's address as seen by Cloudflare.

**`COOKIE_SECURE`:** `true` (the current setting). Secure cookies only travel
over HTTPS, so logging in at `http://game:8080` doesn't work; use the public
HTTPS address. Set it to `false` temporarily for plain-HTTP testing over the
tailnet, then back to `true`.

## What the server checks on the WebSocket

- Messages over 512 bytes are dropped before parsing; every message must be
  valid JSON of a known type, with finite numbers in range and a name matching
  `[A-Za-z0-9 _-]{1,16}`. Anything else disconnects the client.
- Each connection may send 30 messages/second (bursts up to 60). There are at
  most 16 connections per IP (friends in one house share a public IP) and 64
  in total.
- **Movement sanity check** (`server/src/MoveCheck.ts`): each player has a
  per-axis "distance budget" that refills at the fastest legal speed. Moves
  that overspend it (speed hacks, teleporting, flying) are rejected, and the
  player is snapped back to their last valid position. Five rejections in 30
  seconds is a kick. The budget absorbs normal lag bursts.
- **Respawning** after falling off the level is done by the server, and only
  when the player really is below the level.
- **Known limit:** movement is client-authoritative and the server has no
  collision geometry (by design), so it checks *speed* but not whether you're
  standing on something. A cheat client could "float" across gaps at running
  speed. It still has to pass through every checkpoint in order, and times
  are tied to the account that set them.

## Cloudflare Tunnel

The public address is **https://wizardgame.spencersmith.win**. No router ports
are forwarded: cloudflared on this VM makes outbound connections to Cloudflare,
and Cloudflare sends visitors down them.

| | |
|---|---|
| Tunnel | `wizardgame`, ID `ffb64c12-a7a4-4c29-9d92-7385cf130c0b` (separate from the website's `spencersmith-web`) |
| DNS | `wizardgame.spencersmith.win` CNAME to the tunnel, created by `cloudflared tunnel route dns` |
| Config | `/etc/cloudflared/config.yml` (not in git) |
| Credentials | `/etc/cloudflared/<tunnel-id>.json`, root-only. **Secret; never commit it.** Anyone with it can run the tunnel. |
| Service | systemd `cloudflared.service`, enabled at boot |

`config.yml` sends `wizardgame.spencersmith.win` to Caddy's tunnel listener,
`http://127.0.0.1:8081`, and everything else to the required catch-all,
`http_status:404`. TLS is terminated at Cloudflare; the hop from cloudflared to
Caddy is plain HTTP over loopback.

How it was set up (as root):

```sh
cloudflared tunnel login                      # authorize spencersmith.win in the browser
cloudflared tunnel create wizardgame
cloudflared tunnel route dns wizardgame wizardgame.spencersmith.win
# move the credentials JSON to /etc/cloudflared/, write config.yml
cloudflared tunnel --config /etc/cloudflared/config.yml ingress validate
cloudflared service install
rm /root/.cloudflared/cert.pem
```

`cert.pem` from `tunnel login` can create tunnels and DNS records for the whole
zone, so it was deleted after setup. Running the tunnel only needs the
credentials file. To manage tunnels again (new hostname, delete), run
`cloudflared tunnel login` again first, and delete `cert.pem` afterwards.

Useful commands:

```sh
systemctl status cloudflared
journalctl -u cloudflared -f
sudo systemctl restart cloudflared     # after editing config.yml
```

On the tunnel listener only, Caddy redirects `http://` to `https://` (based on
Cloudflare's `X-Forwarded-Proto`) and sends HSTS, so the PIN is never posted
unencrypted. HTML responses carry `Cache-Control: no-transform`, which stops
Cloudflare from injecting its analytics and bot-detection scripts. The CSP
would block those anyway, but this keeps the page free of third parties.

**To take the game offline** without touching anything else:
`sudo systemctl stop cloudflared` (tailnet access keeps working).

## Host firewall

The VM shares a layer-2 network with the rest of the apartment building, so it
is locked to the tailnet:

- `/etc/iptables/rules.v4` and `rules.v6` are **hand-written** and loaded at
  boot by `netfilter-persistent`. INPUT accepts loopback, established traffic,
  `tailscale0`, and Tailscale's UDP port; everything else from the LAN is
  dropped. **Do not run `netfilter-persistent save`**: it would bake
  Tailscale's and Docker's own chains into the files.
- Docker-published ports skip the INPUT chain, so a `DOCKER-USER` rule drops
  new connections that arrive on `eth0`. Caddy is only published on the
  Tailscale IP (`:8080`) and `127.0.0.1` (`:8081`).
- `net.ipv4.ip_nonlocal_bind=1` (`/etc/sysctl.d/90-game-bind.conf`) lets Docker
  bind the Tailscale IP at boot even if Tailscale hasn't come up yet.

Both containers run read-only, with all Linux capabilities dropped, as
non-root users, with memory and process limits.

## Repo layout

```
shared/src/      message types and constants used by both client and server
server/src/      HTTP + WebSocket server, PIN gate, rooms
  auth.ts          PIN check, session cookie, PIN page
  accounts.ts      accounts, argon2id, login cookie, XP, best times
  api.ts           /api/register, /login, /logout, /me
  db.ts            Postgres pool + migration runner
  xp.ts            XP amounts
  limits.ts        rate limiters
  MoveCheck.ts     movement sanity check
  validate.ts      WebSocket message validation
  rooms/Room.ts    base class every game mode extends
  rooms/ParkourRoom.ts  checkpoints, timer, leaderboard
  rooms/RoundRoom.ts    round cycle, bots, XP payout (tag, infection, royale)
  rooms/ChaseRoom.ts    shared tag/infection engine (tag checks, chasers)
  rooms/TagRoom.ts, rooms/InfectionRoom.ts  the two rule sets
  rooms/PlaygroundRoom.ts  free movement
  rooms/HubRoom.ts      the academy hub: arrival spots, portal player counts
  rooms/RoyaleRoom.ts   battle royale: spells, damage, pickups, the storm
server/migrations/ numbered SQL schema files
shared/src/levels/  level data (boxes, zones, portals) for client and server
shared/src/rooms.ts room list: id, name, level, mode
shared/src/progression.ts  XP -> level curve
shared/src/combat.ts       spells, health, pickups, storm stages
shared/src/story.ts        chapters and lore text
shared/src/unlocks.ts      what unlocks when, loadouts, hats and robes
shared/src/levels/geometry.ts  line-vs-box and line-vs-player tests (spell hits)
server/src/bots/   server-side bots: NavGrid (walking map + A*), BotWalker
                   (path following), ChaseBot and RoyaleBot (brains)
server/scripts/  test bot, security-check, parkour-check, chase-check, bots-check, hub-check, royale-check, unlocks-check, story-check
client/scripts/  simulate-course, walk-hub, walk-arena (physics bots)
client/src/royale/ battle royale client: spells, storm, pickups, HUD
client/src/hub/    the Spellbook / Wardrobe / Chronicle window
client/src/StoryCard.ts  chapter text in the trials
client/src/      game client (Game.ts is the main loop)
Caddyfile        static files, /ws proxy, security headers
```

## Development without Docker

```sh
npm install
# Needs a Postgres: e.g. PGlite (Postgres in WebAssembly, no install), one connection:
npx @electric-sql/pglite-socket --port=5433 &
DATABASE_URL=postgres://postgres@127.0.0.1:5433/postgres PG_POOL_MAX=1 \
GAME_PIN=123456 SESSION_SECRET=$(openssl rand -hex 32) COOKIE_SECURE=false \
  npm run dev:server   # game server on :3000, restarts on change
npm run dev:client   # Vite dev server on :5173, proxies /ws and /auth to :3000
npm run typecheck
```

The dev server doesn't gate the page, but the API and WebSocket still need a
session: open `http://localhost:5173/auth/check` once and enter the PIN, then
log in on the game page.
