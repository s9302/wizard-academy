// Everything the battle royale adds to a game: spells, the storm, pickups,
// health bars, and the HUD. Game.ts hands it the server's royale messages and
// the player's clicks; this decides what to draw and what to send.

import type * as THREE from "three";
import { castDirections, MAX_HEALTH, MAX_SHIELD, type SpellId, type SpellSlot, SPELLS } from "../../../shared/src/combat.ts";
import type { Level } from "../../../shared/src/levels/types.ts";
import type { ClientMsg, RoundState, ServerMsg, Vec3 } from "../../../shared/src/protocol.ts";
import type { RemotePlayers } from "../RemotePlayers.ts";
import type { ServerClock } from "../ServerClock.ts";
import { Pickups } from "./Pickups.ts";
import { RoyaleHud } from "./RoyaleHud.ts";
import { Spells } from "./Spells.ts";
import { Storm } from "./Storm.ts";

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export class Royale {
  private hud: RoyaleHud;
  private spells: Spells;
  private storm: Storm;
  private pickups: Pickups;
  private remotes: RemotePlayers;
  private send: (msg: ClientMsg) => void;
  private myId: () => number;
  private state: RoundState = "waiting";
  private alive = new Set<number>();
  private health = new Map<number, { hp: number; shield: number }>();
  private myCasts = new Set<number>(); // server ids of my spells in flight
  private seq = 0;
  private readyAt: Record<SpellSlot, number> = { primary: 0, fireball: 0 }; // performance.now()
  private primary: SpellId;
  private onSlowed: (ms: number) => void;
  private fireballs = 0;

  constructor(
    scene: THREE.Scene,
    hudEl: HTMLElement,
    clock: ServerClock,
    level: Level,
    roomName: string,
    remotes: RemotePlayers,
    send: (msg: ClientMsg) => void,
    myId: () => number,
    primary: SpellId, // the left-click spell chosen in the Spellbook
    onSlowed: (ms: number) => void, // hit by Frost Shard: slow the player down
  ) {
    this.primary = primary;
    this.onSlowed = onSlowed;
    this.remotes = remotes;
    this.send = send;
    this.myId = myId;
    this.storm = new Storm(scene);
    this.spells = new Spells(scene, clock, level.boxes);
    this.pickups = new Pickups(scene);
    this.hud = new RoyaleHud(hudEl, clock, this.storm, roomName, primary, (action) => send({ t: "bots", action }));
  }

  // Returns true if it was a royale message.
  onMessage(msg: ServerMsg): boolean {
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
        this.hud.alive(msg.ids.length, this.alive.has(this.myId()));
        this.refreshVisibility();
        return true;
      case "health":
        this.health.set(msg.id, { hp: msg.hp, shield: msg.shield });
        if (msg.id === this.myId()) this.hud.health(msg.hp, msg.shield);
        else this.remotes.setHealth(msg.id, msg.hp / MAX_HEALTH, msg.shield / MAX_SHIELD);
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
        const mine = msg.caster === this.myId();
        if (mine) this.myCasts.add(msg.id);
        this.spells.started(msg.id, msg.spell, msg.o, msg.d, msg.time, mine ? `${msg.seq}:${msg.k}` : null);
        return true;
      }
      case "slowed":
        if (msg.id === this.myId()) this.onSlowed(msg.ms);
        else this.remotes.chill(msg.id, msg.ms);
        return true;
      case "spellEnd":
        this.spells.ended(msg.id, msg.p);
        if (msg.hit !== null && msg.hit !== this.myId()) this.remotes.flash(msg.hit);
        if (msg.hit !== null && this.myCasts.has(msg.id)) this.hud.hitMarker();
        this.myCasts.delete(msg.id);
        return true;
      default:
        return false;
    }
  }

  // A new remote player appeared: give them a health bar and the right visibility.
  onRemoteAdded(id: number): void {
    const h = this.health.get(id) ?? { hp: MAX_HEALTH, shield: 0 };
    this.remotes.setHealth(id, h.hp / MAX_HEALTH, h.shield / MAX_SHIELD);
    this.refreshVisibility();
  }

  // During a round, only wizards still in it are shown; spectators are invisible.
  private refreshVisibility(): void {
    const hide = this.state === "playing";
    this.remotes.forEachId((id) => this.remotes.setVisible(id, !hide || this.alive.has(id)));
  }

  // The player clicked (left: their chosen spell, right: fireball): cast from
  // their eyes along where they're looking.
  cast(button: "primary" | "fireball", origin: THREE.Vector3, dir: THREE.Vector3): void {
    const spell: SpellId = button === "primary" ? this.primary : "fireball";
    const slot = SPELLS[spell].slot;
    const now = performance.now();
    if (!this.hud.canCast || now < this.readyAt[slot]) return;
    if (spell === "fireball" && this.fireballs <= 0) return;
    this.readyAt[slot] = now + SPELLS[spell].cooldownMs;
    const o: Vec3 = [round3(origin.x), round3(origin.y), round3(origin.z)];
    const d: Vec3 = [dir.x, dir.y, dir.z];
    this.seq += 1;
    this.spells.castLocal(this.seq, spell, o, castDirections(spell, d));
    this.send({ t: "cast", spell, o, d, seq: this.seq });
  }

  update(time: number, me: THREE.Vector3, serverNow: number): void {
    this.storm.update(serverNow);
    this.spells.update();
    this.pickups.update(time);
    const c = this.storm.circle(serverNow);
    const inStorm = !!c && Math.hypot(me.x - c[0], me.z - c[1]) > c[2];
    this.hud.update(Math.max(0, this.readyAt.primary - performance.now()), inStorm);
  }

  dispose(): void {
    this.spells.clear();
    this.hud.dispose();
  }
}
