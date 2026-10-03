// Checks server-side bots in tag and infection: adding/removing them, that
// they move without walking through walls, that they chase and tag (or flee),
// and that they leave when the last real player does.
//
//   ROUND_TIME_SCALE=0.25 GAME_PIN=... SESSION_SECRET=... node server/src/index.ts
//   GAME_PIN=... node server/scripts/bots-check.ts http://localhost:3000

import WebSocket from "ws";
import { courtyard } from "../../shared/src/levels/courtyard.ts";
import type { ServerMsg, Vec3 } from "../../shared/src/protocol.ts";
import { NavGrid } from "../src/bots/NavGrid.ts";

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

const login = await fetch(`${base}/auth/pin`, { method: "POST", body: new URLSearchParams({ pin }), redirect: "manual" });
const cookie = login.headers.get("set-cookie")?.split(";")[0];
if (!cookie) throw new Error(`login failed: HTTP ${login.status}`);
const grid = new NavGrid(courtyard);

class Client {
  ws: WebSocket;
  open: Promise<void>;
  id = 0;
  welcomePlayers: string[] | null = null;
  botCount = -1;
  names = new Map<number, string>();
  positions = new Map<number, Vec3[]>();
  chaserSets: number[][] = [];
  tags = 0;

  constructor(name: string, room: string) {
    this.ws = new WebSocket(base.replace(/^http/, "ws") + "/ws", { headers: { cookie: cookie! } });
    this.open = new Promise((r) => this.ws.on("open", () => r()));
    this.ws.on("open", () => this.ws.send(JSON.stringify({ t: "hello", name, room })));
    this.ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as ServerMsg;
      if (msg.t === "welcome") {
        this.id = msg.id;
        this.welcomePlayers = msg.players.map((p) => p.name);
      } else if (msg.t === "join") this.names.set(msg.player.id, msg.player.name);
      else if (msg.t === "botCount") this.botCount = msg.count;
      else if (msg.t === "moved") {
        const list = this.positions.get(msg.id) ?? [];
        list.push(msg.p);
        this.positions.set(msg.id, list);
      } else if (msg.t === "chasers") this.chaserSets.push(msg.ids);
      else if (msg.t === "tagged") this.tags++;
    });
  }
  send(msg: object): void {
    this.ws.send(JSON.stringify(msg));
  }
  botIds(): number[] {
    return [...this.names].filter(([, n]) => n.startsWith("Bot ")).map(([id]) => id);
  }
}

for (const room of ["tag", "infection"]) {
  const a = new Client("Watcher", room);
  await waitFor(() => a.welcomePlayers !== null, 3000);
  for (let i = 0; i < 4; i++) a.send({ t: "bots", action: "add" });
  check(`${room}: adding 4 bots`, await waitFor(() => a.botCount === 4 && a.botIds().length === 4, 3000), `count=${a.botCount}`);
  for (let i = 0; i < 5; i++) a.send({ t: "bots", action: "add" });
  await sleep(500);
  check(`${room}: capped at 6 bots`, a.botCount === 6, `count=${a.botCount}`);
  a.send({ t: "bots", action: "remove" });
  a.send({ t: "bots", action: "remove" });
  check(`${room}: removing bots`, await waitFor(() => a.botCount === 4, 2000), `count=${a.botCount}`);

  // Let a round play out. The watcher stands still near a spawn point.
  await sleep(room === "tag" ? 25_000 : 30_000);
  const ids = a.botIds().filter((id) => a.positions.has(id));
  const moved = ids.filter((id) => {
    const ps = a.positions.get(id)!;
    return Math.hypot(ps[0][0] - ps.at(-1)![0], ps[0][2] - ps.at(-1)![2]) > 2;
  });
  check(`${room}: bots move around`, moved.length >= 3, `${moved.length}/${ids.length} moved > 2 m`);

  let inWall = 0;
  let samples = 0;
  for (const id of ids) {
    for (const p of a.positions.get(id)!) {
      samples++;
      const floor = grid.floorAt(p[0], p[2]);
      if (!(p[1] - 0.9 >= floor - 1.05)) inWall++; // body below the floor here = inside a wall/pillar
    }
  }
  check(`${room}: bots never walk through walls`, inWall === 0, `${inWall} of ${samples} positions inside geometry`);
  const walkwayVisits = ids.filter((id) => a.positions.get(id)!.some((p) => p[1] > 3)).length;
  console.log(`      (${walkwayVisits} bot(s) used the raised walkways)`);

  if (room === "tag") {
    check("tag: bots tag each other (It changes hands)", a.tags >= 1, `${a.tags} tags`);
  } else {
    const maxCursed = Math.max(...a.chaserSets.map((s) => s.length));
    check("infection: the curse spreads among bots", maxCursed >= 2, `up to ${maxCursed} cursed`);
  }

  a.ws.close();
  await sleep(500);
  const b = new Client("Latecomer", room);
  await waitFor(() => b.welcomePlayers !== null, 3000);
  check(`${room}: bots leave with the last real player`, b.welcomePlayers?.length === 0 && b.botCount === 0, `players=${JSON.stringify(b.welcomePlayers)}`);
  b.ws.close();
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
