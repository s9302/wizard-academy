// Wizard battle royale: everyone starts with 100 health in the ruins, casts
// spells at each other, grabs pickups, and stays inside the shrinking safe
// circle (outside it, the arcane storm hurts). Last wizard standing wins.
//
// The server decides everything that matters here. Clients send "cast" (where
// from, which direction); the server checks the cooldown and charges, then
// flies the spell itself, 20 steps a second, and decides what it hits.
//
// Game-dev note on projectiles: a spell is a moving point, not an instant
// ray, so each tick we test the short line segment it travelled that tick
// against the level's boxes and against each player's capsule, and take
// whichever it touches first. Players see the same flight drawn on their
// screens, so a fast-moving wizard can dodge. There is no lag compensation
// for spells (unlike tags): they fly against where players are *now* on the
// server, which is what dodging needs.

import {
  CAST_ORIGIN_SLACK,
  castDirections,
  MAX_FIREBALL_CHARGES,
  MAX_HEALTH,
  MAX_SHIELD,
  PICKUP_REACH,
  PICKUP_RESPAWN_MS,
  PICKUPS,
  POTION_HEAL,
  type PickupKind,
  type SpellId,
  type SpellSlot,
  SPELLS,
  STORM_FINAL_DPS,
  STORM_STAGES,
  STORM_START_RADIUS,
  stormCircle,
  TOME_CHARGES,
  WARD_SHIELD,
} from "../../../shared/src/combat.ts";
import { EYE_HEIGHT } from "../../../shared/src/constants.ts";
import { lerp3, lineOfSight, segmentHitsLevel, segmentHitsPlayer } from "../../../shared/src/levels/geometry.ts";
import type { CastMsg, ClientMsg, PickupInfo, Vec3, ZoneState } from "../../../shared/src/protocol.ts";
import { RoyaleBot } from "../bots/RoyaleBot.ts";
import type { BotPeer } from "../Connection.ts";
import { XP } from "../xp.ts";
import type { Player } from "./Room.ts";
import { navGridFor, RoundRoom, SCALE } from "./RoundRoom.ts";

const STORM_TICK_MS = 1000; // storm damage is dealt once a second
const STORM_CENTER_LIMIT = 16; // the safe circle's center stays this close to the middle
const COOLDOWN_SLACK = 0.85; // accept casts a bit early: messages arrive unevenly
const ROUND_MS = (STORM_STAGES.reduce((ms, s) => ms + s.holdMs + s.shrinkMs, 0) + 30_000) * SCALE;

type Fighter = {
  hp: number;
  shield: number;
  fireball: number; // charges
  nextCast: Record<SpellSlot, number>; // server time
  eliminations: number;
  slowedUntil: number; // Frost Shard (bots read this; players slow themselves)
};

type Projectile = { id: number; caster: number; spell: SpellId; p: Vec3; d: Vec3; travelled: number };
type Pickup = PickupInfo & { spot: number };

let nextSpellId = 1;
let nextPickupId = 1;

const eye = (p: Vec3): Vec3 => [p[0], p[1] + EYE_HEIGHT, p[2]];
const dist3 = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export class RoyaleRoom extends RoundRoom<RoyaleBot> {
  private fighters = new Map<number, Fighter>();
  private alive = new Set<number>();
  private inRound = new Set<number>(); // started this round (for XP)
  private outOrder: number[] = []; // eliminated, first out first
  private projectiles = new Map<number, Projectile>();
  private pickups = new Map<number, Pickup>();
  private respawnAt = new Map<number, number>(); // pickup spot -> when it refills
  private zone: ZoneState | null = null;
  private stage = 0;
  private nextStormTick = 0;
  private lastStep = Date.now();

  // ---- Round cycle (RoundRoom hooks) ----

  protected roundMs(): number {
    return ROUND_MS;
  }

  protected override onCountdown(): void {
    this.projectiles.clear();
    this.alive.clear();
    this.broadcast({ t: "alive", ids: [] });
    this.setZone(null);
    this.pickups.clear();
    this.broadcastPickups();
    for (const player of this.players.values()) this.resetFighter(player);
  }

  protected onPlayStart(now: number): void {
    this.outOrder = [];
    this.inRound = new Set(this.players.keys());
    this.alive = new Set(this.players.keys());
    for (const player of this.players.values()) this.resetFighter(player);
    this.broadcast({ t: "alive", ids: [...this.alive] });

    this.respawnAt.clear();
    (this.level.pickupSpots ?? []).forEach((_, spot) => this.spawnPickup(spot));
    this.broadcastPickups();

    this.stage = 0;
    this.nextStormTick = now + STORM_TICK_MS;
    this.startStage([0, 0, STORM_START_RADIUS], now);
    this.broadcast({ t: "announce", text: "The storm is gathering. Last wizard standing wins!" });
  }

  protected isRoundOver(): boolean {
    return this.alive.size <= 1;
  }

  protected override onRoundEnded(): void {
    this.setZone(null);
    this.projectiles.clear();
  }

  protected results(): { title: string; lines: string[] } {
    // Placing: survivors first (most health first, if time ran out), then
    // the eliminated, last out first.
    const survivors = [...this.alive].sort((a, b) => this.toughness(b) - this.toughness(a));
    const order = [...survivors, ...[...this.outOrder].reverse()].filter((id) => this.players.has(id));
    const lines = order.map((id, i) => {
      const n = this.fighters.get(id)?.eliminations ?? 0;
      return `${i + 1}. ${this.nameOf(id)} — ${n} elimination${n === 1 ? "" : "s"}`;
    });
    let title = "Nobody survived the storm!";
    if (survivors.length === 1) title = `${this.nameOf(survivors[0])} is the last wizard standing!`;
    else if (survivors.length > 1) title = `Time! ${this.nameOf(survivors[0])} wins with the most health.`;
    return { title, lines };
  }

  protected xpAwards(): { id: number; amount: number; reason: string }[] {
    const survivors = [...this.alive].sort((a, b) => this.toughness(b) - this.toughness(a));
    const placing = [...survivors, ...[...this.outOrder].reverse()];
    const awards: { id: number; amount: number; reason: string }[] = [];
    for (const id of this.inRound) {
      awards.push({ id, amount: XP.roundPlayed, reason: "Round played" });
      const place = placing.indexOf(id);
      if (place === 0) awards.push({ id, amount: XP.royaleWinner, reason: "Last wizard standing" });
      else if (place === 1 || place === 2) awards.push({ id, amount: XP.royaleTopThree, reason: "Top 3" });
      const n = Math.min(this.fighters.get(id)?.eliminations ?? 0, XP.maxTagsPaid);
      if (n) awards.push({ id, amount: n * XP.perElimination, reason: `${n} elimination${n === 1 ? "" : "s"}` });
    }
    return awards;
  }

  private toughness(id: number): number {
    const f = this.fighters.get(id);
    return f ? f.hp + f.shield : 0;
  }

  // ---- Players coming and going ----

  protected override onJoinedRound(player: Player): void {
    // Joining mid-round: you watch until the next one.
    this.resetFighter(player, false);
    const conn = player.conn;
    conn.send({ t: "alive", ids: [...this.alive] });
    conn.send({ t: "zone", zone: this.zone });
    conn.send({ t: "pickups", items: this.pickupList() });
    for (const [id, f] of this.fighters) conn.send({ t: "health", id, hp: f.hp, shield: f.shield });
  }

  protected override onLeftRound(player: Player): void {
    const id = player.conn.id;
    this.fighters.delete(id);
    this.inRound.delete(id);
    if (this.alive.delete(id)) {
      this.broadcast({ t: "alive", ids: [...this.alive] });
      if (this.state === "playing") this.announceLeft(`${player.conn.name} left the arena.`);
    }
  }

  private resetFighter(player: Player, tell = true): void {
    const f: Fighter = { hp: MAX_HEALTH, shield: 0, fireball: 0, nextCast: { primary: 0, fireball: 0 }, eliminations: 0, slowedUntil: 0 };
    this.fighters.set(player.conn.id, f);
    if (tell) this.broadcast({ t: "health", id: player.conn.id, hp: f.hp, shield: f.shield });
    player.conn.send({ t: "charges", fireball: 0 });
  }

  // ---- Every tick ----

  protected override onRoundTick(now: number): void {
    const dt = Math.min(0.2, (now - this.lastStep) / 1000);
    this.lastStep = now;
    this.stepProjectiles(dt);
    if (this.state !== "playing") return;
    this.stepStorm(now);
    for (const [spot, at] of this.respawnAt) {
      if (now < at) continue;
      this.respawnAt.delete(spot);
      this.spawnPickup(spot);
      this.broadcastPickups();
    }
  }

  // ---- Spells ----

  protected override onRoundMessage(player: Player, msg: ClientMsg): void {
    if (msg.t === "cast") this.cast(player, msg);
  }

  // Also used by bots (with their own eye position as the origin).
  cast(player: Player, msg: Pick<CastMsg, "spell" | "o" | "d" | "seq">): void {
    const now = Date.now();
    const id = player.conn.id;
    const f = this.fighters.get(id);
    if (!f || this.state === "countdown") return;
    if (this.state === "playing" && !this.alive.has(id)) return; // spectators can't cast
    const def = SPELLS[msg.spell];
    // Left-click spells must be unlocked (bots have them all).
    const account = player.conn.account;
    if (def.slot === "primary" && account && !account.unlocked.has(`spell:${msg.spell}`)) return;
    if (now < f.nextCast[def.slot]) return; // too soon: ignore quietly
    if (msg.spell === "fireball") {
      if (f.fireball <= 0) return;
      f.fireball -= 1;
      player.conn.send({ t: "charges", fireball: f.fireball });
    }
    f.nextCast[def.slot] = now + def.cooldownMs * COOLDOWN_SLACK;

    // Start from where the client says its eyes are, if that's believable:
    // close to where we think they are, and not through a wall.
    const expected = eye(player.p);
    const o = dist3(msg.o, expected) <= CAST_ORIGIN_SLACK && lineOfSight(expected, msg.o, this.level.boxes) ? msg.o : expected;
    castDirections(msg.spell, msg.d).forEach((d, k) => {
      const spell: Projectile = { id: nextSpellId++, caster: id, spell: msg.spell, p: o, d, travelled: 0 };
      this.projectiles.set(spell.id, spell);
      this.broadcast({ t: "spell", id: spell.id, caster: id, seq: msg.seq, k, spell: msg.spell, o, d, time: now });
    });
  }

  private stepProjectiles(dt: number): void {
    for (const spell of [...this.projectiles.values()]) {
      const def = SPELLS[spell.spell];
      const len = Math.min(def.speed * dt, def.range - spell.travelled);
      const to: Vec3 = [spell.p[0] + spell.d[0] * len, spell.p[1] + spell.d[1] * len, spell.p[2] + spell.d[2] * len];

      // First thing along this tick's path: a wall, or a player.
      let hitT = segmentHitsLevel(spell.p, to, this.level.boxes, 0.05);
      let hitPlayer: Player | null = null;
      for (const target of this.players.values()) {
        if (target.conn.id === spell.caster || !this.canBeHit(target.conn.id)) continue;
        const t = segmentHitsPlayer(spell.p, to, target.p, def.radius);
        if (t !== null && (hitT === null || t < hitT)) {
          hitT = t;
          hitPlayer = target;
        }
      }

      if (hitT === null) {
        spell.p = to;
        spell.travelled += len;
        if (spell.travelled >= def.range - 1e-6) this.endSpell(spell, to, null); // fizzled out
        continue;
      }
      const at = lerp3(spell.p, to, hitT);
      this.endSpell(spell, at, hitPlayer);
    }
  }

  // While a round is on, only those still in it can be hit; between rounds
  // anyone can (practice: no damage is dealt then anyway).
  private canBeHit(id: number): boolean {
    return this.state !== "playing" || this.alive.has(id);
  }

  private endSpell(spell: Projectile, at: Vec3, hit: Player | null): void {
    this.projectiles.delete(spell.id);
    this.broadcast({ t: "spellEnd", id: spell.id, p: at, hit: hit?.conn.id ?? null });
    if (this.state !== "playing") return;
    const def = SPELLS[spell.spell];
    const attacker = this.players.get(spell.caster) ?? null;
    if (hit) {
      this.damage(hit, def.damage, attacker);
      if (def.slowMs && this.alive.has(hit.conn.id)) {
        const f = this.fighters.get(hit.conn.id);
        if (f) f.slowedUntil = Date.now() + def.slowMs;
        this.broadcast({ t: "slowed", id: hit.conn.id, ms: def.slowMs });
      }
    }
    if (!def.splashRadius) return;
    // Splash: everyone else near the blast, unless a wall is in the way. The
    // check starts a little back toward the caster so the wall it hit
    // doesn't block its own blast.
    const from = lerp3(at, [at[0] - spell.d[0], at[1] - spell.d[1], at[2] - spell.d[2]], 0.3);
    for (const target of [...this.players.values()]) {
      if (target === hit || target.conn.id === spell.caster || !this.alive.has(target.conn.id)) continue;
      const d = dist3(at, target.p);
      if (d > def.splashRadius || !lineOfSight(from, target.p, this.level.boxes)) continue;
      const amount = def.splashMax! - (def.splashMax! - def.splashMin!) * (d / def.splashRadius);
      this.damage(target, Math.round(amount), attacker);
    }
  }

  // attacker null = the storm.
  private damage(target: Player, amount: number, attacker: Player | null): void {
    const id = target.conn.id;
    const f = this.fighters.get(id);
    if (!f || !this.alive.has(id) || amount <= 0) return;
    const absorbed = Math.min(f.shield, amount);
    f.shield -= absorbed;
    f.hp = Math.max(0, f.hp - (amount - absorbed));
    this.broadcast({ t: "health", id, hp: f.hp, shield: f.shield });
    if (f.hp > 0) return;

    this.alive.delete(id);
    this.outOrder.push(id);
    const byOther = attacker && attacker !== target;
    if (byOther) {
      const af = this.fighters.get(attacker.conn.id);
      if (af) af.eliminations += 1;
    }
    this.broadcast({ t: "alive", ids: [...this.alive] });
    this.announceLeft(byOther ? `${attacker.conn.name} blasted ${target.conn.name}!` : `${target.conn.name} was swallowed by the storm.`);
  }

  private announceLeft(first: string): void {
    const n = this.alive.size;
    this.broadcast({ t: "announce", text: n > 1 ? `${first} ${n} wizards left.` : first });
  }

  // ---- The storm ----

  private setZone(zone: ZoneState | null): void {
    this.zone = zone;
    this.broadcast({ t: "zone", zone });
  }

  // Wait, then shrink from `from` to the next stage's circle.
  private startStage(from: [number, number, number], now: number): void {
    const stage = STORM_STAGES[this.stage];
    if (!stage) {
      // Past the last stage: the storm covers everything and hurts a lot.
      this.setZone({ from, to: from, shrinkAt: now, endsAt: now, dps: STORM_FINAL_DPS });
      return;
    }
    const to = this.nextCircle(from, stage.radius);
    const shrinkAt = now + stage.holdMs * SCALE;
    this.setZone({ from, to, shrinkAt, endsAt: shrinkAt + stage.shrinkMs * SCALE, dps: stage.dps });
  }

  // A random smaller circle inside the current one, near the middle of the arena.
  private nextCircle(from: [number, number, number], radius: number): [number, number, number] {
    const room = from[2] - radius;
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * room;
      const x = from[0] + Math.cos(a) * r;
      const z = from[1] + Math.sin(a) * r;
      if (Math.hypot(x, z) <= STORM_CENTER_LIMIT) return [round1(x), round1(z), radius];
    }
    return [from[0], from[1], radius];
  }

  private stepStorm(now: number): void {
    const zone = this.zone;
    if (!zone) return;
    if (now >= zone.endsAt && STORM_STAGES[this.stage]) {
      this.stage += 1;
      this.startStage(zone.to, now);
      if (STORM_STAGES[this.stage]) this.broadcast({ t: "announce", text: "The storm is closing in." });
    }
    if (now < this.nextStormTick) return;
    this.nextStormTick = now + STORM_TICK_MS;
    const [cx, cz, r] = stormCircle(this.zone!, now);
    for (const id of [...this.alive]) {
      const player = this.players.get(id);
      if (player && Math.hypot(player.p[0] - cx, player.p[2] - cz) > r) this.damage(player, this.zone!.dps, null);
    }
  }

  // Bots read the storm too.
  safeCircles(now: number): { now: [number, number, number]; next: [number, number, number] } | null {
    return this.zone ? { now: stormCircle(this.zone, now), next: this.zone.to } : null;
  }

  // ---- Pickups ----

  private spawnPickup(spot: number): void {
    const p = this.level.pickupSpots?.[spot];
    if (!p) return;
    const kinds = Object.keys(PICKUPS) as PickupKind[];
    let roll = Math.random() * kinds.reduce((sum, k) => sum + PICKUPS[k].weight, 0);
    const kind = kinds.find((k) => (roll -= PICKUPS[k].weight) < 0) ?? "tome";
    const id = nextPickupId++;
    this.pickups.set(id, { id, kind, p, spot });
  }

  private pickupList(): PickupInfo[] {
    return [...this.pickups.values()].map(({ id, kind, p }) => ({ id, kind, p }));
  }

  private broadcastPickups(): void {
    this.broadcast({ t: "pickups", items: this.pickupList() });
  }

  protected override onPlayerMoved(player: Player, _from: Vec3, to: Vec3, now: number): void {
    if (this.state !== "playing" || !this.alive.has(player.conn.id)) return;
    for (const item of this.pickups.values()) {
      if (Math.hypot(item.p[0] - to[0], item.p[2] - to[2]) > PICKUP_REACH || Math.abs(item.p[1] - to[1]) > 1.6) continue;
      if (this.usePickup(player, item.kind)) {
        this.pickups.delete(item.id);
        this.respawnAt.set(item.spot, now + PICKUP_RESPAWN_MS * SCALE);
        this.broadcastPickups();
        player.conn.send({ t: "announce", text: `You picked up a ${PICKUPS[item.kind].name}.` });
      }
      return;
    }
  }

  // Returns false (leaving it for someone else) if it would do nothing.
  private usePickup(player: Player, kind: PickupKind): boolean {
    const id = player.conn.id;
    const f = this.fighters.get(id);
    if (!f) return false;
    if (kind === "tome") {
      if (f.fireball >= MAX_FIREBALL_CHARGES) return false;
      f.fireball = Math.min(MAX_FIREBALL_CHARGES, f.fireball + TOME_CHARGES);
      player.conn.send({ t: "charges", fireball: f.fireball });
      return true;
    }
    if (kind === "potion") {
      if (f.hp >= MAX_HEALTH) return false;
      f.hp = Math.min(MAX_HEALTH, f.hp + POTION_HEAL);
    } else {
      if (f.shield >= MAX_SHIELD) return false;
      f.shield = Math.min(MAX_SHIELD, f.shield + WARD_SHIELD);
    }
    this.broadcast({ t: "health", id, hp: f.hp, shield: f.shield });
    return true;
  }

  // ---- Bots ----

  protected createBot(peer: BotPeer): RoyaleBot {
    return new RoyaleBot(peer, navGridFor(this.level), this.level.boxes);
  }

  protected runBot(bot: RoyaleBot, me: Player, now: number, dt: number): void {
    const f = this.fighters.get(me.conn.id);
    const action = bot.think({
      now,
      dt,
      me,
      fighting: this.state === "playing" && this.alive.has(me.conn.id),
      practice: this.state === "waiting" || this.state === "ended",
      enemies: [...this.players.values()].filter((p) => p !== me && this.canBeHit(p.conn.id)),
      hp: f?.hp ?? MAX_HEALTH,
      fireballs: f?.fireball ?? 0,
      slowed: (f?.slowedUntil ?? 0) > now,
      circles: this.safeCircles(now),
      pickups: this.pickupList(),
    });
    this.moveBot(me, action.p, action.ry, now);
    if (action.cast) this.cast(me, { ...action.cast, o: eye(me.p), seq: 0 });
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10;
