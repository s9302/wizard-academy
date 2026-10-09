// Ground-aimed area spells (Black Hole, Pit to Hell) land on the surface you
// aim at, in whichever arena the round is in. The server used to keep the
// first arena's walls and floors after a switch, so on a new arena a spell
// cast on top of something landed on the old arena's floor below.
//
// Rounds have to end for the arena to change, so run with bots and short
// rounds, and without ROYALE_ARENA:
//   ROUND_READY=off ROUND_TIME_SCALE=0.25 ... node server/src/index.ts
//   ADMIN_USER=... ADMIN_PASSWORD=... GAME_PIN=... node server/scripts/area-aim-check.ts http://localhost:3000

import WebSocket from "ws";
import type { FieldInfo } from "../../shared/src/abilities.ts";
import { EYE_HEIGHT, PLAYER_HALF_HEIGHT, PLAYER_RADIUS } from "../../shared/src/constants.ts";
import { LEVELS } from "../../shared/src/levels/index.ts";
import type { Box, Level } from "../../shared/src/levels/types.ts";
import type { ServerMsg, Vec3 } from "../../shared/src/protocol.ts";
import { signIn } from "./signIn.ts";

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const { GAME_PIN: pin, ADMIN_USER: adminUser, ADMIN_PASSWORD: adminPassword } = process.env;
if (!pin || !adminUser || !adminPassword) {
  console.error("Set GAME_PIN, ADMIN_USER and ADMIN_PASSWORD in the environment.");
  process.exit(2);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

const ws = new WebSocket(base.replace(/^http/, "ws") + "/ws", { headers: { cookie: await signIn(base, pin, adminUser, adminPassword) } });
let tp = 0;
let arena = "";
let options: string[] = [];
let field: FieldInfo | null = null;
let failed = "";
ws.on("message", (d) => {
  const m = JSON.parse(d.toString()) as ServerMsg;
  if (m.t === "welcome" && "levelId" in m) arena = (m as { levelId: string }).levelId;
  if (m.t === "teleport") tp = m.tp;
  if (m.t === "arena") arena = m.levelId;
  if (m.t === "arenaVote") options = m.options;
  if (m.t === "field" && (m.field.kind === "blackhole" || m.field.kind === "hellpit")) field = m.field;
  if (m.t === "abilityFailed") failed = m.reason;
});
await new Promise((r) => ws.on("open", r));
const send = (m: object) => ws.send(JSON.stringify(m));
send({ t: "hello", room: "royale" });
await sleep(800);
for (let i = 0; i < 3; i++) send({ t: "bots", action: "add" });
send({ t: "class", cls: "wizard" });
await sleep(200);
send({ t: "abilities", cls: "wizard", e: "blackhole", r: "hellpit" });

// The highest flat box top in a level that's wide enough to stand on.
function highTop(level: Level): { at: Vec3; top: number } | null {
  const flat = level.boxes.filter((b: Box) => !b.rot && b.size[0] >= 2 && b.size[2] >= 2);
  if (!flat.length) return null;
  const b = flat.reduce((a, c) => (c.pos[1] + c.size[1] / 2 > a.pos[1] + a.size[1] / 2 ? c : a));
  const top = b.pos[1] + b.size[1] / 2;
  return { at: [b.pos[0], top, b.pos[2]], top };
}

// Stand on that top and cast straight down, just ahead of your feet. Keeps
// trying for a while: not during the countdown, not as a spectator, and not
// while the ability is cooling down.
async function castOnTop(slot: 0 | 1, id: string, level: Level): Promise<void> {
  const spot = highTop(level);
  if (!spot) return;
  const p: Vec3 = [spot.at[0], spot.top + PLAYER_HALF_HEIGHT + PLAYER_RADIUS, spot.at[2]];
  const o: Vec3 = [p[0], p[1] + EYE_HEIGHT, p[2]];
  const at: Vec3 = [p[0], spot.top, p[2] - 0.3];
  const d: Vec3 = [at[0] - o[0], at[1] - o[1], at[2] - o[2]];
  const l = Math.hypot(...d);
  let got: FieldInfo | null = null;
  for (let i = 0; i < 40 && !got && arena === level.id; i++) {
    send({ t: "move", p, ry: 0, tp });
    await sleep(200);
    field = null;
    failed = "";
    send({ t: "ability", slot, o, d: [d[0] / l, d[1] / l, d[2] / l], at });
    await sleep(800);
    got = field as FieldInfo | null;
    if (failed) break;
  }
  check(`${level.id}: ${id} cast on its highest top (${spot.top.toFixed(1)} m) lands there`, !!got && Math.abs(got.p[1] - spot.top) < 0.1, got ? `landed at ${got.p[1].toFixed(2)} m` : failed || "never cast");
}

const seen = new Set<string>();
const deadline = Date.now() + 8 * 60_000;
while (seen.size < 3 && Date.now() < deadline) {
  if (arena && !seen.has(arena) && LEVELS[arena]) {
    seen.add(arena);
    const level = LEVELS[arena];
    await castOnTop(0, "blackhole", level);
    await castOnTop(1, "hellpit", level);
  }
  // Vote for somewhere new.
  const next = options.find((o) => !seen.has(o));
  if (next) send({ t: "vote", arena: next });
  await sleep(1000);
}
check("saw three arenas", seen.size >= 3, [...seen].join(", "));

ws.close();
console.log(failures ? `${failures} FAILED` : "all checks passed");
process.exit(failures ? 1 : 0);
