# Wizard Academy

A small multiplayer low-poly 3D browser game: walk, run, and jump around in
first person with friends. Built in phases; this is **Phase 1** (movement and a
shared room).

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
| `http://127.0.0.1:8080` | The VM itself (cloudflared will use this in Phase 2) |

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
# set TAILNET_IP to the output of: tailscale ip -4
chmod 600 .env
docker compose up -d --build
```

`.env` is gitignored. Compose refuses to start if `TAILNET_IP` is missing,
rather than falling back to listening on every interface.

## Testing

- Open `http://game:8080` on a tailnet device, enter a name, click into the
  page to capture the mouse. **WASD** move, **Shift** run, **Space** jump,
  **Esc** releases the mouse.
- Open a second browser window (or have someone else on the tailnet join) to
  see another wizard move.
- No second person handy? Run test bots that walk in circles near spawn:

  ```sh
  npm install                 # once, on a machine with Node 24
  node server/scripts/bot.ts ws://game:8080/ws 3
  ```

## Access PIN

_Phase 2._ The PIN gate is not built yet, and the game must not be exposed to
the internet until it is.

## Cloudflare Tunnel

_Phase 2._ Not set up yet. It will be a new named tunnel on this VM pointing at
Caddy on `127.0.0.1:8080`, separate from the website's tunnel.

## Host firewall

The VM shares a layer-2 network with the rest of the apartment building, so it
is locked to the tailnet:

- `/etc/iptables/rules.v4` and `rules.v6` are **hand-written** and loaded at
  boot by `netfilter-persistent`. INPUT accepts loopback, established traffic,
  `tailscale0`, and Tailscale's UDP port; everything else from the LAN is
  dropped. **Do not run `netfilter-persistent save`**: it would bake
  Tailscale's and Docker's own chains into the files.
- Docker-published ports skip the INPUT chain, so a `DOCKER-USER` rule drops
  new connections that arrive on `eth0`, and Caddy is only published on
  `127.0.0.1` and the Tailscale IP.
- `net.ipv4.ip_nonlocal_bind=1` (`/etc/sysctl.d/90-game-bind.conf`) lets Docker
  bind the Tailscale IP at boot even if Tailscale hasn't come up yet.

Both containers run read-only, with all Linux capabilities dropped, as
non-root users, with memory and process limits.

## Repo layout

```
shared/src/      message types and constants used by both client and server
server/src/      WebSocket server, connection handling, rooms
  rooms/Room.ts    base class every game mode extends
  rooms/TestRoom.ts  Phase 1 room
server/scripts/  test bot
client/src/      game client (Game.ts is the main loop)
Caddyfile        static files, /ws proxy, security headers
```

## Development without Docker

```sh
npm install
npm run dev:server   # game server on :3000, restarts on change
npm run dev:client   # Vite dev server on :5173, proxies /ws to :3000
npm run typecheck
```
