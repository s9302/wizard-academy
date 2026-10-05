// Shared base for tag and infection: chasers try to touch runners. This class
// owns everything the two modes have in common: checking tags and the set of
// chasers (the round cycle and bots come from RoundRoom). Subclasses
// (TagRoom, InfectionRoom) only say what a tag *does*, when a round is over,
// and who won.
//
// Game-dev note on tag range ("lag compensation"): you see other players
// ~120 ms in the past (see client RemotePlayers.ts), and your tag takes time
// to reach the server. So the server remembers where each player was over the
// last moment and accepts a tag if the target was within range at any point
// in that window, not just at the instant the message arrives.

import { CHAIN } from "../../../shared/src/abilities.ts";
import { EYE_HEIGHT, GRAVITY, TAG_RANGE } from "../../../shared/src/constants.ts";
import { segmentHitsLevel, segmentHitsPlayer } from "../../../shared/src/levels/geometry.ts";
import type { Level } from "../../../shared/src/levels/types.ts";
import type { ClientMsg, Vec3 } from "../../../shared/src/protocol.ts";
import type { RoomInfo } from "../../../shared/src/rooms.ts";
import { ChaseBot } from "../bots/ChaseBot.ts";
import type { BotPeer } from "../Connection.ts";
import { CHASE_MAPS } from "../../../shared/src/levels/chaseMaps.ts";
import { LEVELS } from "../../../shared/src/levels/index.ts";
import type { Player } from "./Room.ts";
import { navGridFor, RoundRoom, SCALE } from "./RoundRoom.ts";

const ROUND_MS = 180_000 * SCALE; // 3 minutes
const START_GRACE_MS = 3_000 * SCALE; // chasers can't tag right away: runners scatter

const HISTORY_MS = 400; // how far back a tag may "see" (lag compensation)
const RANGE_SLACK = 0.3; // meters, for rounding and timing
const UNSTUCK_COOLDOWN_MS = 10_000; // the Respawn button (R), per player
const GRAPPLE_COOLDOWN_MS = 8_000; // the Knight's grapple (E), when it's on

export abstract class ChaseRoom extends RoundRoom<ChaseBot> {
  protected chasers = new Set<number>(); // player ids
  private canTagAt = new Map<number, number>(); // per chaser: no tagging before this time
  private history = new Map<number, { time: number; p: Vec3 }[]>();
  private nextMap: string; // the map for the next round (anyone can pick it)
  private unstuckAt = new Map<number, number>();
  // The Knight's grapple: a room setting anyone can switch on or off.
  private grappleOn = false;
  private grappleAt = new Map<number, number>();

  constructor(info: RoomInfo, level: Level) {
    super(info, level);
    this.nextMap = level.id;
  }

  // ---- Maps and respawning ----

  private mapsMsg() {
    return { t: "chaseMaps" as const, maps: CHASE_MAPS, current: this.level.id, next: this.nextMap };
  }

  private pickMap(player: Player, map: string): void {
    if (player.conn.isBot || !CHASE_MAPS.includes(map) || !LEVELS[map] || map === this.nextMap) return;
    this.nextMap = map;
    const when = this.state === "playing" || this.state === "countdown" ? "Next round" : "The next round";
    this.broadcast({ t: "announce", text: `${player.conn.name} picked ${LEVELS[map].name}. ${when} is played there.` });
    this.broadcast(this.mapsMsg());
  }

  // Just before the countdown: move to the picked map (everyone loads it).
  protected override beforeCountdown(): void {
    const level = LEVELS[this.nextMap];
    if (!level || level === this.level) return;
    this.level = level;
    this.history.clear();
    for (const bot of this.bots.values()) bot.setGrid(navGridFor(level));
    this.broadcast({ t: "arena", levelId: level.id });
    this.broadcast(this.mapsMsg());
  }

  private setGrapple(player: Player, on: boolean): void {
    if (player.conn.isBot || on === this.grappleOn) return;
    this.grappleOn = on;
    this.broadcast({ t: "chaseSettings", grapple: on });
    this.broadcast({ t: "announce", text: `${player.conn.name} turned the Knight's grapple ${on ? "on (E to use it)" : "off"}.` });
  }

  // E with the grapple on: hook the first player along your aim (20 m) and
  // drag them to you. Their own client moves them (a knock); bots are moved.
  private grapple(player: Player, d: [number, number, number]): void {
    const now = Date.now();
    if (!this.grappleOn || now < (this.grappleAt.get(player.conn.id) ?? 0)) return;
    const from: Vec3 = [player.p[0], player.p[1] + EYE_HEIGHT, player.p[2]];
    const end: Vec3 = [from[0] + d[0] * CHAIN.range, from[1] + d[1] * CHAIN.range, from[2] + d[2] * CHAIN.range];
    let best: Player | null = null;
    let bestT = segmentHitsLevel(from, end, this.level.boxes, 0.05) ?? 1;
    for (const target of this.players.values()) {
      if (target === player) continue;
      const t = segmentHitsPlayer(from, end, target.p, 0.7);
      if (t !== null && t < bestT) {
        bestT = t;
        best = target;
      }
    }
    if (!best) {
      if (!player.conn.isBot) player.conn.send({ t: "announce", text: "The grapple missed." });
      return;
    }
    this.grappleAt.set(player.conn.id, now + GRAPPLE_COOLDOWN_MS);
    const at = best.p;
    const dx = player.p[0] - at[0];
    const dz = player.p[2] - at[2];
    const away = Math.hypot(dx, dz);
    if (away > 2.2) {
      const ux = dx / away;
      const uz = dz / away;
      if (best.conn.isBot) {
        this.moveBot(best, [player.p[0] - ux * 1.8, player.p[1], player.p[2] - uz * 1.8], best.ry, now);
      } else {
        const seconds = (away - 2) / CHAIN.speed;
        best.moveCheck.grant(CHAIN.speed * seconds + 2);
        best.moveCheck.grantUp((3 * 3) / (2 * GRAVITY) + 1);
        best.conn.send({ t: "knock", v: [ux * CHAIN.speed, 3, uz * CHAIN.speed], s: seconds });
      }
    }
    this.broadcast({ t: "effect", id: best.conn.id, kind: "chain", ms: Math.round(Math.max(0, away - 2) / CHAIN.speed * 1000), from: player.p, to: at });
  }

  // Stuck somewhere? Back to a spawn point (every 10 s at most).
  private unstuck(player: Player): void {
    const now = Date.now();
    if (player.conn.isBot || now < (this.unstuckAt.get(player.conn.id) ?? 0)) {
      player.conn.send({ t: "announce", text: "You can respawn again in a few seconds." });
      return;
    }
    this.unstuckAt.set(player.conn.id, now + UNSTUCK_COOLDOWN_MS);
    const points = this.level.spawnPoints ?? [this.level.spawn];
    this.teleport(player, points[Math.floor(Math.random() * points.length)]);
  }

  // ---- What each mode decides ----

  // Called when play starts: which players begin as chasers.
  protected abstract pickInitialChasers(ids: number[]): number[];
  // A valid tag happened. Update this.chasers (and any scoring).
  protected abstract applyTag(tagger: Player, victim: Player, now: number): void;
  // Does someone joining mid-round start as a chaser?
  protected abstract lateJoinerIsChaser(): boolean;
  // Announcements, e.g. "Alice is It!"
  protected abstract describeTag(tagger: Player, victim: Player): string;
  protected abstract describeStart(chaserNames: string[]): string;
  // Scoring hooks.
  protected onRoundStart(_now: number): void {}
  protected onChaserAdded(_id: number, _now: number): void {}

  // ---- Helpers for subclasses ----

  protected makeChaser(id: number, now: number, cooldownMs: number): void {
    this.chasers.add(id);
    this.canTagAt.set(id, now + cooldownMs);
    this.onChaserAdded(id, now);
  }

  protected removeChaser(id: number): void {
    this.chasers.delete(id);
    this.canTagAt.delete(id);
  }

  // ---- Round cycle (RoundRoom hooks) ----

  protected roundMs(): number {
    return ROUND_MS;
  }

  protected broadcastChasers(): void {
    this.broadcast({ t: "chasers", ids: [...this.chasers] });
  }

  protected override onCountdown(): void {
    this.chasers.clear();
    this.canTagAt.clear();
    this.broadcastChasers();
  }

  protected onPlayStart(now: number): void {
    this.onRoundStart(now);
    const ids = [...this.players.keys()];
    for (const id of this.pickInitialChasers(ids)) this.makeChaser(id, now, START_GRACE_MS);
    this.broadcastChasers();
    this.broadcast({ t: "announce", text: this.describeStart([...this.chasers].map((id) => this.nameOf(id))) });
  }

  // ---- Players coming and going ----

  protected override onJoinedRound(player: Player): void {
    const now = Date.now();
    player.conn.send({ t: "arena", levelId: this.level.id });
    player.conn.send(this.mapsMsg());
    player.conn.send({ t: "chaseSettings", grapple: this.grappleOn });
    if (this.state === "playing" && this.lateJoinerIsChaser()) {
      this.makeChaser(player.conn.id, now, START_GRACE_MS);
      this.broadcastChasers();
    } else {
      player.conn.send({ t: "chasers", ids: [...this.chasers] });
    }
  }

  protected override onLeftRound(player: Player): void {
    const id = player.conn.id;
    this.history.delete(id);
    this.unstuckAt.delete(id);
    this.grappleAt.delete(id);
    if (!this.chasers.has(id)) return;
    this.removeChaser(id);
    // The last chaser left mid-round: hand the role to a random runner.
    if (this.state === "playing" && this.chasers.size === 0 && this.players.size > 0) {
      const ids = [...this.players.keys()];
      const next = ids[Math.floor(Math.random() * ids.length)];
      this.makeChaser(next, Date.now(), START_GRACE_MS);
      this.broadcast({ t: "announce", text: `${this.nameOf(id)} left. ${this.describeStart([this.nameOf(next)])}` });
    }
    this.broadcastChasers();
  }

  // ---- Tagging ----

  protected onPlayerMoved(player: Player, _from: Vec3, to: Vec3, now: number): void {
    const list = this.history.get(player.conn.id) ?? [];
    list.push({ time: now, p: to });
    while (list.length && now - list[0].time > HISTORY_MS) list.shift();
    this.history.set(player.conn.id, list);
  }

  protected override onRoundMessage(player: Player, msg: ClientMsg): void {
    if (msg.t === "tag") this.handleTag(player, msg.target);
    else if (msg.t === "chaseMap") this.pickMap(player, msg.map);
    else if (msg.t === "unstuck") this.unstuck(player);
    else if (msg.t === "chaseSetting") this.setGrapple(player, msg.grapple);
    else if (msg.t === "grapple") this.grapple(player, msg.d);
  }

  // ---- Bots ----

  protected createBot(peer: BotPeer): ChaseBot {
    return new ChaseBot(peer, navGridFor(this.level));
  }

  protected runBot(bot: ChaseBot, me: Player, now: number, dt: number): void {
    const action = bot.think({
      now,
      dt,
      me,
      others: [...this.players.values()].filter((p) => p !== me),
      chasers: this.chasers,
      playing: this.state === "playing",
      grapple: this.grappleOn,
    });
    this.moveBot(me, action.p, action.ry, now);
    if (action.tag !== null) this.handleTag(me, action.tag);
    if (action.grapple) this.grapple(me, action.grapple);
  }

  private handleTag(tagger: Player, targetId: number): void {
    const now = Date.now();
    const id = tagger.conn.id;
    if (this.state !== "playing") return;
    if (!this.chasers.has(id) || this.chasers.has(targetId)) return;
    if (now < (this.canTagAt.get(id) ?? 0)) return;
    const victim = this.players.get(targetId);
    if (!victim) return;

    // In range now, or at some point in the last HISTORY_MS?
    const recent = [victim.p, ...(this.history.get(targetId) ?? []).map((h) => h.p)];
    const closest = Math.min(...recent.map((p) => Math.hypot(p[0] - tagger.p[0], p[1] - tagger.p[1], p[2] - tagger.p[2])));
    if (closest > TAG_RANGE + RANGE_SLACK) return; // too far: silently ignore

    this.applyTag(tagger, victim, now);
    this.broadcast({ t: "tagged", by: id, victim: targetId });
    this.broadcastChasers();
    this.broadcast({ t: "announce", text: this.describeTag(tagger, victim) });
  }
}
