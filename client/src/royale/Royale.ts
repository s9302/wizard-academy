// Everything the battle royale adds to a game: classes and weapons, spells
// and arrows, the storm, pickups, health bars, and the HUD. Game.ts hands it
// the server's royale messages and the player's clicks; this decides what to
// draw and what to send.

import * as THREE from "three";
import { ABILITIES, CHARGE_SPEED, CHARGE_TIME, CLASS_ABILITIES } from "../../../shared/src/abilities.ts";
import { type ClassId, type Hand, moveSpeed, SWAP_MS, WEAPONS, type WeaponId, weaponOf } from "../../../shared/src/classes.ts";
import { castDirections, MAX_SHIELD, type SpellId, type SpellSlot, SPELLS } from "../../../shared/src/combat.ts";
import type { Box, Level } from "../../../shared/src/levels/types.ts";
import type { ClientMsg, RoundState, ServerMsg, Vec3 } from "../../../shared/src/protocol.ts";
import type { RemotePlayers } from "../RemotePlayers.ts";
import type { ServerClock } from "../ServerClock.ts";
import { Pickups } from "./Pickups.ts";
import { RoyaleHud } from "./RoyaleHud.ts";
import { Spells } from "./Spells.ts";
import { Storm } from "./Storm.ts";
import { Viewmodel } from "./Viewmodel.ts";
import { sound } from "../audio/Sound.ts";
import type { SynthId } from "../audio/synth.ts";

// The sound of casting each spell (and loosing an arrow).
const CAST_SOUND: Record<SpellId, SynthId> = { bolt: "bolt", frost: "frost", spark: "spark", fireball: "fireball", arrow: "arrow" };
const HITS = ["punch0", "punch1", "punch2"] as const;

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export type RoyaleHooks = {
  send: (msg: ClientMsg) => void;
  myId: () => number;
  onSlowed: (ms: number) => void; // hit by Frost Shard: slow the player down
  onSpeed: (multiplier: number) => void; // class and hand set how fast you move
  feed: (text: string) => void; // a line in the message feed
  onArena: (levelId: string) => void; // the server switched arenas
  onConjure: (id: number, box: Box) => void; // a wizard's wall or pillar appeared
  onUnconjure: (id: number) => void;
  onCharge: (dir: THREE.Vector3, speed: number, seconds: number) => void; // rush forward (Knight)
};

export class Royale {
  private hud: RoyaleHud;
  private spells: Spells;
  private storm: Storm;
  private pickups: Pickups;
  private viewmodel: Viewmodel;
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
    this.hud = new RoyaleHud(hudEl, clock, this.storm, roomName, {
      onBots: (action) => hooks.send({ t: "bots", action }),
      onClass: (c) => this.pickClass(c),
      onVote: (arena) => hooks.send({ t: "vote", arena }),
    });
    this.applyLoadout();
  }

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
    this.hooks.onSpeed(moveSpeed(this.cls, this.hand));
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
      case "alive":
        if (this.state === "playing" && this.alive.has(me) && !msg.ids.includes(me)) sound.fx("defeat");
        else if (this.state === "playing" && msg.ids.length < this.alive.size) sound.play("bell2", { volume: 0.35, rate: 1.5 });
        this.alive = new Set(msg.ids);
        this.hud.alive(msg.ids.length, this.alive.has(me));
        this.viewmodel.setVisible(!this.thirdPerson && (this.state !== "playing" || this.alive.has(me)));
        this.refreshVisibility();
        return true;
      case "health":
        this.health.set(msg.id, { hp: msg.hp, max: msg.max, shield: msg.shield });
        if (msg.id === me) {
          this.healthSound(msg.hp, msg.shield);
          this.hud.health(msg.hp, msg.max, msg.shield);
        }
        else this.remotes.setHealth(msg.id, msg.hp / msg.max, msg.shield / MAX_SHIELD);
        return true;
      case "equip":
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
        for (const id of msg.hits) if (id !== me) this.remotes.flash(id);
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
      case "arenaVote":
        this.hud.vote(msg.options, msg.votes);
        return true;
      case "pickups":
        this.pickups.set(msg.items);
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
        if (msg.hit !== null && msg.hit !== me) this.remotes.flash(msg.hit);
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
  }

  // During a round, only those still in it are shown; spectators are invisible.
  private refreshVisibility(): void {
    const hide = this.state === "playing";
    this.remotes.forEachId((id) => this.remotes.setVisible(id, !hide || this.alive.has(id)));
  }

  // E (slot 0) / R (slot 1): this class's ability. The server does the work
  // (and says if it didn't); a Knight's charge is our own movement.
  ability(slot: 0 | 1, origin: THREE.Vector3, dir: THREE.Vector3): void {
    const now = performance.now();
    if (!this.hud.canAct || now < this.abilityReadyAt[slot]) return;
    const id = CLASS_ABILITIES[this.cls][slot];
    this.abilityReadyAt[slot] = now + ABILITIES[id].cooldownMs;
    const o: Vec3 = [round3(origin.x), round3(origin.y), round3(origin.z)];
    this.hooks.send({ t: "ability", slot, o, d: [dir.x, dir.y, dir.z] });
    if (id === "charge") this.hooks.onCharge(new THREE.Vector3(dir.x, 0, dir.z), CHARGE_SPEED, CHARGE_TIME);
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
    const o: Vec3 = [round3(origin.x), round3(origin.y), round3(origin.z)];
    const d: Vec3 = [dir.x, dir.y, dir.z];
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
    const cooldown = weapon.kind === "spell" ? SPELLS[this.primary].cooldownMs : weapon.kind === "projectile" ? SPELLS.arrow.cooldownMs : weapon.melee!.cooldownMs;
    if (now < this.readyAt.primary) return;
    this.readyAt.primary = now + cooldown;
    this.seq += 1;
    this.viewmodel.swing();
    if (weapon.kind === "spell") sound.fx(CAST_SOUND[this.primary]);
    else if (weapon.kind === "projectile") sound.fx("arrow");
    else sound.fx(this.weapon === "daggers" ? "swing" : "heavySwing", { rate: this.weapon === "daggers" ? 1.3 : 1 });
    if (weapon.kind === "spell") {
      this.spells.castLocal(this.seq, this.primary, o, castDirections(this.primary, d));
      this.hooks.send({ t: "cast", spell: this.primary, o, d, seq: this.seq });
    } else {
      if (weapon.kind === "projectile") this.spells.castLocal(this.seq, "arrow", o, [d]);
      this.hooks.send({ t: "attack", o, d, seq: this.seq });
    }
  }

  update(time: number, me: THREE.Vector3, serverNow: number, moving: boolean): void {
    this.storm.update(serverNow);
    this.spells.update();
    this.pickups.update(time);
    this.viewmodel.update(moving, time);
    const c = this.storm.circle(serverNow);
    const inStorm = !!c && Math.hypot(me.x - c[0], me.z - c[1]) > c[2];
    this.inStorm = inStorm;
    const now = performance.now();
    this.hud.update(Math.max(0, this.readyAt.primary - now), Math.max(0, this.handReadyAt - now), inStorm);
    const abilities = CLASS_ABILITIES[this.cls];
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
    this.spells.clear();
    this.viewmodel.dispose();
    this.hud.dispose();
    this.hooks.onSpeed(1);
  }
}
