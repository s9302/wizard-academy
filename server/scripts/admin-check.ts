// Checks admin accounts: they can move without the speed check (flying),
// can't be hurt in the battle royale, earn no XP or trial times, show up as
// admins to others, and ordinary accounts get none of that.
//
// Needs an admin on the test server (make one with server/src/tools/make-admin.ts):
//   ADMIN_USER=... ADMIN_PASSWORD=... GAME_PIN=... node server/scripts/admin-check.ts http://localhost:3000

import WebSocket from "ws";
import { trial1 } from "../../shared/src/levels/trial1.ts";
import type { ServerMsg, Vec3 } from "../../shared/src/protocol.ts";
import { signIn } from "./signIn.ts";

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const { GAME_PIN: pin, ADMIN_USER: adminUser, ADMIN_PASSWORD: adminPassword } = process.env;
if (!pin || !adminUser || !adminPassword) {
  console.error("Set GAME_PIN, ADMIN_USER and ADMIN_PASSWORD in the environment.");
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

const adminCookie = await signIn(base, pin, adminUser, adminPassword);
const playerCookie = await signIn(base, pin, "test_notadmin");

class Client {
  ws: WebSocket;
  msgs: ServerMsg[] = [];
  id = 0;
  pos: Vec3 = [0, 0, 0];
  tp = 0;
  constructor(cookie: string, room: string) {
    this.ws = new WebSocket(base.replace(/^http/, "ws") + "/ws", { headers: { cookie } });
    this.ws.on("open", () => this.send({ t: "hello", room }));
    this.ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as ServerMsg;
      this.msgs.push(msg);
      if (msg.t === "welcome") {
        this.id = msg.id;
        this.pos = msg.spawn;
      } else if (msg.t === "teleport") {
        this.tp = msg.tp;
        this.pos = msg.p;
      }
    });
  }
  send(msg: object): void {
    this.ws.send(JSON.stringify(msg));
  }
  move(p: Vec3): void {
    this.pos = p;
    this.send({ t: "move", p, ry: 0, tp: this.tp });
  }
  find<T extends ServerMsg["t"]>(t: T, from = 0): Extract<ServerMsg, { t: T }> | undefined {
    return this.msgs.slice(from).find((m) => m.t === t) as Extract<ServerMsg, { t: T }> | undefined;
  }
  async close(): Promise<void> {
    this.ws.close();
    await sleep(300);
  }
}

// ---- Flying: no speed check for admins, still one for everyone else ----
{
  const admin = new Client(adminCookie, "playground");
  const player = new Client(playerCookie, "playground");
  await waitFor(() => admin.id > 0 && player.id > 0, 5000);
  const mark = admin.msgs.length;
  const [x, y, z] = admin.pos;
  admin.move([x + 30, y + 25, z]); // 30 m sideways and 25 m up, instantly
  await sleep(400);
  check("an admin can fly (a 39 m jump in one move is accepted)", !admin.find("teleport", mark));
  check("...and other players see the admin's gold tag", player.find("join")?.player.admin === true || player.find("welcome")?.players.some((p) => p.admin) === true);
  const pmark = player.msgs.length;
  const [px, py, pz] = player.pos;
  player.move([px + 30, py + 25, pz]);
  await sleep(400);
  check("an ordinary player can't (snapped back)", !!player.find("teleport", pmark));
  await admin.close();
  await player.close();
}

// ---- Immortal in the battle royale ----
{
  const admin = new Client(adminCookie, "royale");
  const player = new Client(playerCookie, "royale");
  await waitFor(() => admin.id > 0 && player.id > 0, 5000);
  check("a round starts with the admin in it", await waitFor(() => admin.msgs.some((m) => m.t === "round" && m.state === "playing"), 15_000));
  await sleep(300);
  // The player walks up to the admin (at a legal speed) and fires bolts point blank.
  for (let i = 0; i < 200; i++) {
    const dx = admin.pos[0] - player.pos[0];
    const dz = admin.pos[2] - player.pos[2];
    const d = Math.hypot(dx, dz);
    if (d < 3) break;
    player.move([player.pos[0] + (dx / d) * 0.35, 0.9, player.pos[2] + (dz / d) * 0.35]);
    admin.move(admin.pos);
    await sleep(50);
  }
  const mark = admin.msgs.length;
  for (let i = 0; i < 3; i++) {
    const o: Vec3 = [player.pos[0], player.pos[1] + 0.7, player.pos[2]];
    const t = admin.pos;
    const d: Vec3 = [t[0] - o[0], t[1] - o[1], t[2] - o[2]];
    const len = Math.hypot(...d);
    player.send({ t: "cast", spell: "bolt", o, d: d.map((n) => n / len), seq: i + 1 });
    await sleep(650);
  }
  const hits = admin.msgs.slice(mark).filter((m) => m.t === "spellEnd" && m.hit === admin.id).length;
  const hurt = admin.msgs.slice(mark).some((m) => m.t === "health" && m.id === admin.id && m.hp < 100);
  check("bolts hit the admin but do no damage", hits >= 2 && !hurt, `${hits} hits`);
  await admin.close();
  await player.close();
}

// ---- No trial times or XP ----
{
  const admin = new Client(adminCookie, "trial1");
  await waitFor(() => admin.id > 0, 5000);
  const mark = admin.msgs.length;
  const course = trial1.course!;
  for (const cp of course.checkpoints) {
    admin.move(cp.respawn);
    await sleep(150);
  }
  const f = course.finish;
  // Each move counts one thing (a checkpoint, then the finish), so step twice.
  admin.move([(f.min[0] + f.max[0]) / 2, f.min[1] + 0.9, (f.min[2] + f.max[2]) / 2]);
  await sleep(150);
  admin.move([(f.min[0] + f.max[0]) / 2 + 0.1, f.min[1] + 0.9, (f.min[2] + f.max[2]) / 2]);
  await waitFor(() => !!admin.find("finish", mark), 3000);
  await sleep(800);
  const board = admin.msgs.slice(mark).filter((m) => m.t === "leaderboard");
  check("an admin's trial finish is shown to them", !!admin.find("finish", mark));
  check("...but not recorded: no XP, no leaderboard entry", !admin.find("xp", mark) && !board.some((m) => m.t === "leaderboard" && m.entries.some((e) => e.name === adminUser)));
  await admin.close();
}

// ---- The admin flag comes from the server, not the client ----
{
  const res = await fetch(`${base}/api/me`, { headers: { cookie: playerCookie } });
  const me = (await res.json()) as { isAdmin?: boolean };
  check("an ordinary account's profile says isAdmin: false", me.isAdmin === false);
  const res2 = await fetch(`${base}/api/me`, { headers: { cookie: adminCookie } });
  check("the admin's profile says isAdmin: true", ((await res2.json()) as { isAdmin?: boolean }).isAdmin === true);
}

console.log(failures ? `\n${failures} FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
