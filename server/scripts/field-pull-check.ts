// Black Hole and Pit to Hell drag monsters in, not just players. A watcher
// (admin, who has every unlock) brings in monsters, drops each field near
// one, and checks the monsters inside end up closer to the middle.
//
//   ROYALE_ARENA=arena ROYALE_STORM=off ROUND_READY=on ... node server/src/index.ts
//   ADMIN_USER=... ADMIN_PASSWORD=... GAME_PIN=... node server/scripts/field-pull-check.ts http://localhost:3000

import WebSocket from "ws";
import { BLACKHOLE, type FieldInfo, HELLPIT } from "../../shared/src/abilities.ts";
import { EYE_HEIGHT } from "../../shared/src/constants.ts";
import type { MonsterState } from "../../shared/src/monsters.ts";
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
let pos: Vec3 = [0, 0, 0];
let tp = 0;
let monsters: MonsterState[] = [];
let field: FieldInfo | null = null;
ws.on("message", (d) => {
  const m = JSON.parse(d.toString()) as ServerMsg;
  if (m.t === "welcome") pos = m.spawn;
  if (m.t === "teleport") [pos, tp] = [m.p, m.tp];
  if (m.t === "monsters") monsters = m.list;
  if (m.t === "field" && (m.field.kind === "blackhole" || m.field.kind === "hellpit")) field = m.field;
});
await new Promise((r) => ws.on("open", r));
const send = (m: object) => ws.send(JSON.stringify(m));
send({ t: "hello", room: "royale" });
await sleep(800);
for (let i = 0; i < 6; i++) send({ t: "monsters", action: "add", kind: "golem" });
for (let i = 0; i < 40 && monsters.filter((m) => !m.owner).length < 6; i++) await sleep(200);
check("six monsters came", monsters.filter((m) => !m.owner).length >= 6, `${monsters.length}`);

const flat = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[2] - b[2]);
for (const [id, radius] of [["blackhole", BLACKHOLE.radius], ["hellpit", HELLPIT.radius]] as const) {
  let pulled = 0;
  let tries = 0;
  for (let round = 0; round < 6 && tries < 4; round++) {
    send({ t: "class", cls: "knight" });
    await sleep(120);
    send({ t: "class", cls: "wizard" });
    await sleep(120);
    send({ t: "abilities", cls: "wizard", e: id, r: "wall" });
    await sleep(200);
    const target = monsters.filter((m) => !m.owner)[round % monsters.length];
    if (!target) break;
    // Stand 6 m off and aim at the ground a few meters to its side, so it
    // starts well inside the field but away from the middle.
    pos = [target.p[0], target.p[1], target.p[2] + 6];
    send({ t: "move", p: pos, ry: 0, tp });
    await sleep(250);
    const spot: Vec3 = [target.p[0] + Math.max(radius * 0.5, 2.8), target.p[1] - 0.5, target.p[2]];
    const o: Vec3 = [pos[0], pos[1] + EYE_HEIGHT, pos[2]];
    const d: Vec3 = [spot[0] - o[0], spot[1] - o[1], spot[2] - o[2]];
    const l = Math.hypot(...d);
    field = null;
    send({ t: "ability", slot: 0, o, d: [d[0] / l, d[1] / l, d[2] / l], at: spot });
    await sleep(300);
    if (!field) continue;
    const f: FieldInfo = field;
    // Leave the field before it starts: we're not what's being tested.
    pos = [f.p[0] + 20, pos[1], f.p[2]];
    send({ t: "move", p: pos, ry: 0, tp });
    const start = new Map(monsters.filter((m) => !m.owner && flat(m.p, f.p) <= radius && flat(m.p, f.p) > 1.5).map((m) => [m.id, flat(m.p, f.p)]));
    await sleep(1200);
    for (const [mid, d0] of start) {
      const m = monsters.find((x) => x.id === mid);
      if (!m) continue; // died in it
      tries++;
      // In the middle (a golem is 2.2 m across: two in a pit sit side by side).
      if (flat(m.p, f.p) < Math.min(d0 - 0.5, 1.6)) pulled++;
    }
    await sleep(4000); // let it end
  }
  // (One can end up behind a wall or a pillar: that stops it, like a player.)
  check(`${id} drags monsters toward the middle`, tries >= 2 && pulled >= tries * 0.7, `${pulled}/${tries}`);
}

ws.close();
console.log(failures ? `${failures} FAILED` : "all checks passed");
process.exit(failures ? 1 : 0);
