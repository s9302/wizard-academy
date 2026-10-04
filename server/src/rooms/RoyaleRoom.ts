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
  ABILITIES,
  BLINK_RANGE,
  CHARGE_DAMAGE,
  CHARGE_SPEED,
  CHARGE_TIME,
  CLASS_ABILITIES,
  CONJURE_RANGE,
  FORTIFY_FACTOR,
  PILLAR_HEIGHT,
  PILLAR_SIZE,
  WALL_SIZE,
} from "../../../shared/src/abilities.ts";
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
import { boxTouchesPlayer, floorBelow, lerp3, lineOfSight, segmentHitsLevel, segmentHitsPlayer } from "../../../shared/src/levels/geometry.ts";
import type { CastMsg, ClientMsg, PickupInfo, Vec3, ZoneState } from "../../../shared/src/protocol.ts";
import { saveLoadout } from "../accounts.ts";
import { RoyaleBot } from "../bots/RoyaleBot.ts";
import type { BotPeer } from "../Connection.ts";
import { XP } from "../xp.ts";
import type { Player } from "./Room.ts";
import { arenasOfSize } from "../../../shared/src/levels/arenas.ts";
import { LEVELS } from "../../../shared/src/levels/index.ts";
import type { Box, Level } from "../../../shared/src/levels/types.ts";
import { navGridFor, navGridIfBuilt, RoundRoom, SCALE } from "./RoundRoom.ts";

const STORM_TICK_MS = 500; // storm damage is dealt twice a second (half the dps each time)
const STORM_CENTER_LIMIT = 16; // the safe circle's center stays this close to the middle (medium arena)
const RESULTS_MS = 12_000 * SCALE; // long enough to vote for the next arena

// Falling: more than SAFE_FALL meters hurts, FALL_DAMAGE per meter beyond.
// Only real falls count (moving down faster than FALL_SPEED at some point),
// so walking down a ramp never does. Landing on someone (a "stomp") hurts
// them instead, and you bounce off.
const SAFE_FALL = 4;
const FALL_DAMAGE = 8;
const FALL_SPEED = 9; // m/s
const STOMP_SPEED = 6; // m/s
const STOMP_DAMAGE = 25;
const STOMP_PER_METER = 3;
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
  abilityReady: [number, number]; // E and R: server time each is ready
  stealthUntil: number; // Vanish
  fortifyUntil: number; // Fortify
  chargeUntil: number; // Charge: moving fast, the first enemy touched is hit
  chargeHit: boolean;
};

// Flown by time since launch, so arrows can arc (see projectileAt).
type Projectile = { id: number; caster: number; spell: SpellId; o: Vec3; d: Vec3; t: number; p: Vec3 };
type Pickup = PickupInfo & { spot: number };

let nextSpellId = 1;
let nextConjureId = 1;
let nextPickupId = 1;

const eye = (p: Vec3): Vec3 => [p[0], p[1] + EYE_HEIGHT, p[2]];
const dist3 = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// Testing only: always play this arena (a level id); no votes.
const FIXED_ARENA = process.env.ROYALE_ARENA;
// Testing only: ROYALE_STORM=off for exact damage checks.
const NO_STORM = process.env.ROYALE_STORM === "off";

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
  // Falling, per player: the highest point of this drop, the fastest it got.
  // stomped: already landed on someone this fall (once is enough, and it
  // cancels your own fall damage).
  private falls = new Map<number, { peak: number; speed: number; lastMove: number; lastY: number; stomped: boolean }>();
  // Arena vote: the options on offer and each person's vote.
  // Walls and pillars wizards have conjured, by id.
  private conjured = new Map<number, { box: Box; until: number }>();
  private boxCache: Box[] | null = null;
  private voteOptions: string[] = [];
  private votes = new Map<number, string>();

  constructor(info: ConstructorParameters<typeof RoundRoom>[0], level: Level) {
    super(info, (FIXED_ARENA && LEVELS[FIXED_ARENA]) || level);
  }

  // ---- Round cycle (RoundRoom hooks) ----

  protected roundMs(): number {
    return ROUND_MS;
  }

  protected override onCountdown(): void {
    this.falls.clear(); // everyone was just moved to a spawn point
    this.clearConjured();
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
    if (!NO_STORM) this.startStage([0, 0, this.level.arena?.stormRadius ?? STORM_START_RADIUS], now);
    this.broadcast({ t: "announce", text: "The storm is gathering. Last wizard standing wins!" });
  }

  protected isRoundOver(): boolean {
    return this.alive.size <= 1;
  }

  protected override resultsMs(): number {
    return RESULTS_MS;
  }

  protected override onRoundEnded(): void {
    this.setZone(null);
    this.projectiles.clear();
    this.openVote();
    // Class changes picked during the round take effect now, at the results
    // screen, rather than waiting for the next countdown.
    for (const player of this.players.values()) {
      const f = this.fighters.get(player.conn.id);
      if (f && f.cls !== this.classOf(player)) this.resetFighter(player);
    }
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

  // ---- Arenas: vote between rounds, switch before the countdown ----

  // Offer one arena of each size.
  private openVote(): void {
    if (FIXED_ARENA) return;
    const pick = (size: "small" | "medium" | "large") => {
      const list = arenasOfSize(size);
      return list[Math.floor(Math.random() * list.length)].id;
    };
    this.voteOptions = [pick("small"), pick("medium"), pick("large")];
    this.votes.clear();
    this.broadcastVote();
  }

  private broadcastVote(): void {
    const votes: Record<string, number> = {};
    for (const id of this.voteOptions) votes[id] = 0;
    for (const v of this.votes.values()) votes[v] = (votes[v] ?? 0) + 1;
    this.broadcast({ t: "arenaVote", options: this.voteOptions, votes });
  }

  private vote(player: Player, arena: string): void {
    if (player.conn.isBot || !this.voteOptions.includes(arena)) return;
    if (this.state !== "waiting" && this.state !== "ended") return;
    this.votes.set(player.conn.id, arena);
    this.broadcastVote();
  }

  // The countdown is about to start: count the votes (most wins; ties and
  // no votes at all are settled at random among the leaders).
  protected override beforeCountdown(): void {
    if (!this.voteOptions.length) return;
    const tally = new Map(this.voteOptions.map((id) => [id, 0]));
    for (const v of this.votes.values()) tally.set(v, (tally.get(v) ?? 0) + 1);
    const top = Math.max(...tally.values());
    const leaders = [...tally].filter(([, n]) => n === top).map(([id]) => id);
    const winner = leaders[Math.floor(Math.random() * leaders.length)];
    this.voteOptions = [];
    this.votes.clear();
    this.broadcastVote();
    const level = LEVELS[winner];
    if (level && level !== this.level) this.setArena(level);
  }

  private setArena(level: Level): void {
    this.level = level;
    this.projectiles.clear();
    this.pickups.clear();
    this.respawnAt.clear();
    this.broadcastPickups();
    this.falls.clear();
    this.clearConjured();
    for (const bot of this.bots.values()) bot.setLevel(navGridFor(level));
    this.broadcast({ t: "arena", levelId: level.id });
    this.broadcast({ t: "announce", text: `Next arena: ${level.name}` });
    console.log(`[${this.name}] arena: ${level.id}`);
  }

  protected override onJoinedRound(player: Player): void {
    player.conn.send({ t: "arena", levelId: this.level.id });
    const now = Date.now();
    for (const [id, c] of this.conjured) player.conn.send({ t: "conjure", id, box: c.box, ms: c.until - now });
    if (!this.voteOptions.length && this.state === "waiting") this.openVote();
    else this.broadcastVote();
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
    this.falls.delete(id);
    if (this.votes.delete(id)) this.broadcastVote();
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
      abilityReady: [0, 0],
      stealthUntil: 0,
      fortifyUntil: 0,
      chargeUntil: 0,
      chargeHit: false,
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
    for (const [id, c] of this.conjured) if (now >= c.until) this.unconjure(id);
    for (const player of this.players.values()) {
      const f = this.fighters.get(player.conn.id);
      if (f && f.stealthUntil && now >= f.stealthUntil) this.breakStealth(player);
    }
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
    else if (msg.t === "vote") this.vote(player, msg.arena);
    else if (msg.t === "ability") this.ability(player, msg.slot, msg.d);
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
    this.breakStealth(player);
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
        if (!lineOfSight(from, p, this.allBoxes())) continue;
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
    this.breakStealth(player);
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
    const o = dist3(clientO, expected) <= CAST_ORIGIN_SLACK && lineOfSight(expected, clientO, this.allBoxes()) ? clientO : expected;
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
      let hitT = segmentHitsLevel(spell.p, to, this.allBoxes(), 0.05);
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
      if (d > def.splashRadius || !lineOfSight(from, target.p, this.allBoxes())) continue;
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
    let amount = raw * (1 - CLASSES[f.cls].defense) * (Date.now() < f.fortifyUntil ? FORTIFY_FACTOR : 1);
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
    const to = this.nextCircle(from, stage.radius * (this.level.arena?.stormScale ?? 1));
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
      if (Math.hypot(x, z) <= STORM_CENTER_LIMIT * (this.level.arena?.stormScale ?? 1)) return [round1(x), round1(z), radius];
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
      if (player && Math.hypot(player.p[0] - cx, player.p[2] - cz) > r) this.damage(player, this.zone!.dps * (STORM_TICK_MS / 1000), null);
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

  protected override onPlayerMoved(player: Player, from: Vec3, to: Vec3, now: number): void {
    const list = this.history.get(player.conn.id) ?? [];
    list.push({ time: now, p: to });
    while (list.length && now - list[0].time > MELEE_HISTORY_MS) list.shift();
    this.history.set(player.conn.id, list);
    if (this.state !== "playing" || !this.alive.has(player.conn.id)) return;
    this.trackFall(player, from, to, now);
    this.chargeInto(player, from, to, now);
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

  // ---- Abilities (Phase 12) ----

  private allBoxes(): Box[] {
    return (this.boxCache ??= [...this.level.boxes, ...[...this.conjured.values()].map((c) => c.box)]);
  }

  private isStealthed(id: number, now = Date.now()): boolean {
    return (this.fighters.get(id)?.stealthUntil ?? 0) > now;
  }

  // While someone has vanished, nobody else's game hears where they are.
  protected override relayMove(player: Player, now: number): void {
    if (this.isStealthed(player.conn.id, now)) return;
    super.relayMove(player, now);
  }

  private breakStealth(player: Player): void {
    const f = this.fighters.get(player.conn.id);
    if (!f || !f.stealthUntil) return;
    f.stealthUntil = 0;
    this.broadcast({ t: "effect", id: player.conn.id, kind: "stealth", ms: 0 });
    super.relayMove(player, Date.now()); // here they are
  }

  // E (slot 0) or R (slot 1): whatever this player's class has there.
  ability(player: Player, slot: 0 | 1, d: Vec3): void {
    const now = Date.now();
    const f = this.fighters.get(player.conn.id);
    if (!this.canAct(player, f) || now < f.abilityReady[slot]) return;
    const id = CLASS_ABILITIES[f.cls][slot];
    const failed = this.useAbility(player, f, id, d, now);
    if (failed) {
      player.conn.send({ t: "abilityFailed", slot, reason: failed });
      return;
    }
    f.abilityReady[slot] = now + ABILITIES[id].cooldownMs * COOLDOWN_SLACK;
    if (id !== "stealth" && id !== "blink") this.breakStealth(player);
  }

  // Returns why it didn't work, or null.
  private useAbility(player: Player, f: Fighter, id: string, d: Vec3, now: number): string | null {
    const pid = player.conn.id;
    switch (id) {
      case "wall": {
        const spot = this.aimedFloor(player, d);
        if (!spot) return "Nothing to stand a wall on there.";
        const yaw = Math.atan2(-d[0], -d[2]);
        const box: Box = { pos: [spot[0], spot[1] + WALL_SIZE[1] / 2, spot[2]], size: WALL_SIZE, color: "#8a7f72", rot: [0, yaw, 0] };
        if ([...this.players.values()].some((p) => boxTouchesPlayer(box, p.p))) return "No room for a wall there.";
        this.conjure(box, ABILITIES.wall.durationMs!, now);
        return null;
      }
      case "pillar": {
        let spot = this.aimedFloor(player, d);
        if (!spot) return "Nothing to raise a pillar on there.";
        // Aimed at your own feet: it goes right under you and lifts you up.
        const underMe = Math.hypot(spot[0] - player.p[0], spot[2] - player.p[2]) < 1.4;
        if (underMe) {
          const floor = floorBelow(player.p[0], player.p[2], player.p[1], this.allBoxes());
          if (floor === null) return "Nothing to raise a pillar on there.";
          spot = [player.p[0], floor, player.p[2]];
        }
        const box: Box = { pos: [spot[0], spot[1] + PILLAR_HEIGHT / 2, spot[2]], size: [PILLAR_SIZE, PILLAR_HEIGHT, PILLAR_SIZE], color: "#7d6d5c" };
        if ([...this.players.values()].some((p) => (p !== player || !underMe) && boxTouchesPlayer(box, p.p))) return "No room for a pillar there.";
        this.conjure(box, ABILITIES.pillar.durationMs!, now);
        if (underMe) {
          this.falls.delete(pid);
          this.teleport(player, [spot[0], spot[1] + PILLAR_HEIGHT + 0.95, spot[2]]);
        }
        return null;
      }
      case "blink": {
        const from = eye(player.p);
        const end: Vec3 = [from[0] + d[0] * BLINK_RANGE, from[1] + d[1] * BLINK_RANGE, from[2] + d[2] * BLINK_RANGE];
        // Unpadded: standing right next to a wall mustn't count as hitting
        // it (the landing check below makes sure there's room to stand).
        const t = segmentHitsLevel(from, end, this.allBoxes(), 0);
        // As far as possible along your aim, short of any wall; if that
        // spot is taken (say, by a low wall you stepped over), come back
        // half a meter at a time until there's room to stand.
        let to: Vec3 | null = null;
        for (let dist = t === null ? BLINK_RANGE : t * BLINK_RANGE - 0.6; dist >= 1.5 && !to; dist -= 0.5) {
          const at: Vec3 = [from[0] + d[0] * dist, from[1] + d[1] * dist, from[2] + d[2] * dist];
          const floor = floorBelow(at[0], at[2], at[1], this.allBoxes());
          if (floor === null) continue;
          const spot: Vec3 = [at[0], floor + 0.95, at[2]];
          if (!this.allBoxes().some((b) => boxTouchesPlayer(b, [spot[0], spot[1] + 0.05, spot[2]]))) to = spot;
        }
        if (!to) return "No room to step there.";
        const before = player.p;
        this.falls.delete(pid);
        this.teleport(player, to);
        this.broadcast({ t: "effect", id: pid, kind: "blink", ms: 0, from: before, to });
        return null;
      }
      case "stealth":
        f.stealthUntil = now + ABILITIES.stealth.durationMs!;
        this.broadcast({ t: "effect", id: pid, kind: "stealth", ms: ABILITIES.stealth.durationMs! });
        return null;
      case "fortify":
        f.fortifyUntil = now + ABILITIES.fortify.durationMs!;
        this.broadcast({ t: "effect", id: pid, kind: "fortify", ms: ABILITIES.fortify.durationMs! });
        return null;
      case "charge":
        // The player rushes forward themselves (their own movement); the
        // server allows the extra distance and watches for who they hit.
        f.chargeUntil = now + CHARGE_TIME * 1000 + 300;
        f.chargeHit = false;
        player.moveCheck.grant(CHARGE_SPEED * CHARGE_TIME + 1);
        this.broadcast({ t: "effect", id: pid, kind: "charge", ms: CHARGE_TIME * 1000 });
        return null;
    }
    return "Not available.";
  }

  // Where your aim meets something you could stand on, within CONJURE_RANGE.
  private aimedFloor(player: Player, d: Vec3): Vec3 | null {
    const from = eye(player.p);
    const end: Vec3 = [from[0] + d[0] * CONJURE_RANGE, from[1] + d[1] * CONJURE_RANGE, from[2] + d[2] * CONJURE_RANGE];
    const t = segmentHitsLevel(from, end, this.allBoxes(), 0.05);
    // Hitting a wall: come back a little, so it goes in front of it.
    const dist = t === null ? CONJURE_RANGE : Math.max(0, t * CONJURE_RANGE - 0.5);
    const at: Vec3 = [from[0] + d[0] * dist, from[1] + d[1] * dist, from[2] + d[2] * dist];
    const floor = floorBelow(at[0], at[2], at[1] + 0.2, this.allBoxes());
    return floor === null ? null : [at[0], floor, at[2]];
  }

  private conjure(box: Box, ms: number, now: number): void {
    const id = nextConjureId++;
    this.conjured.set(id, { box, until: now + ms });
    this.boxCache = null;
    navGridIfBuilt(this.level)?.addObstacle(id, box); // (no bots yet: no map to update)
    for (const bot of this.bots.values()) bot.replan();
    this.broadcast({ t: "conjure", id, box, ms });
  }

  private unconjure(id: number): void {
    if (!this.conjured.delete(id)) return;
    this.boxCache = null;
    navGridIfBuilt(this.level)?.removeObstacle(id);
    this.broadcast({ t: "unconjure", id });
  }

  private clearConjured(): void {
    for (const id of [...this.conjured.keys()]) this.unconjure(id);
    navGridIfBuilt(this.level)?.clearObstacles();
  }

  // A charging Knight hits the first enemy along their path.
  private chargeInto(player: Player, from: Vec3, to: Vec3, now: number): void {
    const f = this.fighters.get(player.conn.id);
    if (!f || f.chargeHit || now > f.chargeUntil) return;
    for (const target of this.players.values()) {
      if (target === player || !this.alive.has(target.conn.id)) continue;
      // Closest point on this move to the target (flat), and roughly level.
      const [dx, dz] = [to[0] - from[0], to[2] - from[2]];
      const len2 = dx * dx + dz * dz || 1;
      const k = Math.max(0, Math.min(1, ((target.p[0] - from[0]) * dx + (target.p[2] - from[2]) * dz) / len2));
      const near = Math.hypot(from[0] + dx * k - target.p[0], from[2] + dz * k - target.p[2]);
      if (near > 1.3 || Math.abs(target.p[1] - to[1]) > 1.5) continue;
      f.chargeHit = true;
      const blocked = this.damage(target, CHARGE_DAMAGE, player, from);
      this.broadcast({ t: "melee", id: player.conn.id, weapon: "sword", hits: [target.conn.id], blocked: blocked ? [target.conn.id] : [], backstabs: [] });
      return;
    }
  }

  // ---- Falling and stomping ----

  // Watches each player's height from their moves: a drop starts when they
  // begin moving down, and ends when they stop. Then: fall damage, unless
  // they landed on someone.
  private trackFall(player: Player, from: Vec3, to: Vec3, now: number): void {
    const id = player.conn.id;
    const f = this.falls.get(id);
    const dt = f ? Math.max(0.02, (now - f.lastMove) / 1000) : 0.05;
    const vy = (to[1] - from[1]) / dt;
    if (to[1] < from[1] - 0.02) {
      // Going down.
      const fall = f && f.peak >= from[1] ? f : { peak: from[1], speed: 0, lastMove: now, lastY: to[1], stomped: false };
      fall.speed = Math.max(fall.speed, -vy);
      fall.lastMove = now;
      fall.lastY = to[1];
      this.falls.set(id, fall);
      if (!fall.stomped && fall.speed >= STOMP_SPEED && this.stomp(player, from, to, fall.peak - to[1])) fall.stomped = true;
      return;
    }
    if (f) {
      // Stopped going down: landed.
      this.falls.delete(id);
      const drop = f.peak - to[1];
      if (!f.stomped && f.speed >= FALL_SPEED && drop > SAFE_FALL) {
        this.damage(player, Math.round((drop - SAFE_FALL) * FALL_DAMAGE), null);
        player.conn.send({ t: "announce", text: `Ouch! A ${drop.toFixed(1)} m fall.` });
      }
    }
  }

  // Did this bit of falling land on someone's head? Hurts them, not you.
  private stomp(lander: Player, from: Vec3, to: Vec3, drop: number): boolean {
    const feetFrom = from[1] - 0.9;
    const feetTo = to[1] - 0.9;
    for (const victim of this.players.values()) {
      if (victim === lander || !this.alive.has(victim.conn.id)) continue;
      const head = victim.p[1] + 0.9;
      if (Math.hypot(to[0] - victim.p[0], to[2] - victim.p[2]) > 0.9) continue;
      if (feetFrom < head - 0.2 || feetTo > head + 0.3) continue;
      this.damage(victim, STOMP_DAMAGE + Math.round(Math.min(drop, 10) * STOMP_PER_METER), lander); // no source: shields don't help
      lander.conn.send({ t: "bounce" });
      this.broadcast({ t: "announce", text: `${lander.conn.name} landed on ${victim.conn.name}!` });
      return true;
    }
    return false;
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
    return new RoyaleBot(peer, navGridFor(this.level), () => this.allBoxes(), this.bots.size);
  }

  protected runBot(bot: RoyaleBot, me: Player, now: number, dt: number): void {
    const f = this.fighters.get(me.conn.id);
    const action = bot.think({
      now,
      dt,
      me,
      fighting: this.state === "playing" && this.alive.has(me.conn.id),
      practice: this.state === "waiting" || this.state === "ended",
      enemies: [...this.players.values()].filter((p) => p !== me && this.canBeHit(p.conn.id) && !this.isStealthed(p.conn.id, now)),
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
    if (action.ability) this.ability(me, action.ability.slot, action.ability.d);
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10;
