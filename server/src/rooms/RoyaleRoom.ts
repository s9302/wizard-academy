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
  type AbilityId,
  BLINK_RANGE,
  CHAIN,
  DECOY_ID_BASE,
  DECOYS,
  type FieldInfo,
  type FieldKind,
  FLAMES,
  GIANT,
  GLIDE,
  HELLPIT,
  inField,
  fieldCenter,
  INVERT_RANGE,
  NULLZONE_RADIUS,
  SHOCKWAVE,
  SMOKE_RADIUS,
  TORNADO,
  CHARGE_DAMAGE,
  CHARGE_KNOCK,
  CHARGE_SLOW_MS,
  FORTIFY_HEAL,
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
import { EYE_HEIGHT, GRAVITY, PLAYER_RADIUS, RUN_SPEED } from "../../../shared/src/constants.ts";
import { abilitiesFor, abilityAllowed } from "../../../shared/src/unlocks.ts";
import { boxTouchesPlayer, floorBelow, lerp3, lineOfSight, segmentHitsCapsule, segmentHitsLevel, segmentHitsPlayer } from "../../../shared/src/levels/geometry.ts";
import { MAX_MONSTERS, MONSTERS } from "../../../shared/src/monsters.ts";
import { Monsters } from "../monsters/Monsters.ts";
import type { CastMsg, ClientMsg, DecoyState, PickupInfo, Vec3, ZoneState } from "../../../shared/src/protocol.ts";
import { saveLoadout } from "../accounts.ts";
import { RoyaleBot } from "../bots/RoyaleBot.ts";
import type { BotPeer } from "../Connection.ts";
import { XP } from "../xp.ts";
import type { Player } from "./Room.ts";
import { arenasOfSize } from "../../../shared/src/levels/arenas.ts";
import { LEVELS } from "../../../shared/src/levels/index.ts";
import type { Box, Level, Pit } from "../../../shared/src/levels/types.ts";
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
  chargeHits: Set<number>; // who this charge already plowed through
  giantUntil: number; // Giant Form
};

// A lasting area on the ground (level 11+ abilities). hit: who a tornado already threw.
type Field = FieldInfo & { until: number; nextTick: number; hit: Set<number> };
type Decoy = DecoyState & { dir: [number, number]; until: number };
const FIELD_TICK_MS = 250;
const DECOY_BROADCAST_MS = 100;
let nextFieldId = 1;
let nextDecoyId = DECOY_ID_BASE;

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

// Something besides players that attacks can hit (monsters, a boss).
export type Body = { id: number; p: Vec3; radius: number; height: number };

export class RoyaleRoom extends RoundRoom<RoyaleBot> {
  protected fighters = new Map<number, Fighter>();
  protected alive = new Set<number>();
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
  // Monsters (Phase 16), and players just thrown by a jump pad (no fall damage).
  protected monsters: Monsters;
  private padGrace = new Map<number, number>();
  // What a subclass (BossRoom) turns off: players hurting each other, the
  // storm, and the arena vote between rounds.
  // Level 11+ abilities: areas on the ground, and Rogue copies.
  private fields = new Map<number, Field>();
  private decoys = new Map<number, Decoy>();
  private lastDecoyBroadcast = 0;
  protected friendlyFire = true;
  protected stormOn = true;
  protected voting = true;

  // fixedArena: the ROYALE_ARENA test setting (BossRoom passes null: its level is its own).
  constructor(info: ConstructorParameters<typeof RoundRoom>[0], level: Level, fixedArena: string | null = FIXED_ARENA ?? null) {
    super(info, (fixedArena && LEVELS[fixedArena]) || level);
    this.monsters = new Monsters({
      grid: () => navGridFor(this.level),
      // During a round they hunt whoever is still in it; between rounds,
      // anyone (practice: nobody gets hurt then anyway).
      prey: () =>
        [...this.players.values()]
          .filter((p) => !p.conn.isAdmin && this.canBeHit(p.conn.id) && !this.isStealthed(p.conn.id))
          .map((p) => ({ id: p.conn.id, p: p.p })),
      everyone: () => [...this.players.values()].map((p) => p.p),
      hurt: (id, amount, from, kind) => {
        const target = this.players.get(id);
        if (target) this.damage(target, amount, null, from, `was mauled by a ${MONSTERS[kind].name}`);
      },
    });
  }

  // ---- Round cycle (RoundRoom hooks) ----

  protected roundMs(): number {
    return ROUND_MS;
  }

  protected override onCountdown(): void {
    this.falls.clear(); // everyone was just moved to a spawn point
    this.monsters.reset(); // they come back somewhere else
    this.clearConjured();
    this.clearFields();
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
    if (!NO_STORM && this.stormOn) this.startStage([0, 0, this.level.arena?.stormRadius ?? STORM_START_RADIUS], now);
    this.broadcast({ t: "announce", text: this.playStartText() });
  }

  protected playStartText(): string {
    return "The storm is gathering. Last wizard standing wins!";
  }

  // Monsters, and whatever else a subclass adds (a boss), for hit tests.
  protected bodies(): Body[] {
    return [...this.monsters.bodies(), ...[...this.decoys.values()].map((d) => ({ id: d.id, p: d.p, radius: 0.45, height: 0.9 }))];
  }

  // A hit on a body that isn't a monster (a boss): return true if handled.
  protected hitOther(_id: number, _amount: number, _by: Player | null): boolean {
    return false;
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
    if (FIXED_ARENA || !this.voting) return;
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
    this.clearFields();
    this.monsters.reset();
    for (const bot of this.bots.values()) bot.setLevel(navGridFor(level));
    this.broadcast({ t: "arena", levelId: level.id });
    this.broadcast({ t: "announce", text: `Next arena: ${level.name}` });
    console.log(`[${this.name}] arena: ${level.id}`);
  }

  protected override onJoinedRound(player: Player): void {
    player.conn.send({ t: "arena", levelId: this.level.id });
    const now = Date.now();
    for (const [id, c] of this.conjured) player.conn.send({ t: "conjure", id, box: c.box, ms: c.until - now });
    for (const { until: _u, nextTick: _n, hit: _h, ...field } of this.fields.values()) player.conn.send({ t: "field", field });
    if (this.decoys.size) this.broadcastDecoys(now);
    if (!this.voteOptions.length && this.state === "waiting") this.openVote();
    else this.broadcastVote();
    // Joining mid-round: you watch until the next one. Everyone hears what
    // you're playing as (and holding).
    this.resetFighter(player);
    const conn = player.conn;
    conn.send({ t: "alive", ids: [...this.alive] });
    conn.send({ t: "zone", zone: this.zone });
    conn.send({ t: "pickups", items: this.pickupList() });
    conn.send({ t: "monsterCount", count: this.monsters.count, max: MAX_MONSTERS });
    conn.send({ t: "monsters", list: this.monsters.list() });
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
    this.padGrace.delete(id);
    if (this.votes.delete(id)) this.broadcastVote();
    // The last person left: the monsters go too.
    if (!player.conn.isBot && ![...this.players.values()].some((p) => !p.conn.isBot)) this.monsters.clearAll();
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
      chargeHits: new Set(),
      giantUntil: 0,
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
    const [e, r] = this.abilitiesOf(player, cls);
    player.conn.send({ t: "abilitySet", e, r });
  }

  // A player's E and R for a class: their pick if it's allowed, else the
  // defaults. Bots always have the defaults.
  private abilitiesOf(player: Player, cls: ClassId): [AbilityId, AbilityId] {
    const account = player.conn.account;
    if (!account || player.conn.isBot) return CLASS_ABILITIES[cls];
    const pair = abilitiesFor(account.loadout, cls);
    return pair.every((id) => abilityAllowed(cls, id, account.unlocked)) ? pair : CLASS_ABILITIES[cls];
  }

  private setAbilities(player: Player, cls: ClassId, e: AbilityId, r: AbilityId): void {
    const account = player.conn.account;
    if (!account || player.conn.isBot) return;
    if (!abilityAllowed(cls, e, account.unlocked) || !abilityAllowed(cls, r, account.unlocked)) return;
    account.loadout = { ...account.loadout, abil: { ...account.loadout.abil, [cls]: [e, r] } };
    saveLoadout(account.id, account.loadout).catch((err) => console.error(`saving abilities for ${account.username} failed:`, err));
    if (this.fighters.get(player.conn.id)?.cls === cls) player.conn.send({ t: "abilitySet", e, r });
  }

  // ---- Every tick ----

  protected override onRoundTick(now: number): void {
    const dt = Math.min(0.2, (now - this.lastStep) / 1000);
    this.lastStep = now;
    this.stepProjectiles(dt);
    this.stepFields(now, dt);
    const monsters = this.monsters.step(now, dt);
    if (monsters) this.broadcast({ t: "monsters", list: monsters });
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
    else if (msg.t === "abilities") this.setAbilities(player, msg.cls, msg.e, msg.r);
    else if (msg.t === "monsters" && !player.conn.isBot) {
      const before = this.monsters.count;
      const count = this.monsters.adjust(msg.action);
      this.broadcast({ t: "monsterCount", count, max: MAX_MONSTERS });
      if (count !== before) this.broadcast({ t: "announce", text: `${player.conn.name} ${count > before ? "let in a monster" : "sent a monster away"}.` });
    }
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
    const base = WEAPONS[weapon].melee!;
    // Giant Form: more reach, harder hits.
    const giant = now < (this.fighters.get(attacker.conn.id)?.giantUntil ?? 0);
    const m = giant ? { ...base, reach: base.reach * GIANT.reach, damage: base.damage * GIANT.damage } : base;
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
    // Monsters (and a boss) in reach take the hit too (all of them for a cleave).
    const reach = m.reach;
    const hitDamage = m.damage;
    for (const m of this.bodies()) {
      const flat = Math.hypot(m.p[0] - from[0], m.p[2] - from[2]) - m.radius;
      if (flat > reach || Math.abs(m.p[1] - attacker.p[1]) > MELEE_HEIGHT + m.height) continue;
      if (!inFront(yaw, [m.p[0] - from[0], m.p[2] - from[2]], WEAPONS[weapon].melee!.arcDeg) && flat > 0.4) continue;
      if (!lineOfSight(from, m.p, this.allBoxes())) continue;
      hits.push(m.id);
      this.hitMonster(m.id, hitDamage, attacker);
      if (!WEAPONS[weapon].melee!.cleave) break;
    }
    this.broadcast({ t: "melee", id: attacker.conn.id, weapon, hits, blocked, backstabs });
  }

  // A monster took a hit; finishing one off heals you a little.
  private hitMonster(id: number, amount: number, by: Player | null): void {
    const decoy = this.decoys.get(id);
    if (decoy) {
      if (by?.conn.id === decoy.owner) return; // your own copies ignore you
      this.decoys.delete(id);
      this.broadcast({ t: "effect", id: decoy.owner, kind: "blink", ms: 0, from: decoy.p }); // a puff where it was
      this.broadcastDecoys(Date.now());
      return;
    }
    if (this.hitOther(id, amount, by)) return;
    const kind = this.monsters.damage(id, amount);
    if (!kind) return;
    this.broadcast({ t: "monsterDied", id, kind, by: by?.conn.id ?? null });
    if (!by || by.conn.isBot) return;
    const f = this.fighters.get(by.conn.id);
    if (f && this.state === "playing" && this.alive.has(by.conn.id)) {
      f.hp = Math.min(f.maxHp, f.hp + MONSTERS[kind].heal);
      this.broadcast({ t: "health", id: by.conn.id, hp: f.hp, max: f.maxHp, shield: f.shield });
    }
    by.conn.send({ t: "announce", text: `You slew a ${MONSTERS[kind].name}!${this.state === "playing" ? ` +${MONSTERS[kind].heal} health` : ""}` });
  }

  // A spell: a Wizard's Spellbook spell (spell in hand), or a Fireball
  // (anyone with charges). Also used by bots.
  cast(player: Player, msg: Pick<CastMsg, "spell" | "o" | "d" | "seq">): void {
    const now = Date.now();
    const f = this.fighters.get(player.conn.id);
    if (!this.canAct(player, f)) return;
    if (this.inNullZone(player.p, now)) return; // no magic in a Null Zone
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
      if (spell.spell !== "arrow" && this.inNullZone(to, Date.now())) {
        this.projectiles.delete(spell.id);
        this.broadcast({ t: "spellEnd", id: spell.id, p: to, hit: null });
        continue;
      }

      // First thing along this tick's path: a wall, or a player.
      let hitT = segmentHitsLevel(spell.p, to, this.allBoxes(), 0.05);
      let hitPlayer: Player | null = null;
      let hitMonster: number | null = null;
      for (const target of this.players.values()) {
        if (target.conn.id === spell.caster || !this.canBeHit(target.conn.id)) continue;
        const t = segmentHitsPlayer(spell.p, to, target.p, def.radius);
        if (t !== null && (hitT === null || t < hitT)) {
          hitT = t;
          hitPlayer = target;
        }
      }
      for (const m of this.bodies()) {
        const t = segmentHitsCapsule(spell.p, to, m.p, Math.max(0, m.height - m.radius), m.radius, def.radius);
        if (t !== null && (hitT === null || t < hitT)) {
          hitT = t;
          hitPlayer = null;
          hitMonster = m.id;
        }
      }
      if (hitMonster !== null && hitT !== null) {
        const at = lerp3(spell.p, to, hitT);
        this.projectiles.delete(spell.id);
        this.broadcast({ t: "spellEnd", id: spell.id, p: at, hit: hitMonster });
        this.hitMonster(hitMonster, def.damage, this.players.get(spell.caster) ?? null);
        this.splash(spell, at, null);
        continue;
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
  protected canBeHit(id: number): boolean {
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
      if (def.slowMs && this.alive.has(hit.conn.id) && !this.unstoppable(hit)) {
        const f = this.fighters.get(hit.conn.id);
        if (f) f.slowedUntil = Date.now() + def.slowMs;
        this.broadcast({ t: "slowed", id: hit.conn.id, ms: def.slowMs });
      }
    }
    this.splash(spell, at, hit);
  }

  // Splash: everyone else near the blast, unless a wall is in the way. The
  // check starts a little back toward the caster so the wall it hit doesn't
  // block its own blast. Monsters get caught in it too.
  private splash(spell: Projectile, at: Vec3, hit: Player | null): void {
    const def = SPELLS[spell.spell];
    if (!def.splashRadius) return;
    const attacker = this.players.get(spell.caster) ?? null;
    const from = lerp3(at, [at[0] - spell.d[0], at[1] - spell.d[1], at[2] - spell.d[2]], 0.3);
    for (const m of this.bodies()) {
      const d = dist3(at, m.p);
      if (d > def.splashRadius + m.radius || !lineOfSight(from, m.p, this.allBoxes())) continue;
      this.hitMonster(m.id, Math.round(def.splashMax! - (def.splashMax! - def.splashMin!) * Math.min(1, d / def.splashRadius)), attacker);
    }
    if (this.state !== "playing") return;
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
  protected damage(target: Player, raw: number, attacker: Player | null, source?: Vec3, cause = "was swallowed by the storm"): boolean {
    const id = target.conn.id;
    const f = this.fighters.get(id);
    if (!f || !this.alive.has(id) || raw <= 0 || target.conn.isAdmin) return false; // admins can't be hurt
    if (!this.friendlyFire && attacker && attacker !== target) return false; // on the same side
    let amount = raw * (1 - CLASSES[f.cls].defense) * (Date.now() < f.fortifyUntil ? FORTIFY_FACTOR : 1) * (Date.now() < f.giantUntil ? GIANT.taken : 1);
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
    this.announceLeft(byOther ? `${attacker.conn.name} blasted ${target.conn.name}!` : `${target.conn.name} ${cause}.`);
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
    if ((this.fighters.get(id)?.stealthUntil ?? 0) > now) return true;
    const p = this.players.get(id)?.p;
    return !!p && this.fields.size > 0 && this.inSmoke(p, now);
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
    const id = this.abilitiesOf(player, f.cls)[slot];
    // Wizards' and Rogues' abilities are magic; Knights' aren't.
    if (f.cls !== "knight" && this.inNullZone(player.p, now)) {
      player.conn.send({ t: "abilityFailed", slot, reason: "Magic doesn't work in a Null Zone." });
      return;
    }
    const failed = this.useAbility(player, f, id, d, now);
    if (failed) {
      player.conn.send({ t: "abilityFailed", slot, reason: failed });
      return;
    }
    f.abilityReady[slot] = now + ABILITIES[id].cooldownMs * COOLDOWN_SLACK;
    if (id !== "stealth" && id !== "blink" && id !== "smoke" && id !== "decoys") this.breakStealth(player);
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
        if (this.state === "playing" && f.hp > 0) {
          f.hp = Math.min(f.maxHp, f.hp + FORTIFY_HEAL);
          this.broadcast({ t: "health", id: pid, hp: f.hp, max: f.maxHp, shield: f.shield });
        }
        this.broadcast({ t: "effect", id: pid, kind: "fortify", ms: ABILITIES.fortify.durationMs! });
        return null;
      case "charge":
        // The player rushes forward themselves (their own movement); the
        // server allows the extra distance and watches for who they hit.
        f.chargeUntil = now + CHARGE_TIME * 1000 + 300;
        f.chargeHits = new Set();
        player.moveCheck.grant(CHARGE_SPEED * CHARGE_TIME + 1);
        this.broadcast({ t: "effect", id: pid, kind: "charge", ms: CHARGE_TIME * 1000 });
        return null;
      default:
        return this.useMastery(player, f, id as AbilityId, d, now);
    }
    return "Not available.";
  }

  // ---- Level 11+ abilities ----

  private useMastery(player: Player, f: Fighter, id: AbilityId, d: Vec3, now: number): string | null {
    const pid = player.conn.id;
    const flat = norm2(d);
    const ms = ABILITIES[id].durationMs ?? 0;
    switch (id) {
      case "tornado": {
        const floor = floorBelow(player.p[0], player.p[2], player.p[1], this.allBoxes()) ?? player.p[1] - 0.95;
        const start: Vec3 = [player.p[0] + flat[0] * 2, floor, player.p[2] + flat[1] * 2];
        this.addField({ kind: "tornado", owner: pid, p: start, r: TORNADO.radius, d: [flat[0], 0, flat[1]] }, Math.min(ms, (TORNADO.range / TORNADO.speed) * 1000), now);
        return null;
      }
      case "flames": {
        const spot = this.aimedFloor(player, d);
        if (!spot) return "Nothing to burn there.";
        this.addField({ kind: "flames", owner: pid, p: spot, r: FLAMES.width / 2, yaw: Math.atan2(-d[0], -d[2]), len: FLAMES.length }, ms, now);
        return null;
      }
      case "hellpit": {
        const spot = this.aimedFloor(player, d);
        if (!spot) return "Nothing to open there.";
        this.addField({ kind: "hellpit", owner: pid, p: spot, r: HELLPIT.radius }, ms, now);
        return null;
      }
      case "smoke": {
        const spot = this.aimedFloor(player, d) ?? [player.p[0], player.p[1] - 0.95, player.p[2]];
        this.addField({ kind: "smoke", owner: pid, p: spot, r: SMOKE_RADIUS }, ms, now);
        return null;
      }
      case "nullzone": {
        const floor = floorBelow(player.p[0], player.p[2], player.p[1], this.allBoxes()) ?? player.p[1] - 0.95;
        this.addField({ kind: "nullzone", owner: pid, p: [player.p[0], floor, player.p[2]], r: NULLZONE_RADIUS }, ms, now);
        return null;
      }
      case "invert": {
        const target = this.aimedPlayer(player, d, INVERT_RANGE);
        if (!target) return "Missed: nobody there.";
        this.broadcast({ t: "effect", id: target.conn.id, kind: "invert", ms });
        return null;
      }
      case "chain": {
        const target = this.aimedPlayer(player, d, CHAIN.range);
        if (!target) return "Missed: nobody there.";
        const from = target.p;
        const away = Math.hypot(player.p[0] - from[0], player.p[2] - from[2]);
        if (this.state === "playing") this.damage(target, CHAIN.damage, player, player.p);
        if (away > 2.2) {
          const dir = norm2([player.p[0] - from[0], 0, player.p[2] - from[2]]);
          this.knock(target, dir[0] * CHAIN.speed, dir[1] * CHAIN.speed, 3, (away - 2) / CHAIN.speed);
        }
        this.broadcast({ t: "effect", id: target.conn.id, kind: "chain", ms: Math.round(((away - 2) / CHAIN.speed) * 1000), from: player.p, to: from });
        return null;
      }
      case "shockwave": {
        const from = player.p;
        for (const target of this.players.values()) {
          if (target === player || !this.canBeHit(target.conn.id) || target.conn.isAdmin) continue;
          const dx = target.p[0] - from[0];
          const dz = target.p[2] - from[2];
          const dist = Math.hypot(dx, dz);
          if (dist > SHOCKWAVE.radius || Math.abs(target.p[1] - from[1]) > 3 || !lineOfSight(eye(from), eye(target.p), this.allBoxes())) continue;
          if (this.state === "playing") this.damage(target, SHOCKWAVE.damage, player, from);
          if (this.friendlyFire || target.conn.isBot) {
            const dir = dist > 0.1 ? [dx / dist, dz / dist] : [Math.sin(Math.random() * 7), Math.cos(Math.random() * 7)];
            this.knock(target, dir[0] * SHOCKWAVE.push, dir[1] * SHOCKWAVE.push, SHOCKWAVE.lift, SHOCKWAVE.pushTime);
          }
        }
        for (const m of this.bodies()) {
          if (Math.hypot(m.p[0] - from[0], m.p[2] - from[2]) <= SHOCKWAVE.radius + m.radius) this.hitMonster(m.id, SHOCKWAVE.damage, player);
        }
        this.broadcast({ t: "effect", id: pid, kind: "shockwave", ms: 0, from });
        return null;
      }
      case "giant":
        f.giantUntil = now + ms;
        this.broadcast({ t: "effect", id: pid, kind: "giant", ms });
        return null;
      case "glide":
        // The player flies themselves (like a jump pad, then a slow fall);
        // the server allows the climb and the extra speed.
        player.moveCheck.grantUp((GLIDE.lift * GLIDE.lift) / (2 * GRAVITY) + 1.5);
        player.moveCheck.grant(RUN_SPEED * (GLIDE.speed - 1) * (ms / 1000) + 4);
        this.padGrace.set(pid, now + ms + 1500); // no fall damage
        this.broadcast({ t: "effect", id: pid, kind: "glide", ms });
        return null;
      case "decoys": {
        const yaw = Math.atan2(flat[0], flat[1]);
        for (let i = 0; i < DECOYS.count; i++) {
          const a = yaw + (i === 0 ? -DECOYS.spread : DECOYS.spread);
          const decoy: Decoy = { id: nextDecoyId++, owner: pid, p: [...player.p], ry: player.ry, dir: [Math.sin(a), Math.cos(a)], until: now + ms };
          this.decoys.set(decoy.id, decoy);
        }
        this.broadcastDecoys(now);
        return null;
      }
    }
    return "Not available.";
  }

  // The first other player along your aim (within range, not behind a wall).
  private aimedPlayer(player: Player, d: Vec3, range: number): Player | null {
    const from = eye(player.p);
    const end: Vec3 = [from[0] + d[0] * range, from[1] + d[1] * range, from[2] + d[2] * range];
    let best: Player | null = null;
    let bestT = segmentHitsLevel(from, end, this.allBoxes(), 0.05) ?? 1;
    for (const target of this.players.values()) {
      if (target === player || !this.canBeHit(target.conn.id) || target.conn.isAdmin) continue;
      if (!this.friendlyFire && !target.conn.isBot) continue; // allies in a boss fight
      const t = segmentHitsPlayer(from, end, target.p, 0.7);
      if (t !== null && t < bestT) {
        bestT = t;
        best = target;
      }
    }
    return best;
  }

  // Throw a player: horizontal (vx, vz) for `seconds`, and vy up. Their own
  // client moves them; the server allows the distance.
  private knock(target: Player, vx: number, vz: number, vy: number, seconds: number): void {
    if (target.conn.isBot || target.conn.isAdmin || this.unstoppable(target)) return;
    target.moveCheck.grant(Math.hypot(vx, vz) * seconds + 2);
    target.moveCheck.grantUp((vy * vy) / (2 * GRAVITY) + 1);
    target.conn.send({ t: "knock", v: [vx, vy, vz], s: seconds });
  }

  private addField(info: Omit<FieldInfo, "id" | "time" | "ms">, ms: number, now: number): void {
    const field: Field = { ...info, id: nextFieldId++, time: now, ms, until: now + ms, nextTick: now, hit: new Set() };
    this.fields.set(field.id, field);
    const { until: _u, nextTick: _n, hit: _h, ...shown } = field;
    this.broadcast({ t: "field", field: shown });
  }

  private clearFields(): void {
    for (const id of this.fields.keys()) this.broadcast({ t: "fieldEnd", id });
    this.fields.clear();
    if (this.decoys.size) {
      this.decoys.clear();
      this.broadcast({ t: "decoys", list: [] });
    }
  }

  private inNullZone(p: Vec3, now: number): boolean {
    for (const f of this.fields.values()) if (f.kind === "nullzone" && inField(f, p, now)) return true;
    return false;
  }

  private inSmoke(p: Vec3, now: number): boolean {
    for (const f of this.fields.values()) if (f.kind === "smoke" && inField(f, p, now)) return true;
    return false;
  }

  // Every tick: burning, dragging, throwing; copies running; things ending.
  private stepFields(now: number, dt: number): void {
    for (const field of [...this.fields.values()]) {
      if (now >= field.until) {
        this.fields.delete(field.id);
        this.broadcast({ t: "fieldEnd", id: field.id });
        continue;
      }
      const owner = this.players.get(field.owner) ?? null;
      const hurts = field.kind === "flames" || field.kind === "hellpit";
      if (field.kind === "tornado") {
        const c = fieldCenter(field, now);
        for (const target of this.players.values()) {
          if (target.conn.id === field.owner || field.hit.has(target.conn.id) || !this.canBeHit(target.conn.id) || !inField(field, target.p, now)) continue;
          if (!this.friendlyFire && !target.conn.isBot) continue;
          field.hit.add(target.conn.id);
          if (this.state === "playing") this.damage(target, TORNADO.damage, owner, c);
          this.knock(target, (field.d?.[0] ?? 0) * 6, (field.d?.[2] ?? 0) * 6, TORNADO.lift, 0.6);
        }
        for (const m of this.bodies()) {
          if (field.hit.has(m.id) || Math.hypot(m.p[0] - c[0], m.p[2] - c[2]) > field.r + m.radius) continue;
          field.hit.add(m.id);
          this.hitMonster(m.id, TORNADO.damage, owner);
        }
      } else if (hurts && now >= field.nextTick) {
        field.nextTick = now + FIELD_TICK_MS;
        const dps = field.kind === "flames" ? FLAMES.dps : HELLPIT.dps;
        const amount = Math.round((dps * FIELD_TICK_MS) / 1000);
        for (const target of this.players.values()) {
          if (target.conn.id === field.owner || !this.alive.has(target.conn.id) || !inField(field, target.p, now)) continue;
          if (this.state === "playing") this.damage(target, amount, owner, field.p, field.kind === "flames" ? "burned up" : "was dragged into the pit");
          if (field.kind === "hellpit" && (this.friendlyFire || target.conn.isBot) && !this.unstoppable(target, now)) {
            const f = this.fighters.get(target.conn.id);
            if (f) f.slowedUntil = now + 500;
            this.broadcast({ t: "slowed", id: target.conn.id, ms: 500 });
            const dx = field.p[0] - target.p[0];
            const dz = field.p[2] - target.p[2];
            const dist = Math.hypot(dx, dz);
            if (dist > 0.6) this.knock(target, (dx / dist) * HELLPIT.pull, (dz / dist) * HELLPIT.pull, 0, FIELD_TICK_MS / 1000);
          }
        }
        for (const m of this.bodies()) if (inField(field, m.p, now)) this.hitMonster(m.id, amount, owner);
      }
    }
    // Rogue copies run straight on; at a wall or an edge they turn.
    if (!this.decoys.size) return;
    const grid = navGridFor(this.level);
    for (const decoy of [...this.decoys.values()]) {
      if (now >= decoy.until) {
        this.decoys.delete(decoy.id);
        continue;
      }
      const nx = decoy.p[0] + decoy.dir[0] * DECOYS.speed * dt;
      const nz = decoy.p[2] + decoy.dir[1] * DECOYS.speed * dt;
      if (grid.isWalkable(nx, nz)) {
        const floor = grid.floorAt(nx, nz);
        decoy.p = [round1(nx), round1(floor + 0.95), round1(nz)];
      } else {
        const a = Math.random() * Math.PI * 2;
        decoy.dir = [Math.sin(a), Math.cos(a)];
      }
      decoy.ry = Math.atan2(-decoy.dir[0], -decoy.dir[1]);
    }
    if (now - this.lastDecoyBroadcast >= DECOY_BROADCAST_MS) this.broadcastDecoys(now);
  }

  private broadcastDecoys(now: number): void {
    this.lastDecoyBroadcast = now;
    this.broadcast({ t: "decoys", list: [...this.decoys.values()].map(({ id, owner, p, ry }) => ({ id, owner, p, ry: Math.round(ry * 100) / 100 })) });
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
    if (!f || now > f.chargeUntil) return;
    // Everyone along the way, once each: hit, shoved aside, slowed.
    const hits: number[] = [];
    const blockedIds: number[] = [];
    for (const target of this.players.values()) {
      if (target === player || !this.alive.has(target.conn.id) || f.chargeHits.has(target.conn.id)) continue;
      if (!this.friendlyFire && !target.conn.isBot) continue; // allies in a boss fight
      // Closest point on this move to the target (flat), and roughly level.
      const [dx, dz] = [to[0] - from[0], to[2] - from[2]];
      const len2 = dx * dx + dz * dz || 1;
      const k = Math.max(0, Math.min(1, ((target.p[0] - from[0]) * dx + (target.p[2] - from[2]) * dz) / len2));
      const near = Math.hypot(from[0] + dx * k - target.p[0], from[2] + dz * k - target.p[2]);
      if (near > 1.5 || Math.abs(target.p[1] - to[1]) > 1.5) continue;
      f.chargeHits.add(target.conn.id);
      hits.push(target.conn.id);
      if (this.damage(target, CHARGE_DAMAGE, player, from)) blockedIds.push(target.conn.id);
      if (!this.unstoppable(target, now)) {
        // Thrown to whichever side of the Knight's path they were on.
        const len = Math.hypot(dx, dz) || 1;
        const side = Math.sign((target.p[0] - from[0]) * -dz / len + (target.p[2] - from[2]) * dx / len) || 1;
        this.knock(target, (-dz / len) * side * CHARGE_KNOCK + (dx / len) * 6, (dx / len) * side * CHARGE_KNOCK + (dz / len) * 6, 5, 0.3);
        const tf = this.fighters.get(target.conn.id);
        if (tf) tf.slowedUntil = now + CHARGE_SLOW_MS;
        this.broadcast({ t: "slowed", id: target.conn.id, ms: CHARGE_SLOW_MS });
      }
    }
    // Monsters and a boss in the way take it too.
    for (const m of this.bodies()) {
      if (f.chargeHits.has(m.id) || Math.hypot(m.p[0] - to[0], m.p[2] - to[2]) > 1.5 + m.radius) continue;
      f.chargeHits.add(m.id);
      hits.push(m.id);
      this.hitMonster(m.id, CHARGE_DAMAGE, player);
    }
    if (hits.length) this.broadcast({ t: "melee", id: player.conn.id, weapon: "sword", hits, blocked: blockedIds, backstabs: [] });
  }

  // A fortified Knight can't be slowed or shoved.
  private unstoppable(player: Player, now = Date.now()): boolean {
    return now < (this.fighters.get(player.conn.id)?.fortifyUntil ?? 0);
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
      const padded = now < (this.padGrace.get(id) ?? 0);
      if (!f.stomped && !padded && f.speed >= FALL_SPEED && drop > SAFE_FALL) {
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

  // ---- Arena features (Phase 16) ----

  // Lava or the void: out of the round (between rounds, just back to a spawn).
  protected override onPit(player: Player, pit: Pit): void {
    const id = player.conn.id;
    if (this.state === "playing" && this.alive.has(id) && !player.conn.isAdmin) {
      this.damage(player, 9999, null, undefined, pit.kind === "lava" ? "fell into the lava" : "was swallowed by the void");
    }
    this.falls.delete(id);
    this.teleport(player, this.spawnPoint());
  }

  protected override onJumpPad(player: Player, now: number): void {
    this.padGrace.set(player.conn.id, now + 5000);
    this.falls.delete(player.conn.id);
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
      enemies: this.botEnemies(me, now),
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

  // Who a bot fights: other fighters, and monsters that come close.
  protected botEnemies(me: Player, now: number): Player[] {
    return [
      ...[...this.players.values()].filter((p) => p !== me && this.canBeHit(p.conn.id) && !this.isStealthed(p.conn.id, now)),
      ...this.bodies()
        .filter((m) => Math.hypot(m.p[0] - me.p[0], m.p[2] - me.p[2]) < 14)
        .map((m) => bodyAsEnemy(m)),
    ];
  }
}

// Bots aim at players; a monster or boss is given to them in the same shape.
export const bodyAsEnemy = (m: Body): Player => ({ conn: { id: m.id }, p: m.p, ry: 0 }) as unknown as Player;

const round1 = (n: number) => Math.round(n * 10) / 10;
// A direction's flat (x, z) part, normalized.
const norm2 = (d: Vec3): [number, number] => {
  const l = Math.hypot(d[0], d[2]) || 1;
  return [d[0] / l, d[2] / l];
};
