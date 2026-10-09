// Everything the battle royale adds to a game: classes and weapons, spells
// and arrows, the storm, pickups, health bars, and the HUD. Game.ts hands it
// the server's royale messages and the player's clicks; this decides what to
// draw and what to send.

import * as THREE from "three";
import {
  ABILITIES,
  type AbilityId,
  ASCEND,
  CHARGE_SPEED,
  CHARGE_TIME,
  CLASS_ABILITIES,
  CYCLONE,
  DRAGON,
  FLURRY,
  FROSTNOVA,
  GIANT,
  HOLYNOVA,
  ROCK,
  SHOCKWAVE,
  WHIRLWIND,
  WINDSTEP_SPEED,
} from "../../../shared/src/abilities.ts";
import { type ClassId, type Hand, moveSpeed, SWAP_MS, WEAPONS, type WeaponId, weaponOf } from "../../../shared/src/classes.ts";
import { castDirections, MAX_SHIELD, POWERUPS, type PowerupKind, type SpellId, type SpellSlot, SPELLS } from "../../../shared/src/combat.ts";
import type { Box, Level } from "../../../shared/src/levels/types.ts";
import type { ClientMsg, RoundState, ServerMsg, Vec3 } from "../../../shared/src/protocol.ts";
import type { RemotePlayers } from "../RemotePlayers.ts";
import type { ServerClock } from "../ServerClock.ts";
import { Pickups } from "./Pickups.ts";
import { RoyaleHud } from "./RoyaleHud.ts";
import { Spells } from "./Spells.ts";
import { Storm } from "./Storm.ts";
import { Viewmodel } from "./Viewmodel.ts";
import { MonsterViews, monsterModel } from "./Monsters.ts";
import { Fields } from "./Fields.ts";
import { Decoys } from "./Decoys.ts";
import { DEATH_SHOW_MS, setAvatarWeapon } from "../Avatar.ts";
import { particles } from "../graphics/Particles.ts";
import { glowMat } from "../bosses/BossView.ts";
import { isMonsterId } from "../../../shared/src/monsters.ts";
import { sound } from "../audio/Sound.ts";
import type { SynthId } from "../audio/synth.ts";

// The sound of casting each spell (and loosing an arrow).
const CAST_SOUND: Record<SpellId, SynthId> = { bolt: "bolt", frost: "frost", spark: "spark", fireball: "fireball", arrow: "arrow", holy: "spark", thorn: "arrow", ember: "fireball", hex: "frost", flame: "fireball", knife: "swing" };
const HITS = ["punch0", "punch1", "punch2"] as const;
const TEAM_COLORS = ["#ff4a4a", "#4a8cff"];

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export type RoyaleHooks = {
  send: (msg: ClientMsg) => void;
  myId: () => number;
  horde?: boolean; // Horde mode (on an ordinary arena)
  onSlowed: (ms: number) => void; // hit by Frost Shard: slow the player down
  onSpeed: (multiplier: number) => void; // class and hand set how fast you move
  feed: (text: string) => void; // a line in the message feed
  onArena: (levelId: string) => void; // the server switched arenas
  onConjure: (id: number, box: Box) => void; // a wizard's wall or pillar appeared
  onUnconjure: (id: number) => void;
  onCharge: (dir: THREE.Vector3, speed: number, seconds: number) => void; // rush forward (Knight)
  // Level 11+ abilities.
  onKnock: (v: Vec3, seconds: number) => void; // thrown by a shockwave, tornado or chain
  onGlide: (seconds: number) => void;
  onSoar: (seconds: number) => void; // Dragon Form: fly for a while
  onFreeze: (seconds: number) => void; // Frost Nova: can't move or jump
  onInvert: (ms: number) => void; // the world upside down
  onGiant: (ms: number) => void; // your own Giant Form (third-person body)
  onSpin: (ms: number) => void; // caught in a tornado: the view whirls
  onRock: (on: boolean) => void; // your own Rock Disguise (third-person body)
  onMultiJump: (seconds: number, jumps: number) => void; // Cloud Boots (a powerup)
  onDeath: () => void; // you're out: the view drops
  onRevive: () => void; // back in for a new round
  selfClone: () => THREE.Group; // an avatar of you (your Mirror Images)
  unlocked: () => Set<string>;
};

export class Royale {
  readonly hud: RoyaleHud;
  private spells: Spells;
  private storm: Storm;
  private pickups: Pickups;
  private viewmodel: Viewmodel;
  private monsters: MonsterViews;
  private fields: Fields;
  private decoys: Decoys;
  private scene: THREE.Scene;
  private chosen: [AbilityId, AbilityId]; // on E and R (the server says, with "abilitySet")
  private teams = new Map<number, 0 | 1>(); // a team round: who's on which
  private held = new Map<number, WeaponId>(); // what everyone has in hand (for their copies)
  private dyingUntil = new Map<number, number>(); // eliminated: shown falling until then
  private lastUpdate = performance.now();
  private remotes: RemotePlayers;
  private hooks: RoyaleHooks;
  private state: RoundState = "waiting";
  private alive = new Set<number>();
  private health = new Map<number, { hp: number; max: number; shield: number }>();
  private myShots = new Set<number>(); // server ids of my spells and arrows in flight
  private seq = 0;
  private readyAt: Record<SpellSlot, number> = { primary: 0, fireball: 0 }; // performance.now()
  private primary: SpellId; // the Wizard's Spellbook spell
  private fireballs = 0;
  private cls: ClassId;
  private hand: Hand = "main";
  private handReadyAt = 0;
  private abilityReadyAt: [number, number] = [0, 0]; // performance.now()
  private pendingCls: ClassId | null = null; // picked mid-round
  private myHealth = { hp: -1, shield: 0 };
  private inStorm = false;


  constructor(scene: THREE.Scene, camera: THREE.Camera, hudEl: HTMLElement, clock: ServerClock, level: Level, roomName: string, remotes: RemotePlayers, primary: SpellId, cls: ClassId, hooks: RoyaleHooks) {
    this.primary = primary;
    this.cls = cls;
    this.hooks = hooks;
    this.remotes = remotes;
    this.storm = new Storm(scene);
    this.spells = new Spells(scene, clock, level.boxes);
    this.pickups = new Pickups(scene);
    this.viewmodel = new Viewmodel(camera);
    this.monsters = new MonsterViews(scene, (owner) => {
      const me = hooks.myId();
      if (owner === me || hooks.horde || level.bossFight) return true; // (co-op: everyone's on your side)
      const mine = this.teams.get(me);
      return mine !== undefined && this.teams.get(owner) === mine;
    });
    this.scene = scene;
    this.chosen = CLASS_ABILITIES[cls];
    this.fields = new Fields(scene, clock);
    this.decoys = new Decoys(
      scene,
      (owner) => {
        // A copy holds what its owner holds, too.
        const clone = owner === hooks.myId() ? hooks.selfClone() : remotes.cloneOf(owner);
        if (clone) setAvatarWeapon(clone, this.weaponOf(owner));
        return clone;
      },
      (owner) => {
        const h = this.health.get(owner) ?? { hp: 100, max: 100, shield: 0 };
        return { hp: h.hp / h.max, shield: h.shield / MAX_SHIELD };
      },
    );
    this.hud = new RoyaleHud(hudEl, clock, this.storm, roomName, {
      onBots: (action) => hooks.send({ t: "bots", action }),
      onMonsters: (action, kind) => hooks.send({ t: "monsters", action, kind }),
      onClass: (c) => this.pickClass(c),
      onVote: (arena) => hooks.send({ t: "vote", arena }),
      onMode: (mode) => hooks.send({ t: "mode", mode }),
      onPickTeam: (team) => hooks.send({ t: "pickTeam", team }),
      onBotSet: (id, change) => hooks.send({ t: "botSet", id, ...change }),
      onReady: () => hooks.send({ t: "ready" }),
      onMap: (map) => hooks.send({ t: "chaseMap", map }),
      onAbilities: (e, r) => {
        this.chosen = [e, r];
        this.applyLoadout();
        hooks.send({ t: "abilities", cls: this.cls, e, r });
      },
    }, hooks.horde ? "horde" : level.bossFight ? "boss" : level.ctf ? "ctf" : "royale");
    this.applyLoadout();
    window.addEventListener("keydown", this.onKey);
  }

  // Enter: vote to start the next round (between rounds).
  private onKey = (e: KeyboardEvent): void => {
    if (e.key !== "Enter" || e.repeat || (this.state !== "waiting" && this.state !== "ended")) return;
    if ((e.target as HTMLElement)?.tagName === "INPUT") return;
    this.hooks.send({ t: "ready" });
  };

  // What's in hand (the third-person body holds it too).
  get currentWeapon(): WeaponId {
    return this.weapon;
  }

  private thirdPerson = false;
  setThirdPerson(on: boolean): void {
    this.thirdPerson = on;
    this.viewmodel.setVisible(!on && (this.state !== "playing" || this.alive.has(this.hooks.myId())));
  }

  private get weapon(): WeaponId {
    return weaponOf(this.cls, this.hand);
  }

  // Class or hand changed: HUD, the weapon in view, and movement speed.
  private applyLoadout(): void {
    this.hud.loadout(this.cls, this.hand, this.primary, SPELLS[this.primary].name, SPELLS[this.primary].cooldownMs);
    this.viewmodel.show(this.weapon, SPELLS[this.primary].color);
    this.applySpeed();
    this.hud.showAbilities(this.cls, this.chosen, this.hooks.unlocked());
  }

  // Returns true if it was a royale message.
  onMessage(msg: ServerMsg): boolean {
    const me = this.hooks.myId();
    switch (msg.t) {
      case "round":
        if (msg.state === "playing" && this.state !== "playing") {
          sound.play("bell");
          sound.fx("go", { volume: 0.6 });
        }
        if (msg.state === "ended" && this.state === "playing") {
          sound.fx(this.alive.has(me) ? "victory" : "defeat");
        }
        sound.music(msg.state === "playing" || msg.state === "countdown" ? "arenaBattle" : "arenaLobby");
        this.state = msg.state;
        this.hud.round(msg.state, msg.endsAt);
        this.refreshVisibility();
        return true;
      case "roundResult":
        this.hud.result(msg.title, msg.lines);
        return true;
      case "botCount":
        this.hud.botCount(msg.count, msg.max);
        return true;
      case "monsterCount":
        this.hud.monsterCount(msg.count, msg.max);
        return true;
      case "monsters":
        this.monsters.set(msg.list);
        return true;
      case "monsterDied":
        this.monsters.died(msg.id);
        if (msg.by === me) this.hud.hitMarker();
        return true;
      case "alive": {
        if (this.state === "playing" && this.alive.has(me) && !msg.ids.includes(me)) sound.fx("defeat");
        else if (this.state === "playing" && msg.ids.length < this.alive.size) sound.play("bell2", { volume: 0.35, rate: 1.5 });
        const now = performance.now();
        const next = new Set(msg.ids);
        // Just eliminated (mid-round): they fall, and are shown until they've sunk away.
        if (this.state === "playing") {
          for (const id of this.alive) {
            if (next.has(id)) continue;
            if (id === me) {
              this.hooks.onDeath();
              continue;
            }
            this.remotes.die(id);
            this.dyingUntil.set(id, now + DEATH_SHOW_MS);
            const at = this.remotes.positionOf(id);
            if (at) {
              particles.emit({ at, count: 30, color: "#e6d4ff", color2: "#7a4fd0", speed: 1.5, up: 2, spread: 0.4, life: 1.4, size: 0.2, gravity: -1 });
              setTimeout(() => particles.emit({ at, count: 40, color: "#c58fff", color2: "#ffffff", speed: 0.6, up: 2.5, spread: 0.6, life: 1.6, size: 0.25, gravity: -1.5 }), DEATH_SHOW_MS - 900);
            }
          }
        }
        // Back in (a new round): stand up.
        for (const id of next) {
          if (this.alive.has(id)) continue;
          if (id === me) this.hooks.onRevive();
          else this.remotes.revive(id);
          this.dyingUntil.delete(id);
        }
        this.alive = next;
        this.hud.alive(msg.ids.length, this.alive.has(me));
        this.showTeams();
        this.viewmodel.setVisible(!this.thirdPerson && (this.state !== "playing" || this.alive.has(me)));
        this.refreshVisibility();
        return true;
      }
      case "health":
        this.health.set(msg.id, { hp: msg.hp, max: msg.max, shield: msg.shield });
        if (msg.id === me) {
          this.healthSound(msg.hp, msg.shield);
          this.hud.health(msg.hp, msg.max, msg.shield);
        }
        else this.remotes.setHealth(msg.id, msg.hp / msg.max, msg.shield / MAX_SHIELD);
        this.decoys.setHealth(msg.id, msg.hp / msg.max, msg.shield / MAX_SHIELD);
        return true;
      case "equip":
        this.held.set(msg.id, weaponOf(msg.cls, msg.hand));
        if (msg.id === me) {
          // The server's word on our class and hand. A new class starts with
          // its abilities ready (the server resets them too).
          if (msg.cls !== this.cls) this.abilityReadyAt = [0, 0];
          this.cls = msg.cls;
          this.hand = msg.hand;
          if (this.pendingCls === msg.cls) {
            this.pendingCls = null;
            this.hud.pending(null);
          }
          this.applyLoadout();
        } else this.remotes.setWeapon(msg.id, weaponOf(msg.cls, msg.hand));
        return true;
      case "melee":
        this.meleeSounds(msg.id, me, msg.hits, msg.blocked, msg.backstabs);
        if (msg.id !== me) this.remotes.swing(msg.id);
        for (const id of msg.hits) if (id !== me && !this.monsters.flash(id)) this.remotes.flash(id);
        if (msg.id === me && msg.hits.length) this.hud.hitMarker();
        if (msg.id === me && msg.backstabs.length) this.hud.callout("Backstab!");
        if (msg.id === me && msg.blocked.length) this.hud.callout("Blocked");
        if (msg.blocked.includes(me)) this.hud.callout("Blocked!");
        if (msg.backstabs.includes(me)) this.hooks.feed("Stabbed in the back!");
        return true;
      case "zone":
        this.storm.set(msg.zone);
        return true;
      case "arena":
        this.hooks.onArena(msg.levelId);
        return true;
      case "conjure":
        this.hooks.onConjure(msg.id, msg.box);
        return true;
      case "unconjure":
        this.hooks.onUnconjure(msg.id);
        return true;
      case "abilityFailed":
        sound.play("error", { volume: 0.5 });
        this.abilityReadyAt[msg.slot] = 0; // not spent
        this.hud.callout(msg.reason);
        return true;
      case "effect":
        this.effect(msg.id === me, msg.id, msg.kind, msg.ms, msg.from, msg.to);
        return true;
      case "field":
        this.fields.add(msg.field);
        return true;
      case "fieldEnd":
        this.fields.remove(msg.id);
        return true;
      case "knock":
        this.hooks.onKnock(msg.v, msg.s);
        return true;
      case "decoys":
        this.decoys.set(msg.list);
        return true;
      case "abilitySet":
        this.chosen = [msg.e, msg.r];
        this.applyLoadout();
        return true;
      case "arenaVote":
        this.hud.vote(msg.options, msg.votes);
        return true;
      case "chaseMaps": // Horde's map picker
        this.hud.maps(msg.maps, msg.current, msg.next);
        return true;
      case "lineup":
        this.hud.lineup(msg.players, msg.mode, msg.next, me);
        return true;
      case "respawnIn":
        this.hud.respawnIn(msg.ms);
        return true;
      case "horde":
        this.hud.hordeState(msg);
        return true;
      case "readyState":
        this.hud.readyState(msg.ids.length, msg.needed, msg.ids.includes(me), msg.on);
        return true;
      case "teams":
        this.teams.clear();
        msg.teams?.forEach((ids, team) => ids.forEach((id) => this.teams.set(id, team as 0 | 1)));
        this.showTeams();
        return true;
      case "pickups":
        this.pickups.set(msg.items);
        return true;
      case "held":
        if (msg.kind) sound.play("pickup", { volume: 0.7, rate: 1.3 });
        this.heldPowerup = msg.kind;
        this.hud.powerup(msg.kind);
        return true;
      case "charges":
        if (msg.fireball > this.fireballs) sound.play("pickup", { volume: 0.7 });
        this.fireballs = msg.fireball;
        this.hud.charges(msg.fireball);
        return true;
      case "spell": {
        const mine = msg.caster === me;
        this.spellKinds.set(msg.id, msg.spell);
        if (mine) this.myShots.add(msg.id);
        else if (msg.k === 0) sound.fx(CAST_SOUND[msg.spell], { at: msg.o, volume: 0.8 });
        this.spells.started(msg.id, msg.spell, msg.o, msg.d, msg.time, mine ? `${msg.seq}:${msg.k}` : null);
        if (!mine) this.remotes.swing(msg.caster);
        return true;
      }
      case "slowed":
        sound.play("glass", { at: msg.id === me ? null : this.remotes.positionOf(msg.id), volume: 0.6 });
        if (msg.id === me) this.hooks.onSlowed(msg.ms);
        else this.remotes.chill(msg.id, msg.ms);
        return true;
      case "spellEnd":
        this.impactSound(msg.id, msg.p, msg.hit, me);
        this.spells.ended(msg.id, msg.p);
        if (msg.hit !== null && msg.hit !== me && !(isMonsterId(msg.hit) && this.monsters.flash(msg.hit))) this.remotes.flash(msg.hit);
        if (msg.hit !== null && this.myShots.has(msg.id)) this.hud.hitMarker();
        this.myShots.delete(msg.id);
        return true;
      default:
        return false;
    }
  }

  // A new remote player appeared: health bar, weapon, and the right visibility.
  onRemoteAdded(id: number): void {
    const h = this.health.get(id) ?? { hp: 100, max: 100, shield: 0 };
    this.remotes.setHealth(id, h.hp / h.max, h.shield / MAX_SHIELD);
    this.refreshVisibility();
    if (this.teams.size) this.showTeams();
  }

  // During a round, only those still in it are shown; spectators are invisible.
  private refreshVisibility(): void {
    const hide = this.state === "playing";
    const now = performance.now();
    this.remotes.forEachId((id) => this.remotes.setVisible(id, !hide || this.alive.has(id) || now < (this.dyingUntil.get(id) ?? 0)));
  }

  // E (slot 0) / R (slot 1): this class's ability. The server does the work
  // (and says if it didn't); a Knight's charge is our own movement.
  ability(slot: 0 | 1, origin: THREE.Vector3, dir: THREE.Vector3, at?: THREE.Vector3): void {
    const now = performance.now();
    if (!this.hud.canAct || now < this.abilityReadyAt[slot]) return;
    const id = this.chosen[slot];
    if (this.cls !== "knight" && this.cls !== "monk" && this.fields.inNullZone(origin)) {
      this.hud.callout("No magic here!");
      return;
    }
    this.abilityReadyAt[slot] = now + ABILITIES[id].cooldownMs;
    const o: Vec3 = [round3(origin.x), round3(origin.y), round3(origin.z)];
    const msg: ClientMsg = { t: "ability", slot, o, d: [dir.x, dir.y, dir.z] };
    if (at) msg.at = [round3(at.x), round3(at.y), round3(at.z)];
    this.hooks.send(msg);
    if (id === "charge") this.hooks.onCharge(new THREE.Vector3(dir.x, 0, dir.z), CHARGE_SPEED, CHARGE_TIME);
    if (id === "flurry") this.hooks.onCharge(new THREE.Vector3(dir.x, 0, dir.z), FLURRY.speed, FLURRY.time);
  }

  // What a spell or arrow sounds like when it lands.
  private spellKinds = new Map<number, SpellId>();
  private impactSound(id: number, p: Vec3, hit: number | null, me: number): void {
    const kind = this.spellKinds.get(id);
    this.spellKinds.delete(id);
    const at = hit === me ? null : p;
    if (kind === "fireball") sound.fx("explosion", { at: p });
    else if (hit !== null) sound.play(kind === "arrow" ? "chop" : [...HITS], { at, volume: 0.9 });
    else sound.fx("fizzle", { at: p, volume: kind === "arrow" ? 0.3 : 0.5 });
  }

  private meleeSounds(attacker: number, me: number, hits: number[], blocked: number[], backstabs: number[]): void {
    if (attacker !== me) {
      const at = this.remotes.positionOf(attacker);
      sound.fx("swing", { at, volume: 0.8 });
    }
    const where = (id: number) => (id === me ? null : this.remotes.positionOf(id));
    for (const id of blocked) sound.play(["metalHeavy0", "metalHeavy1"], { at: where(id) });
    for (const id of backstabs) sound.play(["knifeSlice", "knifeSlice2"], { at: where(id) });
    for (const id of hits) if (!blocked.includes(id)) sound.play(["chop", ...HITS], { at: where(id), volume: 0.9 });
  }

  // Our own health changed: hurt, healed, or warded.
  private healthSound(hp: number, shield: number): void {
    const prev = this.myHealth;
    this.myHealth = { hp, shield };
    if (prev.hp < 0) return; // first report
    const lost = prev.hp + prev.shield - (hp + shield);
    if (shield > prev.shield && lost < 0) sound.fx("ward");
    else if (hp > prev.hp) sound.play("confirm", { volume: 0.6 });
    else if (lost > 0) {
      if (this.inStorm && lost <= 30) sound.fx("thunder", { volume: 0.7 });
      else sound.play(["punchHeavy0", "punchHeavy1"], { volume: 0.8 });
    }
  }

  private effect(mine: boolean, id: number, kind: string, ms: number, from?: Vec3, to?: Vec3): void {
    const at = mine ? null : (to ?? this.remotes.positionOf(id));
    if (kind === "blink") {
      if (from && !mine) sound.fx("blink", { at: from, volume: 0.7 });
      sound.fx("blink", { at });
    } else if (kind === "stealth" && ms > 0) sound.fx("stealth", { at });
    else if (kind === "fortify" && ms > 0) sound.fx("fortify", { at });
    else if (kind === "charge" && ms > 0) sound.fx("charge", { at });
    if (kind === "blink") {
      if (from) this.spells.puff(from);
      if (to) this.spells.puff(to);
    } else if (kind === "stealth") {
      if (mine) this.hud.stealthed(ms > 0);
      else this.remotes.setVisible(id, ms === 0 && (this.state !== "playing" || this.alive.has(id)));
    } else if (kind === "fortify" && !mine) {
      this.remotes.glow(id, "#c9a227", ms);
    }
    if (mine && kind === "fortify") this.hud.callout("Fortified!");
    this.masteryEffect(mine, id, kind, ms, at, from, to);
  }

  private weaponOf(id: number): WeaponId | null {
    return id === this.hooks.myId() ? this.weapon : (this.held.get(id) ?? null);
  }

  // Team rings under everyone, and the HUD's team counts.
  private showTeams(): void {
    const me = this.hooks.myId();
    this.remotes.forEachId((id) => {
      const team = this.teams.get(id);
      this.remotes.setTeam(id, team === undefined ? null : TEAM_COLORS[team]);
    });
    const alive: [number, number] = [0, 0];
    for (const id of this.alive) {
      const t = this.teams.get(id);
      if (t !== undefined) alive[t] += 1;
    }
    this.hud.setTeam(this.teams.get(me) ?? null, alive);
  }

  // How fast you move: your class and hand, times whatever's on you now.
  private boosts = { windstep: 0, ascend: 0, frozen: 0, rock: 0, haste: 0 }; // until (performance.now)
  private applySpeed(): void {
    const now = performance.now();
    const b = this.boosts;
    this.hooks.onSpeed(moveSpeed(this.cls, this.hand) * (now < b.windstep ? WINDSTEP_SPEED : 1) * (now < b.ascend ? ASCEND.speed : 1) * (now < b.frozen ? 0 : 1) * (now < b.rock ? ROCK.speed : 1) * (now < b.haste ? POWERUPS.haste.speed : 1));
  }
  private boost(kind: keyof Royale["boosts"], ms: number): void {
    this.boosts[kind] = performance.now() + ms;
    this.applySpeed();
    setTimeout(() => this.applySpeed(), ms + 20);
  }

  // The powerup in your pocket (the server's word for it); F uses it.
  heldPowerup: PowerupKind | null = null;
  usePowerup(): void {
    if (!this.heldPowerup || !this.hud.canAct) return;
    this.hooks.send({ t: "usePowerup" });
  }

  private powerupEffect(mine: boolean, id: number, kind: "haste" | "quadjump" | "fury", ms: number, where: Vec3 | null): void {
    const color = { haste: "#ffe14a", quadjump: "#dff3ff", fury: "#ff3b3b" }[kind];
    sound.fx(kind === "fury" ? "fortify" : "blink", { at: mine ? null : where, rate: kind === "haste" ? 1.5 : 1.1 });
    if (where) particles.emit({ at: where, count: 35, color, color2: "#ffffff", speed: 3, up: 2, life: 0.7, size: 0.18 });
    if (!mine) {
      this.remotes.glow(id, color, ms);
      return;
    }
    if (kind === "haste") this.boost("haste", ms);
    if (kind === "quadjump") this.hooks.onMultiJump(ms / 1000, POWERUPS.quadjump.jumps);
    this.hud.callout(kind === "haste" ? "Haste!" : kind === "quadjump" ? "Cloud Boots! Jump four times in a row" : "Fury! You hit harder");
  }

  // Rock Disguise: your own (until when), and who else is a rock right now.
  private rockUntil = 0;
  private rocks = new Map<number, number>(); // id -> until (performance.now)
  private rockEffect(mine: boolean, id: number, ms: number, where: Vec3 | null): void {
    sound.play(["mining0", "mining1"], { at: mine ? null : where, rate: 0.7 });
    if (where) particles.emit({ at: [where[0], where[1] - 0.4, where[2]], count: 30, color: "#a8a3b5", color2: "#6b6577", speed: 2.5, up: 2, life: 0.6, size: 0.22 });
    if (mine) {
      this.rockUntil = ms > 0 ? performance.now() + ms : 0;
      this.boosts.rock = this.rockUntil;
      this.applySpeed();
      this.viewmodel.setHidden(ms > 0 || performance.now() < this.dragonUntil);
      this.hooks.onRock(ms > 0);
      if (ms > 0) {
        this.hud.callout("You're a rock! Attack or use E/R to turn back");
        setTimeout(() => {
          if (this.rockUntil && performance.now() >= this.rockUntil - 50) this.rockEffect(true, id, 0, null);
        }, ms + 20);
      }
      return;
    }
    if (ms > 0) {
      this.remotes.disguise(id, rockModel(), true);
      this.rocks.set(id, performance.now() + ms);
    } else if (this.rocks.delete(id)) this.remotes.disguise(id, null);
  }

  // Dragon Form: until when you're one, and who else is (their dragon bodies).
  private dragonUntil = 0;
  private dragons = new Map<number, { wings: THREE.Object3D[]; until: number }>();

  // A ring blasting outward from a spot, `radius` wide in the end.
  private ringBurst(from: Vec3, radius: number, color: string, ms = 380, y = -0.6): void {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.22, 6, 48), glowMat(color, 2.5));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(from[0], from[1] + y, from[2]);
    this.scene.add(ring);
    const start = performance.now();
    const grow = () => {
      const k = (performance.now() - start) / ms;
      ring.scale.setScalar(0.5 + k * radius);
      if (k < 1) requestAnimationFrame(grow);
      else {
        this.scene.remove(ring);
        ring.geometry.dispose();
      }
    };
    grow();
  }

  // The level 15/20/25 abilities' effects.
  private legendEffect(mine: boolean, id: number, kind: string, ms: number, at: Vec3 | null, from?: Vec3, to?: Vec3): boolean {
    const where = from ?? at ?? (mine ? null : this.remotes.positionOf(id));
    switch (kind) {
      case "freeze":
        sound.play("glass", { at, rate: 0.7 });
        if (mine) {
          this.boost("frozen", ms);
          this.hooks.onFreeze(ms / 1000);
          this.hud.callout("Frozen solid!");
        } else this.remotes.chill(id, ms);
        if (where) particles.emit({ at: where, count: 25, color: "#e6fbff", color2: "#8fe3ff", speed: 1.5, life: 0.8, size: 0.2 });
        return true;
      case "frostnova":
        if (where) {
          this.ringBurst(where, FROSTNOVA.radius, "#bff4ff");
          particles.emit({ at: where, count: 80, color: "#ffffff", color2: "#8fe3ff", speed: 9, up: 1, life: 0.7, size: 0.25 });
        }
        sound.fx("frost", { at, rate: 0.6 });
        sound.play("glass", { at });
        return true;
      case "whirlwind":
      case "cyclone":
        if (where) {
          this.ringBurst(where, kind === "cyclone" ? CYCLONE.radius : WHIRLWIND.radius, kind === "cyclone" ? "#bff5ff" : "#e6e0cc", 260, -0.2);
          particles.emit({ at: where, count: 40, color: "#e6e6f0", color2: "#9aa3b8", speed: 6, up: 1.5, life: 0.5, size: 0.2 });
        }
        sound.fx("heavySwing", { at, rate: 0.8 });
        sound.fx("rumble", { at, volume: 0.5 });
        return true;
      case "holynova":
        if (where) {
          this.ringBurst(where, HOLYNOVA.radius, "#ffe9a0", 420);
          particles.emit({ at: where, count: 70, color: "#fff6c8", color2: "#ffd25a", speed: 6, up: 2, life: 0.8, size: 0.25 });
        }
        sound.fx("levelUp", { at, volume: 0.7 });
        return true;
      case "fists":
        if (to) particles.emit({ at: to, count: 50, color: "#fff2c8", color2: "#ffb347", speed: 5, up: 0.5, spread: 1.5, life: 0.4, size: 0.18 });
        sound.play(["punch0", "punch1", "punch2"], { at, rate: 1.4 });
        setTimeout(() => sound.play(["punch0", "punch1", "punch2"], { at, rate: 1.6 }), 90);
        setTimeout(() => sound.play(["punch0", "punch1", "punch2"], { at, rate: 1.5 }), 180);
        return true;
      case "rally":
        sound.fx("fortify", { at, rate: 0.8 });
        if (mine) this.hud.callout("Rallied! Less damage for a while");
        else this.remotes.glow(id, "#ffcf5a", ms);
        return true;
      case "ascend":
        sound.fx("levelUp", { at, rate: 0.7 });
        if (mine) {
          this.boost("ascend", ms);
          this.hud.callout("Transcendence!");
        } else this.remotes.glow(id, "#fff2a8", ms);
        if (where) particles.emit({ at: where, count: 60, color: "#fff6c8", color2: "#bff5ff", speed: 3, up: 3, life: 1, size: 0.2 });
        return true;
      case "rock":
        this.rockEffect(mine, id, ms, where);
        return true;
      case "haste":
      case "quadjump":
      case "fury":
        this.powerupEffect(mine, id, kind, ms, where);
        return true;
      case "dragon": {
        sound.fx("rumble", { at, rate: 1.3 });
        sound.fx("fireball", { at });
        if (where) particles.emit({ at: where, count: 90, color: "#ffb347", color2: "#a8241c", speed: 5, up: 2, life: 1, size: 0.35 });
        if (mine) {
          this.dragonUntil = performance.now() + ms;
          this.viewmodel.setHidden(true);
          this.hooks.onSoar(ms / 1000);
          this.hud.callout("You're a dragon! Space to climb, C to dive, click to breathe fire");
          setTimeout(() => {
            if (performance.now() >= this.dragonUntil - 50) this.viewmodel.setHidden(false);
          }, ms + 20);
        } else {
          const { body, wings } = monsterModel("dragon");
          body.scale.setScalar(0.85);
          this.remotes.disguise(id, body);
          this.dragons.set(id, { wings, until: performance.now() + ms });
        }
        return true;
      }
    }
    return false;
  }


  // Level 11+ ability effects.
  private masteryEffect(mine: boolean, id: number, kind: string, ms: number, at: Vec3 | null, from?: Vec3, to?: Vec3): void {
    if (this.legendEffect(mine, id, kind, ms, at, from, to)) return;
    const where = at ?? this.remotes.positionOf(id);
    if (kind === "spin") {
      if (mine) {
        this.hooks.onSpin(ms);
        this.hud.callout("Caught in the tornado!");
      }
      sound.fx("rumble", { at, volume: 0.6 });
      return;
    }
    if (kind === "invert") {
      sound.fx("stealth", { at, rate: 0.6 });
      if (mine) {
        this.hooks.onInvert(ms);
        this.hud.callout("Cursed!");
      } else this.remotes.glow(id, "#b48cff", ms);
    } else if (kind === "giant") {
      sound.fx("fortify", { at, rate: 0.5 });
      sound.fx("rumble", { at });
      if (mine) {
        this.hooks.onGiant(ms);
        this.hud.callout("Giant!");
      } else this.remotes.setScale(id, GIANT.scale, ms);
    } else if (kind === "burn") {
      sound.fx("fireball", { at, volume: 0.6 });
      if (mine) this.hud.callout("Too hot!");
      if (where) particles.emit({ at: where, count: 25, color: "#ffb347", color2: "#ff3a1a", speed: 3, up: 3, life: 0.6, size: 0.25, gravity: -1 });
    } else if (kind === "windstep") {
      sound.fx("blink", { at, rate: 1.4, volume: 0.6 });
      if (mine && ms > 0) {
        this.boost("windstep", ms);
        this.hud.callout("Windstep!");
      } else if (!mine) this.remotes.glow(id, "#bff5ff", ms);
      if (where) particles.emit({ at: where, count: 20, color: "#e6fbff", speed: 2.5, up: 0.5, life: 0.5, size: 0.15 });
    } else if (kind === "glide") {
      sound.fx("blink", { at, rate: 0.7 });
      if (mine) this.hooks.onGlide(ms / 1000);
      if (where) particles.emit({ at: where, count: 30, color: "#d8d0ff", speed: 3, up: 2, life: 0.7, size: 0.2 });
    } else if (kind === "shockwave" && from) {
      // A ring blasting outward.
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.25, 6, 40), glowMat("#9fdcff", 2.5));
      ring.rotation.x = Math.PI / 2;
      ring.position.set(from[0], from[1] - 0.6, from[2]);
      this.scene.add(ring);
      const start = performance.now();
      const grow = () => {
        const k = (performance.now() - start) / 350;
        ring.scale.setScalar(1 + k * SHOCKWAVE.radius);
        (ring.material as THREE.MeshBasicMaterial).opacity = 1 - k;
        (ring.material as THREE.MeshBasicMaterial).transparent = true;
        if (k < 1) requestAnimationFrame(grow);
        else {
          this.scene.remove(ring);
          ring.geometry.dispose();
        }
      };
      requestAnimationFrame(grow);
      particles.emit({ at: from, count: 60, color: "#9fdcff", color2: "#ffffff", speed: 9, life: 0.5, size: 0.25 });
      sound.fx("explosion", { at: mine ? null : from, volume: 0.8 });
    } else if (kind === "heal" || kind === "aegis") {
      // Gold sparkles rising (heal), or a blue flash (a shield).
      const heal = kind === "heal";
      if (where) particles.emit({ at: where, count: 26, color: heal ? "#fff2a8" : "#7fd8ff", color2: heal ? "#8fff9f" : "#ffffff", speed: 1, up: 2.2, spread: 0.5, life: 0.9, size: 0.18, gravity: -1 });
      sound.fx(heal ? "levelUp" : "ward", { at, volume: 0.5 });
      if (mine) this.hud.callout(heal ? "Healed!" : "Shielded!");
    } else if (kind === "judgment") {
      sound.fx("sting", { at, rate: 1.4, volume: 0.6 });
      if (mine) this.hud.callout("Judged!");
      else this.remotes.glow(id, "#ffd25a", ms);
    } else if (kind === "chain" && from && to) {
      // A chain from the Knight to whoever they hooked, for a moment.
      const a = new THREE.Vector3(from[0], from[1] + 0.3, from[2]);
      const b = new THREE.Vector3(to[0], to[1] + 0.3, to[2]);
      const len = a.distanceTo(b);
      const link = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, len, 5), new THREE.MeshLambertMaterial({ color: "#8a8a96" }));
      link.position.copy(a).add(b).multiplyScalar(0.5);
      link.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      this.scene.add(link);
      setTimeout(() => {
        this.scene.remove(link);
        link.geometry.dispose();
      }, Math.max(250, ms));
      sound.play("chop", { at: mine ? null : to });
      if (mine) this.hud.callout("Hooked!");
    }
  }

  // The class picker. Mid-round (while still in it) the change waits for the
  // round to end; the HUD shows it's coming.
  private pickClass(cls: ClassId): void {
    const fighting = this.state === "playing" && this.alive.has(this.hooks.myId());
    this.pendingCls = fighting && cls !== this.cls ? cls : null;
    this.hud.pending(this.pendingCls);
    this.hooks.send({ t: "class", cls });
  }

  // 1 / 2 / mouse wheel. The server confirms with an "equip" message.
  switchHand(hand: Hand | "toggle"): void {
    const next = hand === "toggle" ? (this.hand === "main" ? "backup" : "main") : hand;
    if (next === this.hand) return;
    this.hand = next;
    sound.play(weaponOf(this.cls, next) === "spell" ? "cloth" : "drawKnife", { volume: 0.6 });
    this.handReadyAt = performance.now() + SWAP_MS;
    this.applyLoadout();
    this.hooks.send({ t: "hand", hand: next });
  }

  // Left click: use what's in hand. Right click: a Fireball.
  attack(button: "primary" | "fireball", origin: THREE.Vector3, dir: THREE.Vector3): void {
    const now = performance.now();
    if (!this.hud.canAct || now < this.handReadyAt) return;
    if ((button === "fireball" || WEAPONS[this.weapon].kind === "spell" || WEAPONS[this.weapon].kind === "projectile") && this.fields.inNullZone(origin)) {
      this.hud.callout("No magic here!");
      return;
    }
    const o: Vec3 = [round3(origin.x), round3(origin.y), round3(origin.z)];
    const d: Vec3 = [dir.x, dir.y, dir.z];
    // Dragon Form: every attack is a blast of fire.
    if (now < this.dragonUntil && button === "primary") {
      if (now < this.readyAt.primary) return;
      this.readyAt.primary = now + DRAGON.fireMs;
      this.seq += 1;
      sound.fx("fireball", { rate: 0.8 });
      this.spells.castLocal(this.seq, "flame", o, [d]);
      this.hooks.send({ t: "attack", o, d, seq: this.seq });
      return;
    }
    if (button === "fireball") {
      if (this.fireballs <= 0 || now < this.readyAt.fireball) return;
      this.readyAt.fireball = now + SPELLS.fireball.cooldownMs;
      this.seq += 1;
      sound.fx("fireball");
      this.spells.castLocal(this.seq, "fireball", o, castDirections("fireball", d));
      this.hooks.send({ t: "cast", spell: "fireball", o, d, seq: this.seq });
      return;
    }
    const weapon = WEAPONS[this.weapon];
    const cooldown = weapon.kind === "spell" ? SPELLS[this.primary].cooldownMs : weapon.kind === "projectile" ? SPELLS[weapon.projectile ?? "arrow"].cooldownMs : weapon.melee!.cooldownMs;
    if (now < this.readyAt.primary) return;
    this.readyAt.primary = now + cooldown;
    this.seq += 1;
    this.viewmodel.swing(cooldown);
    if (weapon.kind === "spell") sound.fx(CAST_SOUND[this.primary]);
    else if (weapon.kind === "projectile") sound.fx(CAST_SOUND[weapon.projectile ?? "arrow"]);
    else sound.fx(this.weapon === "daggers" ? "swing" : "heavySwing", { rate: this.weapon === "daggers" ? 1.3 : 1 });
    if (weapon.kind === "spell") {
      this.spells.castLocal(this.seq, this.primary, o, castDirections(this.primary, d));
      this.hooks.send({ t: "cast", spell: this.primary, o, d, seq: this.seq });
    } else {
      if (weapon.kind === "projectile") this.spells.castLocal(this.seq, weapon.projectile ?? "arrow", o, [d]);
      this.hooks.send({ t: "attack", o, d, seq: this.seq });
    }
  }

  update(time: number, me: THREE.Vector3, serverNow: number, moving: boolean): void {
    this.storm.update(serverNow);
    this.spells.update();
    this.pickups.update(time);
    this.viewmodel.update(moving, time);
    this.monsters.update();
    // Other players in Dragon Form: beat their wings; change them back after.
    const nowMs = performance.now();
    for (const [id, until] of this.rocks) {
      if (nowMs < until) continue;
      this.remotes.disguise(id, null);
      this.rocks.delete(id);
    }
    for (const [id, dragon] of this.dragons) {
      if (nowMs >= dragon.until) {
        this.remotes.disguise(id, null);
        this.dragons.delete(id);
        continue;
      }
      const flap = Math.sin(nowMs / 220) * 0.55;
      dragon.wings.forEach((w, i) => (w.rotation.z = i ? -flap : flap));
    }
    const c = this.storm.circle(serverNow);
    const inStorm = !!c && Math.hypot(me.x - c[0], me.z - c[1]) > c[2];
    this.inStorm = inStorm;
    const now = performance.now();
    this.hud.update(Math.max(0, this.readyAt.primary - now), Math.max(0, this.handReadyAt - now), inStorm);
    const abilities = this.chosen;
    this.fields.update(Math.min(0.1, (now - this.lastUpdate) / 1000), (id) => (id === this.hooks.myId() ? [me.x, me.y, me.z] : this.remotes.positionOf(id)));
    this.lastUpdate = now;
    this.decoys.update();
    // The fallen have sunk away: hide them now.
    for (const [id, until] of this.dyingUntil) {
      if (now < until) continue;
      this.dyingUntil.delete(id);
      this.refreshVisibility();
    }
    this.hud.abilities(
      [...abilities],
      this.abilityReadyAt.map((t, i) => Math.max(0, t - now) / ABILITIES[abilities[i]].cooldownMs),
    );
  }

  // A new arena: spells stop at its walls.
  setLevel(level: Level): void {
    this.spells.setBoxes(level.boxes);
  }

  // The level plus conjured walls (spells stop at those too).
  setBoxes(boxes: Box[]): void {
    this.spells.setBoxesKeepFlying(boxes);
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKey);
    this.spells.clear();
    this.monsters.clear();
    this.fields.clear();
    this.decoys.clear();
    this.viewmodel.dispose();
    this.hud.dispose();
    this.hooks.onSpeed(1);
  }
}

// A Wizard in Rock Disguise: a grey boulder like the arenas' own, sitting on
// the ground (an avatar's origin is 0.9 m above its feet).
export function rockModel(): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: "#8a8698", flatShading: true });
  const boulder = new THREE.Mesh(new THREE.DodecahedronGeometry(0.8, 0), mat);
  boulder.scale.set(1.1, 0.8, 1);
  boulder.rotation.set(0.3, 0.7, 0.1);
  boulder.position.y = -0.9 + 0.5;
  const pebble = new THREE.Mesh(new THREE.DodecahedronGeometry(0.28, 0), mat);
  pebble.position.set(0.75, -0.9 + 0.15, 0.3);
  for (const m of [boulder, pebble]) {
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  return group;
}
