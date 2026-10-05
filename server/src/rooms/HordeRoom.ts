// Horde: an endless fight against waves of monsters, played with the battle
// royale's classes. Everyone is on the same side (bots too); there's no
// storm and no arena vote. Each wave brings more monsters, and tougher ones:
// slimes at first, then wolves and zombies, fire imps (ranged) and skeletons
// from wave 3, stone golems from wave 4, witches from wave 5, with an elite
// wave every fifth (and dragons in the elite waves from wave 10). Between waves there's a short breather, and anyone who went down
// comes back for the next one. When everyone is down at once, it's over:
// your score is the waves you survived, and each wave cleared pays XP.

import { DECOY_ID_BASE } from "../../../shared/src/abilities.ts";
import type { Level } from "../../../shared/src/levels/types.ts";
import type { MonsterKind } from "../../../shared/src/monsters.ts";
import type { ClientMsg, Vec3 } from "../../../shared/src/protocol.ts";
import type { RoomInfo } from "../../../shared/src/rooms.ts";
import { XP } from "../xp.ts";
import type { Player } from "./Room.ts";
import { navGridFor, SCALE } from "./RoundRoom.ts";
import { bodyAsEnemy, RoyaleRoom } from "./RoyaleRoom.ts";

const ENDLESS_MS = 6 * 60 * 60_000; // no clock: it ends when everyone's down
const RESULTS_MS = 9_000 * SCALE;
const BREAK_MS = 10_000 * SCALE; // between waves
const FIRST_BREAK_MS = 4_000 * SCALE;
const MAX_AT_ONCE = 22; // alive at a time; the rest of the wave queues up
const GROUP_MS = 1_200; // a group of the queue comes in this often
const FAR = 16; // monsters come in at least this far from everyone

type Wave = { kind: MonsterKind }[];

// What wave n brings, for this many players. More of everything as it goes,
// wolves from wave 2, golems from wave 4, and every fifth wave is an elite
// wave (golems and wolves, no slimes).
export function waveOf(n: number, players: number): Wave {
  const more = 1 + 0.4 * Math.max(0, players - 1);
  const elite = n % 5 === 0;
  const slimes = elite ? 0 : Math.round((3 + n) * more);
  const wolves = n >= 2 ? Math.round(n * (elite ? 1.2 : 0.8) * more) : 0;
  const golems = n >= 4 ? Math.round(((n - 1) / (elite ? 2 : 3)) * more) : 0;
  const imps = n >= 3 ? Math.round((n - 1) * (elite ? 0.7 : 0.45) * more) : 0;
  const zombies = n >= 2 && !elite ? Math.round(n * 0.5 * more) : 0;
  const skeletons = n >= 3 ? Math.round((n - 1) * (elite ? 0.8 : 0.5) * more) : 0;
  const witches = n >= 5 ? Math.round((n - 3) * (elite ? 0.5 : 0.3) * more) : 0;
  const dragons = elite && n >= 10 ? Math.max(1, Math.round(((n - 5) / 5) * more)) : 0;
  const wave: Wave = [];
  for (const [kind, count] of [["slime", slimes], ["wolf", wolves], ["golem", golems], ["imp", imps], ["zombie", zombies], ["skeleton", skeletons], ["witch", witches], ["dragon", dragons]] as const) {
    for (let i = 0; i < count; i++) wave.push({ kind });
  }
  // Shuffle, so a wave isn't all slimes and then all golems.
  for (let i = wave.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [wave[i], wave[j]] = [wave[j], wave[i]];
  }
  return wave;
}

// How much tougher wave n's monsters are than usual.
export const toughness = (n: number) => ({ hp: 1 + 0.12 * (n - 1), damage: 1 + 0.06 * (n - 1) });

export class HordeRoom extends RoyaleRoom {
  private wave = 0;
  private queue: Wave = [];
  private nextGroup = 0;
  private nextWaveAt: number | null = null; // a breather until then
  private best = 0;
  private lastSent = "";

  constructor(info: RoomInfo, level: Level) {
    super(info, level, null);
    this.stormOn = false;
    this.voting = false;
  }

  // Everyone here is on the same side, against the horde.
  protected override allies(a: Player | null, b: Player): boolean {
    return !!a && a !== b;
  }

  // ---- Round cycle ----

  protected override minPlayers(): number {
    return 1;
  }

  protected override roundMs(): number {
    return ENDLESS_MS;
  }

  protected override resultsMs(): number {
    return RESULTS_MS;
  }

  protected override onCountdown(): void {
    super.onCountdown();
    this.monsters.clearAll();
    this.wave = 0;
    this.queue = [];
    this.nextWaveAt = null;
    this.sendHorde(true);
  }

  protected override onPlayStart(now: number): void {
    super.onPlayStart(now);
    this.nextWaveAt = now + FIRST_BREAK_MS;
    this.sendHorde(true);
  }

  protected override playStartText(): string {
    return "Here they come. Hold the line!";
  }

  protected override isRoundOver(): boolean {
    return this.alive.size === 0;
  }

  protected override onRoundEnded(): void {
    super.onRoundEnded();
    this.monsters.clearAll();
    this.broadcast({ t: "monsters", list: [] });
    this.queue = [];
    this.nextWaveAt = null;
    this.sendHorde(true);
  }

  // The waves you got through (the one that beat you doesn't count).
  private get survived(): number {
    return Math.max(0, this.wave - 1);
  }

  protected override results(): { title: string; lines: string[] } {
    const n = this.survived;
    this.best = Math.max(this.best, n);
    return {
      title: `Overrun on wave ${this.wave}!`,
      lines: [`You survived ${n} wave${n === 1 ? "" : "s"}.`, `Best here so far: ${this.best}`, "", "Tip: stay together, so whoever goes down is back for the next wave."],
    };
  }

  // XP comes wave by wave (see clearWave); nothing at the end.
  protected override xpAwards(): { id: number; amount: number; reason: string }[] {
    return [];
  }

  // ---- The waves ----

  protected override onRoundTick(now: number): void {
    super.onRoundTick(now);
    if (this.state !== "playing") return;
    if (this.nextWaveAt !== null) {
      if (now >= this.nextWaveAt) this.startWave(now);
    } else {
      // Bring in the queue a group at a time, while there's room.
      if (this.queue.length && now >= this.nextGroup && this.monsters.wildCount < MAX_AT_ONCE) {
        this.nextGroup = now + GROUP_MS;
        this.spawnGroup();
      }
      if (!this.queue.length && this.monsters.wildCount === 0) this.clearWave(now);
    }
    this.sendHorde();
  }

  private startWave(now: number): void {
    this.wave += 1;
    this.nextWaveAt = null;
    this.queue = waveOf(this.wave, this.inRound.size || 1);
    this.nextGroup = now;
    const elite = this.wave % 5 === 0;
    this.broadcast({ t: "announce", text: elite ? `Wave ${this.wave}: an elite wave!` : `Wave ${this.wave}!` });
  }

  // A few of the queue, together, somewhere away from everyone.
  private spawnGroup(): void {
    const grid = navGridFor(this.level);
    const players = [...this.players.values()].filter((p) => this.alive.has(p.conn.id)).map((p) => p.p);
    let at: Vec3 | null = null;
    let bestD = -1;
    for (let i = 0; i < 16; i++) {
      const [x, z] = grid.randomSpot();
      const d = players.length ? Math.min(...players.map((p) => Math.hypot(p[0] - x, p[2] - z))) : FAR;
      if (d > bestD) {
        bestD = d;
        at = [x, grid.floorAt(x, z), z];
      }
      if (d >= FAR && d < FAR * 2.5) break;
    }
    if (!at) return;
    const tough = toughness(this.wave);
    for (const { kind } of this.queue.splice(0, 3)) this.monsters.summon(kind, at, 1, tough);
    this.broadcast({ t: "monsters", list: this.monsters.list() });
  }

  // A wave beaten: XP for everyone in it, everyone back on their feet, and a
  // breather before the next.
  private clearWave(now: number): void {
    this.nextWaveAt = now + BREAK_MS;
    this.best = Math.max(this.best, this.wave);
    const amount = Math.min(XP.hordeWaveMax, XP.hordeWave * this.wave);
    for (const id of this.inRound) {
      const player = this.players.get(id);
      if (player) this.giveXp(player, amount, `Wave ${this.wave} cleared`);
    }
    const back: string[] = [];
    for (const id of this.inRound) {
      const player = this.players.get(id);
      if (!player || this.alive.has(id)) continue;
      this.resetFighter(player);
      this.alive.add(id);
      this.teleport(player, this.spawnPoint());
      back.push(player.conn.name);
    }
    if (back.length) this.broadcast({ t: "alive", ids: [...this.alive] });
    this.broadcast({ t: "announce", text: `Wave ${this.wave} cleared!${back.length ? ` ${back.join(", ")} ${back.length === 1 ? "is" : "are"} back.` : ""}` });
  }

  // The wave, how many are left, and the breather (only when it changes).
  private sendHorde(force = false): void {
    const msg = { t: "horde" as const, wave: this.wave, left: this.queue.length + this.monsters.wildCount, nextAt: this.nextWaveAt, best: this.best };
    const key = JSON.stringify(msg);
    if (!force && key === this.lastSent) return;
    this.lastSent = key;
    this.broadcast(msg);
  }

  // Bots are on your side: they fight the monsters, wherever they are.
  protected override botEnemies(): Player[] {
    return this.bodies()
      .filter((b) => (b.id < DECOY_ID_BASE || b.id >= DECOY_ID_BASE + 1_000_000) && this.monsters.ownerOf(b.id) === undefined)
      .map(bodyAsEnemy);
  }

  protected override onRoundMessage(player: Player, msg: ClientMsg): void {
    if (msg.t === "monsters") return; // the waves bring the monsters here
    super.onRoundMessage(player, msg);
  }

  protected override onJoinedRound(player: Player): void {
    super.onJoinedRound(player);
    // Mid-fight: you join in at the next wave (you're brought back with the fallen).
    if (this.state === "playing") this.inRound.add(player.conn.id);
    this.lastSent = "";
    this.sendHorde(true);
  }
}
