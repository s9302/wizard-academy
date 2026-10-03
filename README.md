# Wizard Academy

A small multiplayer low-poly 3D browser game: walk, run, and jump around in
first person with friends. Built in phases; currently **Phase 5** done (accounts,
XP and levels, best times in Postgres).

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
`accounts-check` (run it last: it trips the login rate limit for your IP).


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
| Clearing it again | a quarter of that, +25 for a new personal best |
| Finishing a tag or infection round | 20 |
| Tag: least time as It | +40 |
| Infection: surviving the curse | +50 |
| Each tag / curse you land (max 10 per round) | +5 / +10 |
| Rounds with only you and bots | half XP (practice) |

**Levels:** level 2 needs 100 XP, then each level needs 50 more than the last
(`shared/src/progression.ts`). Unlocks arrive in Phase 8.

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

## Parkour

On the join screen, pick a trial (or the Playground). Until the hub arrives in
Phase 6, that menu is how you choose a room.

Press **Esc** to pause; the pause panel has **Exit to menu**, which leaves the
room so you can pick a different one without reloading the page.

| Trial | What it asks of you |
|---|---|
| I: The Floating Steps | The gentle one: wide stones, a couple of 4 m running jumps |
| II: The Spiral Spire | Three laps, ~20 running jumps in a row that each climb 0.8 m onto 1.5 m stones; a slip costs a lap |
| III: The Shattered Bridge | 6 m running leaps, 1 m pillars that each rise a full metre, a 0.4 m tightrope |

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
`server/src/rooms/ChaseRoom.ts` (round cycle, tag checks, who's chasing).
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
  are tied to names only until Phase 5 adds accounts.

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
server/migrations/ numbered SQL schema files
  limits.ts        rate limiters
  MoveCheck.ts     movement sanity check
  validate.ts      WebSocket message validation
  rooms/Room.ts    base class every game mode extends
  rooms/ParkourRoom.ts  checkpoints, timer, leaderboard
  rooms/ChaseRoom.ts    shared tag/infection engine (rounds, tag checks)
  rooms/TagRoom.ts, rooms/InfectionRoom.ts  the two rule sets
  rooms/PlaygroundRoom.ts  free movement
shared/src/levels/  level data (boxes, zones) for client and server
shared/src/rooms.ts room list: id, name, level, mode
shared/src/progression.ts  XP -> level curve
server/src/bots/   server-side bots: NavGrid (walking map + A*), ChaseBot (brain)
server/scripts/  test bot, security-check, parkour-check, chase-check, bots-check
client/scripts/  simulate-course (physics bot)
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
