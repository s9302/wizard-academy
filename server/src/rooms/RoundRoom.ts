// Shared base for modes played in rounds (tag, infection, battle royale): the
// round cycle, server-side bots, and paying XP at the end of a round.
//
// Round cycle:  waiting (need 2+ players) -> countdown (everyone is moved to
// a spawn point) -> playing -> ended (results shown) -> countdown ...
//
// Subclasses say what happens when play starts, when a round is over, who
// won, and what bots do.

import type { Level } from "../../../shared/src/levels/types.ts";
import type { ClientMsg, RoundState } from "../../../shared/src/protocol.ts";
import type { RoomInfo } from "../../../shared/src/rooms.ts";
import { NavGrid } from "../bots/NavGrid.ts";
import { BotPeer } from "../Connection.ts";
import { XP } from "../xp.ts";
import type { Player } from "./Room.ts";
import { Room } from "./Room.ts";

// Testing only: ROUND_TIME_SCALE=0.1 makes rounds 10x shorter.
export const SCALE = Math.min(1, Math.max(0.02, Number(process.env.ROUND_TIME_SCALE ?? 1)));
const COUNTDOWN_MS = 5_000 * SCALE;
const RESULTS_MS = 8_000 * SCALE; // see resultsMs()
const MIN_PLAYERS = 2;

const MAX_BOTS = 6;
const BOT_NAMES = ["Bot Ash", "Bot Briar", "Bot Cinder", "Bot Dusk", "Bot Ember", "Bot Fennel"];

// Bots' walking maps take a moment to build; share one per level.
const navGrids = new Map<string, NavGrid>();
// The walking map for a level, only if it's already been built (no work).
export function navGridIfBuilt(level: Level): NavGrid | undefined {
  return navGrids.get(level.id);
}

export function navGridFor(level: Level): NavGrid {
  let grid = navGrids.get(level.id);
  if (!grid) {
    grid = new NavGrid(level);
    navGrids.set(level.id, grid);
  }
  return grid;
}

export type RoomBot = { peer: BotPeer };

export abstract class RoundRoom<B extends RoomBot = RoomBot> extends Room {
  protected state: RoundState = "waiting";
  protected endsAt: number | null = null;
  protected bots = new Map<number, B>(); // by player id, in the order added
  private lastTick = Date.now();

  constructor(info: RoomInfo, level: Level) {
    super(info, level);
  }

  // ---- What each mode decides ----

  protected abstract roundMs(): number;
  // Play just started (everyone present is in the round).
  protected abstract onPlayStart(now: number): void;
  // Ends the round early (e.g. everyone is cursed, one wizard left).
  protected abstract isRoundOver(): boolean;
  protected abstract results(now: number): { title: string; lines: string[] };
  // XP for a finished round (called after results()). Several entries for the
  // same player are added up into one award.
  protected abstract xpAwards(): { id: number; amount: number; reason: string }[];
  protected abstract createBot(peer: BotPeer): B;
  // One bot's turn: decide, move (via moveBot) and act.
  protected abstract runBot(bot: B, me: Player, now: number, dt: number): void;

  // Optional hooks.
  // Players needed for a round (a boss fight can be fought alone).
  protected minPlayers(): number {
    return MIN_PLAYERS;
  }
  protected resultsMs(): number {
    return RESULTS_MS;
  }
  // Before everyone is moved to a spawn point (e.g. switch the arena).
  protected beforeCountdown(_now: number): void {}
  protected onCountdown(_now: number): void {}
  protected onRoundEnded(_now: number): void {}
  protected onRoundTick(_now: number): void {}
  protected onJoinedRound(_player: Player): void {}
  protected onLeftRound(_player: Player): void {}
  protected onRoundMessage(_player: Player, _msg: ClientMsg): void {}

  // ---- Helpers ----

  protected nameOf(id: number): string {
    return this.players.get(id)?.conn.name ?? "someone";
  }

  // Bots move by setting their position directly; relay it like a real move.
  protected moveBot(me: Player, p: Player["p"], ry: number, now: number): void {
    const from = me.p;
    me.p = p;
    me.ry = ry;
    this.relayMove(me, now);
    this.onPlayerMoved(me, from, p, now);
  }

  // ---- Round cycle ----

  protected onTick(now: number): void {
    this.runBots(now);
    const enough = this.players.size >= this.minPlayers();
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
    this.onRoundTick(now);
  }

  private setState(state: RoundState, endsAt: number | null): void {
    this.state = state;
    this.endsAt = endsAt;
    this.broadcast({ t: "round", state, endsAt });
  }

  private startCountdown(now: number): void {
    this.beforeCountdown(now);
    // Everyone to a different spawn point (as far as there are enough).
    const points = [...(this.level.spawnPoints ?? [this.level.spawn])].sort(() => Math.random() - 0.5);
    let i = 0;
    for (const player of this.players.values()) {
      this.teleport(player, points[i % points.length]);
      i++;
    }
    this.onCountdown(now);
    this.setState("countdown", now + COUNTDOWN_MS);
  }

  private startPlaying(now: number): void {
    this.setState("playing", now + this.roundMs());
    this.onPlayStart(now);
  }

  // cancelled: too many players left mid-round, so nobody really won.
  private endRound(now: number, cancelled: boolean): void {
    const { title, lines } = cancelled
      ? { title: "Round cancelled", lines: ["Not enough players left. Waiting for more wizards..."] }
      : this.results(now);
    if (!cancelled) this.payXp();
    this.setState("ended", now + this.resultsMs());
    this.onRoundEnded(now);
    this.broadcast({ t: "roundResult", title, lines });
    console.log(`[${this.name}] round over: ${title}`);
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

  // ---- Players coming and going ----

  protected onPlayerJoined(player: Player): void {
    player.conn.send({ t: "round", state: this.state, endsAt: this.endsAt });
    player.conn.send({ t: "botCount", count: this.bots.size, max: MAX_BOTS });
    this.onJoinedRound(player);
  }

  protected onPlayerLeft(player: Player): void {
    this.bots.delete(player.conn.id);
    // Bots don't play on their own: when the last person leaves, so do they.
    if (!player.conn.isBot && ![...this.players.values()].some((p) => !p.conn.isBot)) {
      for (const bot of [...this.bots.values()]) this.leave(bot.peer);
    }
    this.onLeftRound(player);
  }

  protected onMessage(player: Player, msg: ClientMsg): void {
    if (msg.t === "bots" && !player.conn.isBot) {
      if (msg.action === "add") this.addBot(player);
      else this.removeBot(player);
      return;
    }
    this.onRoundMessage(player, msg);
  }

  // ---- Bots ----

  private addBot(by: Player): void {
    if (this.bots.size >= MAX_BOTS || this.isFull) return;
    const taken = new Set([...this.players.values()].map((p) => p.conn.name));
    const name = BOT_NAMES.find((n) => !taken.has(n));
    if (!name) return;
    const peer = new BotPeer(name);
    this.bots.set(peer.id, this.createBot(peer));
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

  // Each tick, every bot decides where to go and what to do. Their moves are
  // relayed like a real player's, and their actions take the same checks.
  private runBots(now: number): void {
    const dt = Math.min(0.2, (now - this.lastTick) / 1000);
    this.lastTick = now;
    for (const [id, bot] of this.bots) {
      const me = this.players.get(id);
      if (me) this.runBot(bot, me, now, dt);
    }
  }
}
