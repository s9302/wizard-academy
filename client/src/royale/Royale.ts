// Everything the battle royale adds to a game: classes and weapons, spells
// and arrows, the storm, pickups, health bars, and the HUD. Game.ts hands it
// the server's royale messages and the player's clicks; this decides what to
// draw and what to send.

import type * as THREE from "three";
import { type ClassId, type Hand, moveSpeed, SWAP_MS, WEAPONS, type WeaponId, weaponOf } from "../../../shared/src/classes.ts";
import { castDirections, MAX_SHIELD, type SpellId, type SpellSlot, SPELLS } from "../../../shared/src/combat.ts";
import type { Level } from "../../../shared/src/levels/types.ts";
import type { ClientMsg, RoundState, ServerMsg, Vec3 } from "../../../shared/src/protocol.ts";
import type { RemotePlayers } from "../RemotePlayers.ts";
import type { ServerClock } from "../ServerClock.ts";
import { Pickups } from "./Pickups.ts";
import { RoyaleHud } from "./RoyaleHud.ts";
import { Spells } from "./Spells.ts";
import { Storm } from "./Storm.ts";
import { Viewmodel } from "./Viewmodel.ts";

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export type RoyaleHooks = {
  send: (msg: ClientMsg) => void;
  myId: () => number;
  onSlowed: (ms: number) => void; // hit by Frost Shard: slow the player down
  onSpeed: (multiplier: number) => void; // class and hand set how fast you move
  feed: (text: string) => void; // a line in the message feed
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
  private pendingCls: ClassId | null = null; // picked mid-round

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
    });
    this.applyLoadout();
  }

  private get weapon(): WeaponId {
    return weaponOf(this.cls, this.hand);
  }

  // Class or hand changed: HUD, the weapon in view, and movement speed.
  private applyLoadout(): void {
    this.hud.loadout(this.cls, this.hand, SPELLS[this.primary].name, SPELLS[this.primary].cooldownMs);
    this.viewmodel.show(this.weapon, SPELLS[this.primary].color);
    this.hooks.onSpeed(moveSpeed(this.cls, this.hand));
  }

  // Returns true if it was a royale message.
  onMessage(msg: ServerMsg): boolean {
    const me = this.hooks.myId();
    switch (msg.t) {
      case "round":
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
        this.alive = new Set(msg.ids);
        this.hud.alive(msg.ids.length, this.alive.has(me));
        this.viewmodel.setVisible(this.state !== "playing" || this.alive.has(me));
        this.refreshVisibility();
        return true;
      case "health":
        this.health.set(msg.id, { hp: msg.hp, max: msg.max, shield: msg.shield });
        if (msg.id === me) this.hud.health(msg.hp, msg.max, msg.shield);
        else this.remotes.setHealth(msg.id, msg.hp / msg.max, msg.shield / MAX_SHIELD);
        return true;
      case "equip":
        if (msg.id === me) {
          // The server's word on our class and hand.
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
      case "pickups":
        this.pickups.set(msg.items);
        return true;
      case "charges":
        this.fireballs = msg.fireball;
        this.hud.charges(msg.fireball);
        return true;
      case "spell": {
        const mine = msg.caster === me;
        if (mine) this.myShots.add(msg.id);
        this.spells.started(msg.id, msg.spell, msg.o, msg.d, msg.time, mine ? `${msg.seq}:${msg.k}` : null);
        if (!mine) this.remotes.swing(msg.caster);
        return true;
      }
      case "slowed":
        if (msg.id === me) this.hooks.onSlowed(msg.ms);
        else this.remotes.chill(msg.id, msg.ms);
        return true;
      case "spellEnd":
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
    const now = performance.now();
    this.hud.update(Math.max(0, this.readyAt.primary - now), Math.max(0, this.handReadyAt - now), inStorm);
  }

  dispose(): void {
    this.spells.clear();
    this.viewmodel.dispose();
    this.hud.dispose();
    this.hooks.onSpeed(1);
  }
}
