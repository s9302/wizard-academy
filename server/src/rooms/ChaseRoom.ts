// Shared base for tag and infection: chasers try to touch runners. This class
// owns everything the two modes have in common: the round cycle, checking
// tags, and the set of chasers. Subclasses (TagRoom, InfectionRoom) only say
// what a tag *does*, when a round is over, and who won.
//
// Round cycle:  waiting (need 2+ players) -> countdown (everyone is moved to
// a spawn point) -> playing -> ended (results shown) -> countdown ...
//
// Game-dev note on tag range ("lag compensation"): you see other players
// ~120 ms in the past (see client RemotePlayers.ts), and your tag takes time
// to reach the server. So the server remembers where each player was over the
// last moment and accepts a tag if the target was within range at any point
// in that window, not just at the instant the message arrives.

import { TAG_RANGE } from "../../../shared/src/constants.ts";
import type { Level } from "../../../shared/src/levels/types.ts";
import type { ClientMsg, RoundState, Vec3 } from "../../../shared/src/protocol.ts";
import type { RoomInfo } from "../../../shared/src/rooms.ts";
import { ChaseBot } from "../bots/ChaseBot.ts";
import { NavGrid } from "../bots/NavGrid.ts";
import { BotPeer } from "../Connection.ts";
import { XP } from "../xp.ts";
import type { Player } from "./Room.ts";
import { Room } from "./Room.ts";

// Testing only: ROUND_TIME_SCALE=0.1 makes rounds 10x shorter.
const SCALE = Math.min(1, Math.max(0.02, Number(process.env.ROUND_TIME_SCALE ?? 1)));
const COUNTDOWN_MS = 5_000 * SCALE;
const ROUND_MS = 180_000 * SCALE; // 3 minutes
const RESULTS_MS = 8_000 * SCALE;
const START_GRACE_MS = 3_000 * SCALE; // chasers can't tag right away: runners scatter
const MIN_PLAYERS = 2;

const HISTORY_MS = 400; // how far back a tag may "see" (lag compensation)
const RANGE_SLACK = 0.3; // meters, for rounding and timing

const MAX_BOTS = 6;
const BOT_NAMES = ["Bot Ash", "Bot Briar", "Bot Cinder", "Bot Dusk", "Bot Ember", "Bot Fennel"];

// Bots' walking maps take a moment to build; share one per level.
const navGrids = new Map<string, NavGrid>();
function navGridFor(level: Level): NavGrid {
  let grid = navGrids.get(level.id);
  if (!grid) {
    grid = new NavGrid(level);
    navGrids.set(level.id, grid);
  }
  return grid;
}

export abstract class ChaseRoom extends Room {
  protected state: RoundState = "waiting";
  private endsAt: number | null = null;
  protected chasers = new Set<number>(); // player ids
  private canTagAt = new Map<number, number>(); // per chaser: no tagging before this time
  private history = new Map<number, { time: number; p: Vec3 }[]>();
  private bots = new Map<number, ChaseBot>(); // by player id, in the order added
  private lastTick = Date.now();

  constructor(info: RoomInfo, level: Level) {
    super(info, level);
  }

  // ---- What each mode decides ----

  // Called when play starts: which players begin as chasers.
  protected abstract pickInitialChasers(ids: number[]): number[];
  // A valid tag happened. Update this.chasers (and any scoring).
  protected abstract applyTag(tagger: Player, victim: Player, now: number): void;
  // Ends the round early (e.g. everyone is cursed).
  protected abstract isRoundOver(): boolean;
  protected abstract results(now: number): { title: string; lines: string[] };
  // XP for a finished round (called after results()). Several entries for the
  // same player are added up into one award.
  protected abstract xpAwards(): { id: number; amount: number; reason: string }[];
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

  protected nameOf(id: number): string {
    return this.players.get(id)?.conn.name ?? "someone";
  }

  // ---- Round cycle ----

  protected onTick(now: number): void {
    this.runBots(now);
    const enough = this.players.size >= MIN_PLAYERS;
    switch (this.state) {
      case "waiting":
        if (enough) this.startCountdown(now);
        break;
      case "countdown":
        if (!enough) this.setState("waiting", null);
        else if (now >= this.endsAt!) this.startPlaying(now);
        break;
      case "playing":
        if (!enough) this.endRound(now, true);
        else if (now >= this.endsAt! || this.isRoundOver()) this.endRound(now, false);
        break;
      case "ended":
        if (now >= this.endsAt!) {
          if (enough) this.startCountdown(now);
          else this.setState("waiting", null);
        }
        break;
    }
  }

  private setState(state: RoundState, endsAt: number | null): void {
    this.state = state;
    this.endsAt = endsAt;
    this.broadcast({ t: "round", state, endsAt });
  }

  private broadcastChasers(): void {
    this.broadcast({ t: "chasers", ids: [...this.chasers] });
  }

  private startCountdown(now: number): void {
    this.chasers.clear();
    this.canTagAt.clear();
    this.broadcastChasers();
    // Everyone to a different spawn point (as far as there are enough).
    const points = [...(this.level.spawnPoints ?? [this.level.spawn])].sort(() => Math.random() - 0.5);
    let i = 0;
    for (const player of this.players.values()) {
      this.teleport(player, points[i % points.length]);
      i++;
    }
    this.setState("countdown", now + COUNTDOWN_MS);
  }

  private startPlaying(now: number): void {
    this.setState("playing", now + ROUND_MS);
    this.onRoundStart(now);
    const ids = [...this.players.keys()];
    for (const id of this.pickInitialChasers(ids)) this.makeChaser(id, now, START_GRACE_MS);
    this.broadcastChasers();
    this.broadcast({ t: "announce", text: this.describeStart([...this.chasers].map((id) => this.nameOf(id))) });
  }

  // cancelled: too many players left mid-round, so nobody really won.
  private endRound(now: number, cancelled: boolean): void {
    const { title, lines } = cancelled
      ? { title: "Round cancelled", lines: ["Not enough players left. Waiting for more wizards..."] }
      : this.results(now);
    if (!cancelled) this.payXp();
    this.setState("ended", now + RESULTS_MS);
    this.broadcast({ t: "roundResult", title, lines });
    console.log(`[${this.name}] round over: ${title}`);
  }

  // ---- Players coming and going ----

  protected onPlayerJoined(player: Player): void {
    const now = Date.now();
    player.conn.send({ t: "round", state: this.state, endsAt: this.endsAt });
    player.conn.send({ t: "botCount", count: this.bots.size, max: MAX_BOTS });
    if (this.state === "playing" && this.lateJoinerIsChaser()) {
      this.makeChaser(player.conn.id, now, START_GRACE_MS);
      this.broadcastChasers();
    } else {
      player.conn.send({ t: "chasers", ids: [...this.chasers] });
    }
  }

  protected onPlayerLeft(player: Player): void {
    const id = player.conn.id;
    this.history.delete(id);
    this.bots.delete(id);
    // Bots don't play on their own: when the last person leaves, so do they.
    if (!player.conn.isBot && ![...this.players.values()].some((p) => !p.conn.isBot)) {
      for (const bot of [...this.bots.values()]) this.leave(bot.peer);
    }
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

  protected onMessage(player: Player, msg: ClientMsg): void {
    if (msg.t === "tag") this.handleTag(player, msg.target);
    if (msg.t === "bots" && !player.conn.isBot) {
      if (msg.action === "add") this.addBot(player);
      else this.removeBot(player);
    }
  }

  private payXp(): void {
    const humans = [...this.players.values()].filter((p) => !p.conn.isBot).length;
    const practice = humans < 2; // just you and bots: half XP
    const totals = new Map<number, { amount: number; reasons: string[] }>();
    for (const award of this.xpAwards()) {
      const t = totals.get(award.id) ?? { amount: 0, reasons: [] };
      t.amount += award.amount;
      t.reasons.push(award.reason);
      totals.set(award.id, t);
    }
    for (const [id, t] of totals) {
      const player = this.players.get(id);
      if (!player) continue;
      const amount = practice ? t.amount * XP.botsOnlyFraction : t.amount;
      this.giveXp(player, amount, t.reasons.join(", ") + (practice ? " (bots only: half XP)" : ""));
    }
  }

  // ---- Bots ----

  private addBot(by: Player): void {
    if (this.bots.size >= MAX_BOTS || this.isFull) return;
    const taken = new Set([...this.players.values()].map((p) => p.conn.name));
    const name = BOT_NAMES.find((n) => !taken.has(n));
    if (!name) return;
    const peer = new BotPeer(name);
    this.bots.set(peer.id, new ChaseBot(peer, navGridFor(this.level)));
    this.join(peer); // through the normal join path: spawn, announce, late-joiner rules
    this.broadcast({ t: "botCount", count: this.bots.size, max: MAX_BOTS });
    this.broadcast({ t: "announce", text: `${by.conn.name} added ${name}.` });
  }

  private removeBot(by: Player): void {
    const last = [...this.bots.values()].at(-1);
    if (!last) return;
    this.leave(last.peer);
    this.broadcast({ t: "botCount", count: this.bots.size, max: MAX_BOTS });
    this.broadcast({ t: "announce", text: `${by.conn.name} removed ${last.peer.name}.` });
  }

  // Each tick, every bot decides where to go and whether to tag. Their moves
  // are relayed like a real player's, and their tags take the same checks.
  private runBots(now: number): void {
    const dt = Math.min(0.2, (now - this.lastTick) / 1000);
    this.lastTick = now;
    if (!this.bots.size) return;
    const everyone = [...this.players.values()];
    for (const [id, bot] of this.bots) {
      const me = this.players.get(id);
      if (!me) continue;
      const action = bot.think({
        now,
        dt,
        me,
        others: everyone.filter((p) => p !== me),
        chasers: this.chasers,
        playing: this.state === "playing",
      });
      me.p = action.p;
      me.ry = action.ry;
      this.broadcast({ t: "moved", id, p: action.p, ry: action.ry, time: now }, id);
      this.onPlayerMoved(me, action.p, action.p, now);
      if (action.tag !== null) this.handleTag(me, action.tag);
    }
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
