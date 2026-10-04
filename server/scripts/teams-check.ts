// Checks team rounds and the Cleric: four players split 2 against 2; your
// spells pass through teammates and hurt enemies; the Cleric's Healing Light
// heals a hurt teammate, and Divine Smite hits an enemy; a mode vote is taken.
//
//   ROYALE_ARENA=arena ROYALE_STORM=off ROYALE_TEAMS=1 ROUND_TIME_SCALE=0.25 ... node server/src/index.ts
//   GAME_PIN=... node server/scripts/teams-check.ts http://localhost:3000

import WebSocket from "ws";
import { HEAL, SMITE } from "../../shared/src/abilities.ts";
import { CLASSES } from "../../shared/src/classes.ts";
import { SPELLS } from "../../shared/src/combat.ts";
import { EYE_HEIGHT } from "../../shared/src/constants.ts";
import type { ServerMsg, Vec3 } from "../../shared/src/protocol.ts";
import { signIn } from "./signIn.ts";

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const pin = process.env.GAME_PIN!;
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

class P {
  ws: WebSocket;
  msgs: ServerMsg[] = [];
  id = 0;
  pos: Vec3 = [0, 0, 0];
  tp = 0;
  state = "";
  hp = new Map<number, number>();
  teams: [number[], number[]] | null = null;
  seq = 0;
  constructor(cookie: string) {
    this.ws = new WebSocket(base.replace(/^http/, "ws") + "/ws", { headers: { cookie } });
    this.ws.on("message", (d) => {
      const m = JSON.parse(d.toString()) as ServerMsg;
      this.msgs.push(m);
      if (m.t === "welcome") {
        this.id = m.id;
        this.pos = m.spawn;
      } else if (m.t === "teleport") {
        this.tp = m.tp;
        this.pos = m.p;
      } else if (m.t === "round") this.state = m.state;
      else if (m.t === "health") this.hp.set(m.id, m.hp);
      else if (m.t === "teams") this.teams = m.teams;
    });
    this.ws.on("open", () => this.send({ t: "hello", room: "royale" }));
  }
  send(m: object) {
    this.ws.send(JSON.stringify(m));
  }
  get eye(): Vec3 {
    return [this.pos[0], this.pos[1] + EYE_HEIGHT, this.pos[2]];
  }
  dirTo(p: Vec3): Vec3 {
    const d: Vec3 = [p[0] - this.eye[0], p[1] - this.eye[1], p[2] - this.eye[2]];
    const l = Math.hypot(...d);
    return [d[0] / l, d[1] / l, d[2] / l];
  }
  castAt(p: Vec3) {
    this.send({ t: "cast", spell: "bolt", o: this.eye, d: this.dirTo(p), seq: ++this.seq });
  }
  ability(slot: 0 | 1, d: Vec3) {
    this.send({ t: "ability", slot, o: this.eye, d });
  }
  async walkTo(target: Vec3) {
    const from = this.pos;
    const tp = this.tp;
    const steps = Math.max(1, Math.ceil(Math.hypot(target[0] - from[0], target[2] - from[2]) / 0.3));
    for (let i = 1; i <= steps && this.tp === tp; i++) {
      const t = i / steps;
      this.pos = [from[0] + (target[0] - from[0]) * t, from[1] + (target[1] - from[1]) * t, from[2] + (target[2] - from[2]) * t];
      this.send({ t: "move", p: this.pos, ry: 0, tp: this.tp });
      await sleep(50);
    }
    await sleep(100);
  }
  team(): 0 | 1 | undefined {
    if (!this.teams) return undefined;
    return this.teams[0].includes(this.id) ? 0 : this.teams[1].includes(this.id) ? 1 : undefined;
  }
}

const cookies = await Promise.all(["test_teams_a", "test_teams_b", "test_teams_c", "test_teams_d"].map((n) => signIn(base, pin, n)));
const cleric = new P(cookies[0]);
await waitFor(() => cleric.id > 0, 5000);
cleric.send({ t: "class", cls: "cleric" });
await sleep(300);
const others = cookies.slice(1).map((c) => new P(c));
await waitFor(() => others.every((o) => o.id > 0), 5000);
for (const o of others) o.send({ t: "class", cls: "wizard" });

// ---- The round splits everyone into two teams ----
await waitFor(() => cleric.state === "playing" && !!cleric.teams, 20000);
const t = cleric.teams;
check("a team round splits four players 2 against 2", !!t && t[0].length === 2 && t[1].length === 2, JSON.stringify(t));
check("the Cleric is a Cleric (120 health)", cleric.hp.get(cleric.id) === CLASSES.cleric.maxHealth, `${cleric.hp.get(cleric.id)}`);
const mate = others.find((o) => o.team() === cleric.team())!;
const [foe] = others.filter((o) => o.team() !== cleric.team());

// Everyone together on open ground, a few meters apart.
const c0 = cleric.pos;
await Promise.all([mate.walkTo([c0[0] + 3, c0[1], c0[2]]), foe.walkTo([c0[0], c0[1], c0[2] + 7])]);
await sleep(300);

// ---- Spells pass through teammates ----
let mark = cleric.msgs.length;
const before = cleric.hp.get(cleric.id)!;
mate.castAt(cleric.pos);
await sleep(900);
check("a teammate's bolt passes through you", cleric.hp.get(cleric.id) === before && !cleric.msgs.slice(mark).some((m) => m.t === "spellEnd" && m.hit === cleric.id));

// ---- ...and hurt enemies ----
const mateBefore = cleric.hp.get(mate.id)!;
foe.castAt(mate.pos);
await waitFor(() => (cleric.hp.get(mate.id) ?? 100) < mateBefore, 2000);
check("an enemy's bolt hurts", cleric.hp.get(mate.id) === mateBefore - SPELLS.bolt.damage, `${mateBefore} -> ${cleric.hp.get(mate.id)}`);

// ---- Healing Light heals the teammate ----
const hurt = cleric.hp.get(mate.id)!;
cleric.ability(0, [0, 0, -1]);
await waitFor(() => (cleric.hp.get(mate.id) ?? 0) > hurt, 2000);
check("Healing Light heals a nearby teammate", cleric.hp.get(mate.id) === Math.min(100, hurt + HEAL.amount), `${hurt} -> ${cleric.hp.get(mate.id)}`);

// ---- Divine Smite hits the enemy ----
const foeBefore = cleric.hp.get(foe.id)!;
cleric.ability(1, cleric.dirTo([foe.pos[0], foe.pos[1] - 0.9, foe.pos[2]]));
await waitFor(() => (cleric.hp.get(foe.id) ?? 100) < foeBefore, 2500);
check("Divine Smite hits the enemy it lands on", cleric.hp.get(foe.id) === foeBefore - SMITE.damage, `${foeBefore} -> ${cleric.hp.get(foe.id)}`);

// ---- The mode vote is offered between rounds ----
mark = cleric.msgs.length;
cleric.send({ t: "modeVote", mode: "teams" });
await sleep(300);
check("(a mode vote mid-round is ignored)", !cleric.msgs.slice(mark).some((m) => m.t === "arenaVote"));

for (const p of [cleric, ...others]) p.ws.close();
console.log(failures ? `${failures} FAILED` : "all checks passed");
process.exit(failures ? 1 : 0);
