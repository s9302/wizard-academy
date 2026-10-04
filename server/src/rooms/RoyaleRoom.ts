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

import { CLASSES, type ClassId, type Hand, inFront, SWAP_MS, WEAPONS, type WeaponId, weaponOf } from "../../../shared/src/classes.ts";
import {
  CAST_ORIGIN_SLACK,
  castDirections,
  projectileAt,
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
import { EYE_HEIGHT, PLAYER_RADIUS } from "../../../shared/src/constants.ts";
import { lerp3, lineOfSight, segmentHitsLevel, segmentHitsPlayer } from "../../../shared/src/levels/geometry.ts";
import type { CastMsg, ClientMsg, PickupInfo, Vec3, ZoneState } from "../../../shared/src/protocol.ts";
import { saveLoadout } from "../accounts.ts";
import { RoyaleBot } from "../bots/RoyaleBot.ts";
import type { BotPeer } from "../Connection.ts";
import { XP } from "../xp.ts";
import type { Player } from "./Room.ts";
import { navGridFor, RoundRoom, SCALE } from "./RoundRoom.ts";

const STORM_TICK_MS = 1000; // storm damage is dealt once a second
const STORM_CENTER_LIMIT = 16; // the safe circle's center stays this close to the middle
const COOLDOWN_SLACK = 0.85; // accept casts a bit early: messages arrive unevenly
const MELEE_HISTORY_MS = 300; // lag compensation for swings, like tag's
const MELEE_HEIGHT = 1.8; // how far above or below you a swing reaches
const BACKSTAB_ARC = 120; // degrees: hitting someone from within this arc behind them
const ROUND_MS = (STORM_STAGES.reduce((ms, s) => ms + s.holdMs + s.shrinkMs, 0) + 30_000) * SCALE;

type Fighter = {
  cls: ClassId;
  hand: Hand;
  handReadyAt: number; // swapping takes SWAP_MS
  maxHp: number;
  hp: number;
  shield: number;
  fireball: number; // charges
  nextCast: Record<SpellSlot, number>; // server time
  eliminations: number;
  slowedUntil: number; // Frost Shard (bots read this; players slow themselves)
};

// Flown by time since launch, so arrows can arc (see projectileAt).
type Projectile = { id: number; caster: number; spell: SpellId; o: Vec3; d: Vec3; t: number; p: Vec3 };
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
  // Each player's chosen class (used from their next round), and recent
  // positions for melee lag compensation.
  private chosen = new Map<number, ClassId>();
  private history = new Map<number, { time: number; p: Vec3 }[]>();

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
    // Joining mid-round: you watch until the next one. Everyone hears what
    // you're playing as (and holding).
    this.resetFighter(player);
    const conn = player.conn;
    conn.send({ t: "alive", ids: [...this.alive] });
    conn.send({ t: "zone", zone: this.zone });
    conn.send({ t: "pickups", items: this.pickupList() });
    for (const [id, f] of this.fighters) {
      conn.send({ t: "health", id, hp: f.hp, max: f.maxHp, shield: f.shield });
      conn.send({ t: "equip", id, cls: f.cls, hand: f.hand });
    }
  }

  protected override onLeftRound(player: Player): void {
    const id = player.conn.id;
    this.fighters.delete(id);
    this.inRound.delete(id);
    this.chosen.delete(id);
    this.history.delete(id);
    if (this.alive.delete(id)) {
      this.broadcast({ t: "alive", ids: [...this.alive] });
      if (this.state === "playing") this.announceLeft(`${player.conn.name} left the arena.`);
    }
  }

  private classOf(player: Player): ClassId {
    const id = player.conn.id;
    let cls = this.chosen.get(id);
    if (!cls) {
      cls = player.conn.account?.loadout.cls ?? this.bots.get(id)?.cls ?? "wizard";
      this.chosen.set(id, cls);
    }
    return cls;
  }

  private resetFighter(player: Player, tell = true): void {
    const cls = this.classOf(player);
    const maxHp = CLASSES[cls].maxHealth;
    const f: Fighter = {
      cls,
      hand: "main",
      handReadyAt: 0,
      maxHp,
      hp: maxHp,
      shield: 0,
      fireball: 0,
      nextCast: { primary: 0, fireball: 0 },
      eliminations: 0,
      slowedUntil: 0,
    };
    const id = player.conn.id;
    this.fighters.set(id, f);
    if (tell) {
      this.broadcast({ t: "health", id, hp: f.hp, max: maxHp, shield: f.shield });
      this.broadcast({ t: "equip", id, cls, hand: f.hand });
    } else {
      player.conn.send({ t: "health", id, hp: f.hp, max: maxHp, shield: f.shield });
      player.conn.send({ t: "equip", id, cls, hand: f.hand });
    }
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
    else if (msg.t === "attack") this.attack(player, msg.o, msg.d, msg.seq);
    else if (msg.t === "hand") this.setHand(player, msg.hand);
    else if (msg.t === "class") this.setClass(player, msg.cls);
  }

  // ---- Classes and hands ----

  // Pick a class: right away between rounds (or while watching), otherwise
  // from the next round. Saved to the account.
  setClass(player: Player, cls: ClassId): void {
    const id = player.conn.id;
    if (this.chosen.get(id) === cls) return;
    this.chosen.set(id, cls);
    const account = player.conn.account;
    if (account) {
      account.loadout = { ...account.loadout, cls };
      saveLoadout(account.id, account.loadout).catch((err) => console.error(`saving class for ${account.username} failed:`, err));
    }
    const fighting = this.state === "playing" && this.alive.has(id);
    if (!fighting) this.resetFighter(player);
    player.conn.send({ t: "announce", text: fighting ? `You'll be a ${CLASSES[cls].name} next round.` : `You're a ${CLASSES[cls].name}.` });
  }

  setHand(player: Player, hand: Hand): void {
    const f = this.fighters.get(player.conn.id);
    if (!f || f.hand === hand) return;
    f.hand = hand;
    f.handReadyAt = Date.now() + SWAP_MS;
    this.broadcast({ t: "equip", id: player.conn.id, cls: f.cls, hand });
  }

  private canAct(player: Player, f: Fighter | undefined): f is Fighter {
    if (!f || this.state === "countdown") return false;
    return !(this.state === "playing" && !this.alive.has(player.conn.id)); // spectators can't
  }

  // Left click with whatever is in your hand.
  attack(player: Player, o: Vec3, d: Vec3, seq: number): void {
    const now = Date.now();
    const f = this.fighters.get(player.conn.id);
    if (!this.canAct(player, f) || now < f.handReadyAt) return;
    const weapon = weaponOf(f.cls, f.hand);
    const def = WEAPONS[weapon];
    if (def.kind === "spell") {
      const primary = player.conn.account?.loadout.primary ?? this.bots.get(player.conn.id)?.primary ?? "bolt";
      this.cast(player, { spell: primary, o, d, seq });
    } else if (def.kind === "projectile") {
      if (now < f.nextCast.primary) return;
      f.nextCast.primary = now + SPELLS.arrow.cooldownMs * COOLDOWN_SLACK;
      this.launch(player, "arrow", o, d, seq, now);
    } else if (def.melee) {
      if (now < f.nextCast.primary) return;
      f.nextCast.primary = now + def.melee.cooldownMs * COOLDOWN_SLACK;
      this.swing(player, weapon, d, now);
    }
  }

  // A melee swing. The server finds who's in reach and in front of you,
  // using where they were over the last moment (you see others slightly in
  // the past, like in tag).
  private swing(attacker: Player, weapon: WeaponId, d: Vec3, now: number): void {
    const m = WEAPONS[weapon].melee!;
    const from = eye(attacker.p);
    const yaw = Math.atan2(-d[0], -d[2]);
    const candidates: { target: Player; dist: number }[] = [];
    for (const target of this.players.values()) {
      if (target === attacker || !this.canBeHit(target.conn.id)) continue;
      const recent = [target.p, ...(this.history.get(target.conn.id) ?? []).filter((h) => now - h.time <= MELEE_HISTORY_MS).map((h) => h.p)];
      let best = Infinity;
      for (const p of recent) {
        const flat = Math.hypot(p[0] - from[0], p[2] - from[2]) - PLAYER_RADIUS;
        if (flat > m.reach || Math.abs(p[1] - attacker.p[1]) > MELEE_HEIGHT) continue;
        if (!inFront(yaw, [p[0] - from[0], p[2] - from[2]], m.arcDeg) && flat > 0.4) continue;
        if (!lineOfSight(from, p, this.level.boxes)) continue;
        best = Math.min(best, flat);
      }
      if (best < Infinity) candidates.push({ target, dist: best });
    }
    candidates.sort((a, b) => a.dist - b.dist);
    const struck = m.cleave ? candidates : candidates.slice(0, 1);
    const hits: number[] = [];
    const blocked: number[] = [];
    const backstabs: number[] = [];
    for (const { target } of struck) {
      // Backstab: the attacker is behind the target.
      const behind = !!m.backstab && inFront(target.ry + Math.PI, [attacker.p[0] - target.p[0], attacker.p[2] - target.p[2]], BACKSTAB_ARC);
      if (behind) backstabs.push(target.conn.id);
      hits.push(target.conn.id);
      if (this.state === "playing" && this.damage(target, m.damage * (behind ? m.backstab! : 1), attacker, attacker.p)) blocked.push(target.conn.id);
    }
    this.broadcast({ t: "melee", id: attacker.conn.id, weapon, hits, blocked, backstabs });
  }

  // A spell: a Wizard's Spellbook spell (spell in hand), or a Fireball
  // (anyone with charges). Also used by bots.
  cast(player: Player, msg: Pick<CastMsg, "spell" | "o" | "d" | "seq">): void {
    const now = Date.now();
    const f = this.fighters.get(player.conn.id);
    if (!this.canAct(player, f)) return;
    const def = SPELLS[msg.spell];
    if (def.slot === "primary") {
      // Only a Wizard holding their spell, and only spells they've unlocked.
      if (weaponOf(f.cls, f.hand) !== "spell" || now < f.handReadyAt) return;
      const account = player.conn.account;
      if (account && !account.unlocked.has(`spell:${msg.spell}`)) return;
    }
    if (now < f.nextCast[def.slot]) return; // too soon: ignore quietly
    if (msg.spell === "fireball") {
      if (f.fireball <= 0) return;
      f.fireball -= 1;
      player.conn.send({ t: "charges", fireball: f.fireball });
    }
    f.nextCast[def.slot] = now + def.cooldownMs * COOLDOWN_SLACK;
    this.launch(player, msg.spell, msg.o, msg.d, msg.seq, now);
  }

  // Send projectiles flying (checks done by the caller).
  private launch(player: Player, spell: SpellId, clientO: Vec3, aim: Vec3, seq: number, now: number): void {
    // Start from where the client says its eyes are, if that's believable:
    // close to where we think they are, and not through a wall.
    const expected = eye(player.p);
    const o = dist3(clientO, expected) <= CAST_ORIGIN_SLACK && lineOfSight(expected, clientO, this.level.boxes) ? clientO : expected;
    const caster = player.conn.id;
    castDirections(spell, aim).forEach((d, k) => {
      const p: Projectile = { id: nextSpellId++, caster, spell, o, d, t: 0, p: o };
      this.projectiles.set(p.id, p);
      this.broadcast({ t: "spell", id: p.id, caster, seq, k, spell, o, d, time: now });
    });
  }

  private stepProjectiles(dt: number): void {
    for (const spell of [...this.projectiles.values()]) {
      const def = SPELLS[spell.spell];
      const t = Math.min(spell.t + dt, def.range / def.speed);
      const to = projectileAt(spell.spell, spell.o, spell.d, t);

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
        spell.t = t;
        if (t >= def.range / def.speed - 1e-6 || to[1] < this.level.killY) this.endSpell(spell, to, null); // fizzled out
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
      this.damage(hit, def.damage, attacker, spell.p);
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
      this.damage(target, Math.round(amount), attacker, at);
    }
  }

  // attacker null = the storm. source: where the hit came from (a swing, a
  // projectile, a blast), for the Knight's shield. Returns true if a shield
  // blocked most of it.
  private damage(target: Player, raw: number, attacker: Player | null, source?: Vec3): boolean {
    const id = target.conn.id;
    const f = this.fighters.get(id);
    if (!f || !this.alive.has(id) || raw <= 0 || target.conn.isAdmin) return false; // admins can't be hurt
    let amount = raw * (1 - CLASSES[f.cls].defense);
    const held = WEAPONS[weaponOf(f.cls, f.hand)];
    const blocked =
      !!source && !!held.block && Date.now() >= f.handReadyAt && inFront(target.ry, [source[0] - target.p[0], source[2] - target.p[2]], held.blockArcDeg!);
    if (blocked) amount *= 1 - held.block!;
    amount = Math.max(1, Math.round(amount));
    const absorbed = Math.min(f.shield, amount);
    f.shield -= absorbed;
    f.hp = Math.max(0, f.hp - (amount - absorbed));
    this.broadcast({ t: "health", id, hp: f.hp, max: f.maxHp, shield: f.shield });
    if (f.hp > 0) return blocked;

    this.alive.delete(id);
    this.outOrder.push(id);
    const byOther = attacker && attacker !== target;
    if (byOther) {
      const af = this.fighters.get(attacker.conn.id);
      if (af) af.eliminations += 1;
    }
    this.broadcast({ t: "alive", ids: [...this.alive] });
    this.announceLeft(byOther ? `${attacker.conn.name} blasted ${target.conn.name}!` : `${target.conn.name} was swallowed by the storm.`);
    return blocked;
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
    const list = this.history.get(player.conn.id) ?? [];
    list.push({ time: now, p: to });
    while (list.length && now - list[0].time > MELEE_HISTORY_MS) list.shift();
    this.history.set(player.conn.id, list);
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
      if (f.hp >= f.maxHp) return false;
      f.hp = Math.min(f.maxHp, f.hp + POTION_HEAL);
    } else {
      if (f.shield >= MAX_SHIELD) return false;
      f.shield = Math.min(MAX_SHIELD, f.shield + WARD_SHIELD);
    }
    this.broadcast({ t: "health", id, hp: f.hp, max: f.maxHp, shield: f.shield });
    return true;
  }

  // ---- Bots ----

  protected createBot(peer: BotPeer): RoyaleBot {
    return new RoyaleBot(peer, navGridFor(this.level), this.level.boxes, this.bots.size);
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
      maxHp: f?.maxHp ?? MAX_HEALTH,
      hand: f?.hand ?? "main",
      fireballs: f?.fireball ?? 0,
      slowed: (f?.slowedUntil ?? 0) > now,
      circles: this.safeCircles(now),
      pickups: this.pickupList(),
    });
    this.moveBot(me, action.p, action.ry, now);
    if (action.hand) this.setHand(me, action.hand);
    if (action.cast) this.cast(me, { ...action.cast, o: eye(me.p), seq: 0 });
    if (action.attack) this.attack(me, eye(me.p), action.attack, 0);
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10;
