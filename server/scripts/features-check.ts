// Checks Phase 16's arena features and monsters against the server, in The
// Ember Forge (between rounds, with one player): a teleporter sends you to
// the other pad (facing away from it), a jump pad's launch isn't snapped
// back as a cheat, lava sends you back to a spawn, and monsters come when
// added, hunt you, and die to your spells.
//
//   ROYALE_ARENA=forge GAME_PIN=... SESSION_SECRET=... node server/src/index.ts
//   GAME_PIN=... node server/scripts/features-check.ts http://localhost:3000

import WebSocket from "ws";
import { LEVELS } from "../../shared/src/levels/index.ts";
import type { MonsterState } from "../../shared/src/monsters.ts";
import type { ServerMsg, Vec3 } from "../../shared/src/protocol.ts";
import { signIn } from "./signIn.ts";

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const pin = process.env.GAME_PIN;
if (!pin) {
  console.error("Set GAME_PIN in the environment.");
  process.exit(1);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}
async function waitFor(cond: () => boolean, ms: number): Promise<boolean> {
  for (let t = 0; t < ms; t += 50) {
    if (cond()) return true;
    await sleep(50);
  }
  return cond();
}

const forge = LEVELS.forge;
const cookie = await signIn(base, pin, "test_features");

const msgs: ServerMsg[] = [];
let pos: Vec3 = [0, 0, 0];
let tp = 0;
let monsters: MonsterState[] = [];
const ws = new WebSocket(base.replace(/^http/, "ws") + "/ws", { headers: { cookie } });
ws.on("open", () => ws.send(JSON.stringify({ t: "hello", room: "royale" })));
ws.on("message", (data) => {
  const m = JSON.parse(data.toString()) as ServerMsg;
  msgs.push(m);
  if (m.t === "welcome") pos = m.spawn;
  if (m.t === "teleport") {
    pos = m.p;
    tp = m.tp;
  }
  if (m.t === "monsters") monsters = m.list;
});
const send = (m: object) => ws.send(JSON.stringify(m));
const since = (mark: number, t: ServerMsg["t"]) => msgs.slice(mark).filter((m) => m.t === t);
const move = (p: Vec3) => {
  pos = p;
  send({ t: "move", p, ry: 0, tp });
};
// Walk in a straight line at ~7 m/s (under the speed limit).
// Stops early if the server teleports us.
async function walkTo(x: number, z: number, y = 1): Promise<void> {
  const startTp = tp;
  for (let i = 0; i < 2000 && tp === startTp; i++) {
    const dx = x - pos[0];
    const dz = z - pos[2];
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return;
    const step = Math.min(0.35, d);
    move([pos[0] + (dx / d) * step, y, pos[2] + (dz / d) * step]);
    await sleep(50);
  }
}

await waitFor(() => msgs.some((m) => m.t === "welcome"), 5000);
check("joined the battle royale in The Ember Forge", msgs.some((m) => m.t === "arena" && m.levelId === "forge"));

// ---- Teleporter: the west pad sends you east ----
// Stay west of the lava channels' ends (|x| > 22) on the way.
await walkTo(-26, pos[2]);
await walkTo(-26, 0);
let mark = msgs.length;
const west = forge.teleporters!.find((t) => t.pos[0] < 0)!;
await walkTo(west.pos[0], west.pos[2]);
await waitFor(() => since(mark, "teleport").length > 0, 2000);
const warp = since(mark, "teleport")[0];
check("stepping on the west teleporter sends you east", !!warp && warp.t === "teleport" && warp.p[0] > 20, JSON.stringify(warp));
check("...facing back into the arena", !!warp && warp.t === "teleport" && Math.abs(Math.abs(warp.yaw ?? 0) - Math.PI / 2) < 0.01, `yaw ${warp && warp.t === "teleport" ? warp.yaw : "?"}`);
check("...and everyone sees the warp", since(mark, "warp").length === 1);
await sleep(300);

// ---- Jump pad: a 6 m launch isn't treated as cheating ----
const pad = forge.jumpPads!.find((p) => p.pos[0] > 0 && p.pos[2] > 0)!; // the southeast tower's
await walkTo(26, 10);
await walkTo(pad.pos[0], pad.pos[2]);
await sleep(100);
mark = msgs.length;
for (let i = 1; i <= 14; i++) {
  move([pad.pos[0], 1 + i * 0.45, pad.pos[2]]); // ~9 m/s up, like the real launch
  await sleep(50);
}
await sleep(300);
check("a jump pad launch (6 m up) isn't snapped back", since(mark, "teleport").length === 0, `${since(mark, "teleport").length} teleports`);
for (let i = 13; i >= 0; i--) {
  move([pad.pos[0], 1 + i * 0.45, pad.pos[2]]);
  await sleep(50);
}

// ---- Lava: back to a spawn ----
const lava = forge.pits!.find((p) => p.kind === "lava" && p.pos[2] > 0)!;
await walkTo(24, lava.pos[2] - 3.5);
mark = msgs.length;
await walkTo(18, lava.pos[2]); // into the channel (it ends at x = 22)
await waitFor(() => since(mark, "teleport").length > 0, 2000);
const out = since(mark, "teleport")[0];
const spawns = forge.spawnPoints!;
check(
  "walking into lava sends you back to a spawn point",
  !!out && out.t === "teleport" && spawns.some((s) => Math.hypot(s[0] - out.p[0], s[2] - out.p[2]) < 1.5),
  JSON.stringify(out),
);
await sleep(300);

// ---- Monsters ----
mark = msgs.length;
send({ t: "monsters", action: "add" });
send({ t: "monsters", action: "add" });
await waitFor(() => monsters.length === 2, 4000);
const counts = since(mark, "monsterCount");
check("adding two monsters: the count goes to 2", counts.at(-1)?.t === "monsterCount" && counts.at(-1)!.count === 2);
check("...and two appear", monsters.length === 2, JSON.stringify(monsters.map((m) => m.kind)));
check("...not right on top of you", monsters.every((m) => Math.hypot(m.p[0] - pos[0], m.p[2] - pos[2]) > 8));
const d0 = Math.min(...monsters.map((m) => Math.hypot(m.p[0] - pos[0], m.p[2] - pos[2])));
await sleep(3000);
const d1 = Math.min(...monsters.map((m) => Math.hypot(m.p[0] - pos[0], m.p[2] - pos[2])));
check("they come for you", d1 < d0 - 3, `${d0.toFixed(1)} m -> ${d1.toFixed(1)} m`);

// Cast at the nearest until it dies.
mark = msgs.length;
let seq = 0;
for (let i = 0; i < 40 && !since(mark, "monsterDied").length; i++) {
  const m = [...monsters].sort((a, b) => Math.hypot(a.p[0] - pos[0], a.p[2] - pos[2]) - Math.hypot(b.p[0] - pos[0], b.p[2] - pos[2]))[0];
  if (!m) break;
  const o: Vec3 = [pos[0], pos[1] + 0.7, pos[2]];
  const d: Vec3 = [m.p[0] - o[0], m.p[1] - o[1], m.p[2] - o[2]];
  const l = Math.hypot(...d);
  send({ t: "cast", spell: "bolt", o, d: [d[0] / l, d[1] / l, d[2] / l], seq: ++seq });
  await sleep(650);
}
const died = since(mark, "monsterDied")[0];
check("spells hurt monsters, and one goes down", !!died, died ? JSON.stringify(died) : `hits: ${since(mark, "spellEnd").filter((m) => m.t === "spellEnd" && (m.hit ?? 0) >= 1_000_000).length}`);

mark = msgs.length;
send({ t: "monsters", action: "remove" });
send({ t: "monsters", action: "remove" });
await waitFor(() => monsters.length === 0, 3000);
check("removing them clears the arena", monsters.length === 0 && since(mark, "monsterCount").at(-1)?.t === "monsterCount");

ws.close();
console.log(failures ? `${failures} FAILED` : "all checks passed");
process.exit(failures ? 1 : 0);
