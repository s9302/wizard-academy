// Checks Phase 8's unlocks end to end: a brand-new account can't equip or
// cast what it hasn't unlocked; clearing Trial I (a real run through the
// server) completes Chapter I, which unlocks Frost Shard, and the XP reaches
// level 2, which unlocks the Crimson robe; the saved choices stick across
// reconnects and other players see the new look; left-click spells share one
// cooldown; loadouts can only be changed in the hub; malformed ones are
// rejected.
//
// Creates a new test account each run, so run it against a test stack:
//   GAME_PIN=... node server/scripts/unlocks-check.ts http://localhost:3000

import WebSocket from "ws";
import { trial1 } from "../../shared/src/levels/trial1.ts";
import type { ServerMsg, Vec3 } from "../../shared/src/protocol.ts";
import { sanitizeLoadout, unlockedSet } from "../../shared/src/unlocks.ts";
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

// ---- The rules themselves (shared code) ----
const fresh = unlockedSet(0, {});
check("a new player has only the defaults", fresh.has("spell:bolt") && !fresh.has("spell:frost") && !fresh.has("perk:doubleJump"));
check("level 3 unlocks Double Jump", unlockedSet(250, {}).has("perk:doubleJump") && !unlockedSet(249, {}).has("perk:doubleJump"));
check("Chapter I unlocks Frost Shard and the garden", unlockedSet(0, { trial1: 30000 }).has("spell:frost") && unlockedSet(0, { trial1: 30000 }).has("area:garden"));
check(
  "a loadout with locked or made-up choices falls back to defaults",
  JSON.stringify(sanitizeLoadout({ primary: "frost", hat: "crown", robe: "<script>" }, fresh)) === JSON.stringify({ primary: "bolt", hat: "classic", robe: "auto", cls: "wizard" }),
);

// ---- Against the server ----
const name = `test_u${Date.now() % 1_000_000}`;
const cookie = await signIn(base, pin, name);
const observerCookie = await signIn(base, pin, "test_observer");

class Client {
  ws: WebSocket;
  msgs: ServerMsg[] = [];
  id = 0;
  pos: Vec3 = [0, 0, 0];
  tp = 0;
  closed = false;
  constructor(cookieHeader: string, room: string) {
    this.ws = new WebSocket(base.replace(/^http/, "ws") + "/ws", { headers: { cookie: cookieHeader } });
    this.ws.on("open", () => this.send({ t: "hello", room }));
    this.ws.on("close", () => (this.closed = true));
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
  async ready(): Promise<void> {
    await waitFor(() => this.id > 0, 5000);
  }
  async close(): Promise<void> {
    this.ws.close();
    await waitFor(() => this.closed, 2000);
  }
  find<T extends ServerMsg["t"]>(t: T, from = 0): Extract<ServerMsg, { t: T }> | undefined {
    return this.msgs.slice(from).find((m) => m.t === t) as Extract<ServerMsg, { t: T }> | undefined;
  }
  // Walk in a straight line at 7 m/s (the server allows ~10).
  async walkTo(target: Vec3): Promise<void> {
    const from = this.pos;
    const steps = Math.max(1, Math.ceil(Math.hypot(target[0] - from[0], target[2] - from[2]) / 0.35));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      this.pos = [from[0] + (target[0] - from[0]) * t, from[1] + (target[1] - from[1]) * t, from[2] + (target[2] - from[2]) * t];
      this.send({ t: "move", p: this.pos, ry: 0, tp: this.tp });
      await sleep(50);
    }
    await sleep(150);
  }
}

// 1. A new account asks for locked things in the hub: it gets the defaults.
const observer = new Client(observerCookie, "hub");
await observer.ready();
let me = new Client(cookie, "hub");
await me.ready();
let mark = observer.msgs.length;
me.send({ t: "loadout", primary: "frost", hat: "crown", robe: "gold" });
await waitFor(() => !!me.find("loadoutSaved"), 2000);
const refused = me.find("loadoutSaved");
check("locked spell, hat and robe are refused (defaults saved)", refused?.primary === "bolt" && refused.hat === "classic" && refused.robe === "auto", JSON.stringify(refused));

// 2. Malformed loadout: kicked like any bad message.
{
  const bad = new Client(observerCookie, "hub"); // (this kicks the observer: one connection per account)
  await bad.ready();
  bad.send({ t: "loadout", primary: "bolt", hat: "tiara", robe: "auto" });
  check("a made-up hat in a loadout message is rejected", await waitFor(() => bad.closed, 2000));
}
await me.close();

// 3. In the arena (alone, so practice casting is on): Frost Shard is locked.
me = new Client(cookie, "royale");
await me.ready();
mark = me.msgs.length;
me.send({ t: "cast", spell: "frost", o: [me.pos[0], me.pos[1] + 0.7, me.pos[2]], d: [0, 0, -1], seq: 1 });
await sleep(400);
check("casting a locked spell is ignored", !me.find("spell", mark));
me.send({ t: "cast", spell: "bolt", o: [me.pos[0], me.pos[1] + 0.7, me.pos[2]], d: [0, 0, -1], seq: 2 });
check("the Arcane Bolt works", await waitFor(() => me.find("spell", mark)?.spell === "bolt", 1000));
me.send({ t: "loadout", primary: "bolt", hat: "classic", robe: "auto" });
await sleep(400);
check("loadouts can only be changed in the hub", !me.find("loadoutSaved", mark));
await me.close();

// 4. Clear Trial I for real: Chapter I done, and the XP makes level 2.
me = new Client(cookie, "trial1");
await me.ready();
mark = me.msgs.length;
const course = trial1.course!;
const center = (z: { min: Vec3; max: Vec3 }): Vec3 => [(z.min[0] + z.max[0]) / 2, z.min[1] + 0.9, (z.min[2] + z.max[2]) / 2];
for (const cp of course.checkpoints) await me.walkTo(cp.respawn);
await me.walkTo(center(course.finish));
await waitFor(() => !!me.find("finish", mark) && !!me.find("xp", mark), 3000);
const fin = me.find("finish", mark);
check("first clear of Trial I is reported as such (completes Chapter I)", fin?.firstClear === true, JSON.stringify(fin));
check("...and pays the first-clear XP (level 2)", (me.find("xp", mark)?.total ?? 0) >= 100, `total ${me.find("xp", mark)?.total}`);
await me.close();

// 5. Back in the hub: Frost Shard and the Crimson robe are allowed now, and
// the observer sees the new robe.
const watcher = new Client(observerCookie, "hub");
await watcher.ready();
me = new Client(cookie, "hub");
await me.ready();
mark = watcher.msgs.length;
const meMark = me.msgs.length;
me.send({ t: "loadout", primary: "frost", hat: "crown", robe: "crimson" });
await waitFor(() => !!me.find("loadoutSaved", meMark), 2000);
const saved = me.find("loadoutSaved", meMark);
check("now unlocked: Frost Shard and the Crimson robe (the crown still isn't)", saved?.primary === "frost" && saved.robe === "crimson" && saved.hat === "classic", JSON.stringify(saved));
await waitFor(() => !!watcher.find("look", mark), 2000);
const look = watcher.find("look", mark);
check("other players in the hub see the new robe", look?.id === me.id && look.look.robe === "crimson", JSON.stringify(look));
await me.close();

// 6. It's saved: reconnecting shows the same look to others.
mark = watcher.msgs.length;
me = new Client(cookie, "hub");
await me.ready();
await waitFor(() => !!watcher.find("join", mark), 2000);
check("the look is saved across reconnects", watcher.find("join", mark)?.player.look.robe === "crimson");
await me.close();
await watcher.close();

// 7. In the arena: Frost Shard works now; left-click spells share a cooldown;
// Spark Volley (Chapter II) is still locked.
me = new Client(cookie, "royale");
await me.ready();
mark = me.msgs.length;
const eye = (): Vec3 => [me.pos[0], me.pos[1] + 0.7, me.pos[2]];
me.send({ t: "cast", spell: "frost", o: eye(), d: [0, 0, -1], seq: 1 });
me.send({ t: "cast", spell: "bolt", o: eye(), d: [0, 0, -1], seq: 2 }); // same slot, still cooling down
await sleep(400);
const spells = me.msgs.slice(mark).filter((m) => m.t === "spell");
check("Frost Shard can be cast once unlocked", spells.some((m) => m.t === "spell" && m.spell === "frost"));
check("switching spells doesn't skip the shared cooldown", spells.length === 1, `${spells.length} spells`);
await sleep(700);
mark = me.msgs.length;
me.send({ t: "cast", spell: "spark", o: eye(), d: [0, 0, -1], seq: 3 });
await sleep(400);
check("Spark Volley is still locked (needs Chapter II)", !me.find("spell", mark));
await me.close();

console.log(failures ? `\n${failures} FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
