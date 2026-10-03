# Wizard Academy

A small multiplayer low-poly 3D browser game: walk, run, and jump around in
first person with friends. Built in phases; currently **Phase 2** (PIN gate,
input validation, anti-cheat basics, Cloudflare Tunnel).

- **Client:** TypeScript, Three.js (rendering), Rapier (physics and character
  controller), built with Vite.
- **Server:** Node.js 24 + TypeScript, WebSockets via `ws`. Node runs the `.ts`
  files directly, so the server has no build step.
- **Deployment:** Docker Compose. Caddy serves the built client and proxies
  `/ws` to the game server.

## Where it runs

VM 104 `game` on `pve2` (Ubuntu 24.04), in `~/wizard-academy` as user `spencer`.

| Address | Who can reach it |
|---|---|
| `http://game:8080` (Tailscale IP) | Tailnet devices only |
| `http://127.0.0.1:8081` | The VM itself: this is where cloudflared connects |
| `https://wizardgame.spencersmith.win` | The internet, via the Cloudflare Tunnel (once set up) |

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
# fill in TAILNET_IP (tailscale ip -4), GAME_PIN, SESSION_SECRET (openssl rand -hex 32)
docker compose up -d --build
```

`.env` is gitignored. Compose refuses to start if `TAILNET_IP`, `GAME_PIN` or
`SESSION_SECRET` is missing, and the server refuses a PIN shorter than 6
characters or a secret shorter than 32.

## Testing

- Open `http://game:8080` on a tailnet device, enter a name, click into the
  page to capture the mouse. **WASD** move, **Shift** run, **Space** jump,
  **Esc** releases the mouse.
- Open a second browser window (or have someone else on the tailnet join) to
  see another wizard move.
- No second person handy? Run test bots that log in with the PIN and walk in
  circles near spawn (at most 4 per IP, the per-IP connection limit):

  ```sh
  npm install                 # once, on a machine with Node 24
  GAME_PIN=... node server/scripts/bot.ts http://game:8080 3
  ```

- Check the in-game protections (speed/teleport/fly rejection, respawn rules,
  flood limit) after changing `MoveCheck.ts` or the limits:

  ```sh
  GAME_PIN=... node server/scripts/security-check.ts http://game:8080
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

**`COOKIE_SECURE`:** `true` in production. Secure cookies only travel over
HTTPS, so once it's `true`, logging in at `http://game:8080` stops working: use
the public HTTPS address instead. Set it to `false` only for plain-HTTP testing.

## What the server checks on the WebSocket

- Messages over 512 bytes are dropped before parsing; every message must be
  valid JSON of a known type, with finite numbers in range and a name matching
  `[A-Za-z0-9 _-]{1,16}`. Anything else disconnects the client.
- Each connection may send 30 messages/second (bursts up to 60). There are at
  most 4 connections per IP and 64 in total.
- **Movement sanity check** (`server/src/MoveCheck.ts`): each player has a
  per-axis "distance budget" that refills at the fastest legal speed. Moves
  that overspend it (speed hacks, teleporting, flying) are rejected, and the
  player is snapped back to their last valid position. Five rejections in 30
  seconds is a kick. The budget absorbs normal lag bursts.
- **Respawning** after falling off the level is done by the server, and only
  when the player really is below the level.

## Cloudflare Tunnel

_Not set up yet._ It will be a new named tunnel on this VM for
`wizardgame.spencersmith.win`, pointing at Caddy's tunnel listener on
`127.0.0.1:8081`, separate from the website's tunnel.

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
  limits.ts        rate limiters
  MoveCheck.ts     movement sanity check
  validate.ts      WebSocket message validation
  rooms/Room.ts    base class every game mode extends
  rooms/TestRoom.ts  Phase 1 room
server/scripts/  test bot
client/src/      game client (Game.ts is the main loop)
Caddyfile        static files, /ws proxy, security headers
```

## Development without Docker

```sh
npm install
GAME_PIN=123456 SESSION_SECRET=$(openssl rand -hex 32) COOKIE_SECURE=false \
  npm run dev:server   # game server on :3000, restarts on change
npm run dev:client   # Vite dev server on :5173, proxies /ws and /auth to :3000
npm run typecheck
```

The dev server doesn't gate the page, but the WebSocket still needs a session:
open `http://localhost:5173/auth/check` once and enter the PIN.
