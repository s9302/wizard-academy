// Checks server-side bots in tag, infection and the battle royale:
// adding/removing them, that they move without walking through walls, that
// they chase and tag (or flee) or fight with spells, and that they leave when
// the last real player does.
//
//   ROUND_TIME_SCALE=0.25 GAME_PIN=... SESSION_SECRET=... node server/src/index.ts
//   GAME_PIN=... node server/scripts/bots-check.ts http://localhost:3000

import WebSocket from "ws";
import { arena } from "../../shared/src/levels/arena.ts";
import { courtyard } from "../../shared/src/levels/courtyard.ts";
import type { ServerMsg, Vec3 } from "../../shared/src/protocol.ts";
import { NavGrid } from "../src/bots/NavGrid.ts";
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

const cookie = await signIn(base, pin, "test_bots");
const grids: Record<string, NavGrid> = { tag: new NavGrid(courtyard), infection: new NavGrid(courtyard), royale: new NavGrid(arena) };

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
  spellsBy = new Map<number, number>(); // caster -> spells cast
  spellHits = 0;
  announcements: string[] = [];
  results: string[] = [];

  constructor(name: string, room: string) {
    this.ws = new WebSocket(base.replace(/^http/, "ws") + "/ws", { headers: { cookie } });
    this.open = new Promise((r) => this.ws.on("open", () => r()));
    this.ws.on("open", () => this.ws.send(JSON.stringify({ t: "hello", room })));
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
      else if (msg.t === "spell") this.spellsBy.set(msg.caster, (this.spellsBy.get(msg.caster) ?? 0) + 1);
      else if (msg.t === "spellEnd" && msg.hit !== null) this.spellHits++;
      else if (msg.t === "announce") this.announcements.push(msg.text);
      else if (msg.t === "roundResult") this.results.push(msg.title);
    });
  }
  send(msg: object): void {
    this.ws.send(JSON.stringify(msg));
  }
  botIds(): number[] {
    return [...this.names].filter(([, n]) => n.startsWith("Bot ")).map(([id]) => id);
  }
}

for (const room of ["tag", "infection", "royale"]) {
  const grid = grids[room];
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
  if (room === "royale") {
    // A whole round: about a minute at ROUND_TIME_SCALE=0.25, often less.
    check("royale: a round with bots finishes", await waitFor(() => a.results.some((r) => r !== "Round cancelled"), 90_000), a.results.join(" | "));
  } else {
    await sleep(room === "tag" ? 25_000 : 30_000);
  }
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

  if (room === "royale") {
    const casters = ids.filter((id) => (a.spellsBy.get(id) ?? 0) > 0);
    check("royale: bots cast spells", casters.length >= 3, `${casters.length}/${ids.length} bots cast; ${[...a.spellsBy.values()].reduce((x, y) => x + y, 0)} spells`);
    check("royale: bot spells hit wizards", a.spellHits >= 5, `${a.spellHits} hits`);
    const blasts = a.announcements.filter((t) => t.includes("blasted")).length;
    check("royale: bots take each other out", blasts >= 1, `${blasts} blasted, ${a.announcements.filter((t) => t.includes("storm")).length} storm`);
    console.log(`      (result: ${a.results.find((r) => r !== "Round cancelled")})`);
  } else if (room === "tag") {
    check("tag: bots tag each other (It changes hands)", a.tags >= 1, `${a.tags} tags`);
  } else {
    // If the watcher (who stands still) started with the curse, nobody spreads
    // it that round; look at rounds where a bot started cursed.
    const botStarts = a.chaserSets.filter((s) => s.length === 1 && s[0] !== a.id).length;
    const maxCursed = Math.max(...a.chaserSets.map((s) => s.length));
    if (botStarts === 0) console.log("      (skipped: the watcher drew the curse every round)");
    else check("infection: the curse spreads among bots", maxCursed >= 2, `up to ${maxCursed} cursed`);
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
