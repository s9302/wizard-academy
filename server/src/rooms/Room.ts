// Base class for every game mode. A room owns a set of players and runs a
// fixed-rate "tick" for timers and game rules. Each mode (parkour, tag, battle
// royale...) will be a subclass that overrides the hooks below.

import type { ClientMsg, MoveMsg, ServerMsg, Vec3 } from "../../../shared/src/protocol.ts";
import { MAX_PLAYERS_PER_ROOM, NET_INTERVAL_MS } from "../../../shared/src/constants.ts";
import type { Level } from "../../../shared/src/levels/types.ts";
import type { RoomInfo } from "../../../shared/src/rooms.ts";
import { awardXp } from "../accounts.ts";
import type { Peer } from "../Connection.ts";
import { SlidingWindowLimiter } from "../limits.ts";
import { MoveCheck } from "../MoveCheck.ts";

// A few rejected moves can happen to anyone on a bad connection; this many in
// a short time means a cheat client.
const MAX_STRIKES = 5;
const STRIKE_WINDOW_MS = 30_000;

export type Player = {
  conn: Peer; // a real player's connection, or a bot
  p: Vec3; // last accepted position
  ry: number;
  tp: number; // how many times the server has teleported this player
  moveCheck: MoveCheck;
};

export abstract class Room {
  readonly name: string; // room id, e.g. "tag"
  readonly info: RoomInfo;
  readonly level: Level;
  readonly maxPlayers: number = MAX_PLAYERS_PER_ROOM;
  protected players = new Map<number, Player>();
  private tickTimer: NodeJS.Timeout | null = null;
  private strikes = new SlidingWindowLimiter(MAX_STRIKES, STRIKE_WINDOW_MS);

  constructor(info: RoomInfo, level: Level) {
    this.name = info.id;
    this.info = info;
    this.level = level;
  }

  get playerCount(): number {
    return this.players.size;
  }

  get humanCount(): number {
    let n = 0;
    for (const player of this.players.values()) if (!player.conn.isBot) n++;
    return n;
  }

  get isFull(): boolean {
    return this.players.size >= this.maxPlayers;
  }

  // ---- Hooks for subclasses ----

  // Where a player arriving from another room (hello.from) appears, and which
  // way they face. null = the usual spawnPoint().
  protected arrivalPoint(_from: string): { p: Vec3; yaw: number } | null {
    return null;
  }

  // Where a new player appears: one of the level's spawn points (or its single
  // spawn), spread out a little so players don't appear inside each other.
  protected spawnPoint(): Vec3 {
    const points = this.level.spawnPoints;
    const [x, y, z] = points?.length ? points[Math.floor(Math.random() * points.length)] : this.level.spawn;
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * this.level.spawnSpread;
    return [x + Math.cos(angle) * r, y, z + Math.sin(angle) * r];
  }
  // Where a player goes after falling off the level (parkour: last checkpoint).
  protected respawnPoint(_player: Player): Vec3 {
    return this.spawnPoint();
  }
  protected onPlayerJoined(_player: Player): void {}
  protected onPlayerLeft(_player: Player): void {}
  // After a move passed the sanity check: game rules that depend on where
  // players are (checkpoints, tag range, the zone) hook in here.
  protected onPlayerMoved(_player: Player, _from: Vec3, _to: Vec3, _now: number): void {}
  // Mode-specific messages go here later.
  protected onMessage(_player: Player, _msg: ClientMsg): void {}
  // Called NET_RATE_HZ times per second.
  protected onTick(_now: number): void {}

  // ---- Shared behavior ----

  start(): void {
    this.tickTimer = setInterval(() => this.onTick(Date.now()), NET_INTERVAL_MS);
  }

  stop(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  join(conn: Peer, from?: string): void {
    const arrival = from ? this.arrivalPoint(from) : null;
    const spawn = arrival?.p ?? this.spawnPoint();
    const player: Player = { conn, p: spawn, ry: arrival?.yaw ?? 0, tp: 0, moveCheck: new MoveCheck() };

    conn.send({
      t: "welcome",
      id: conn.id,
      room: this.name,
      spawn,
      yaw: arrival?.yaw,
      time: Date.now(),
      players: [...this.players.values()].map((other) => ({
        id: other.conn.id,
        name: other.conn.name,
        p: other.p,
        ry: other.ry,
        look: other.conn.look,
      })),
    });

    this.players.set(conn.id, player);
    conn.room = this;
    this.broadcast(
      { t: "join", player: { id: conn.id, name: conn.name, p: player.p, ry: player.ry, look: conn.look }, time: Date.now() },
      conn.id,
    );
    this.onPlayerJoined(player);
    console.log(`[${this.name}] ${conn.name} (#${conn.id}) joined, ${this.players.size} online`);
  }

  leave(conn: Peer): void {
    const player = this.players.get(conn.id);
    if (!player) return;
    this.players.delete(conn.id);
    conn.room = null;
    this.broadcast({ t: "leave", id: conn.id });
    this.onPlayerLeft(player);
    console.log(`[${this.name}] ${conn.name} (#${conn.id}) left, ${this.players.size} online`);
  }

  handleMessage(conn: Peer, msg: ClientMsg): void {
    const player = this.players.get(conn.id);
    if (!player) return;
    if (msg.t === "move") {
      this.handleMove(player, msg);
    } else if (msg.t === "respawn") {
      // Only honored if the player really is falling out of the world.
      if (player.p[1] < this.level.killY + 5) this.teleport(player, this.respawnPoint(player));
    } else {
      this.onMessage(player, msg);
    }
  }

  // Give XP to a player's account (bots have none) and tell them. Saving is
  // async; the game doesn't wait for it.
  protected giveXp(player: Player, amount: number, reason: string): void {
    const account = player.conn.account;
    const xp = Math.round(amount);
    if (!account || xp <= 0) return;
    awardXp(account.id, xp, reason)
      .then((total) => player.conn.send({ t: "xp", amount: xp, reason, total }))
      .catch((err) => console.error(`XP award failed for ${account.username}:`, err));
  }

  // Move a player. The client applies it and starts tagging its moves with
  // the new tp number; anything still in flight from before is ignored.
  protected teleport(player: Player, p: Vec3): void {
    player.tp += 1;
    player.p = p;
    player.moveCheck.reset();
    player.conn.send({ t: "teleport", p, tp: player.tp });
    this.broadcast({ t: "moved", id: player.conn.id, p, ry: player.ry, time: Date.now() }, player.conn.id);
  }

  // Movement is client-authoritative, within reason: accept the position and
  // relay it, unless it implies impossible speed. Then snap the player back.
  protected handleMove(player: Player, msg: MoveMsg): void {
    if (msg.tp !== player.tp) return; // sent before the client saw our last teleport

    if (!player.moveCheck.allow(player.p, msg.p)) {
      const conn = player.conn;
      console.warn(`[${this.name}] rejected move from ${conn.name} (#${conn.id}): ${JSON.stringify(player.p)} -> ${JSON.stringify(msg.p)}`);
      this.strikes.record(String(conn.id));
      if (this.strikes.retryAfterMs(String(conn.id)) > 0) {
        conn.kick("Movement rejected too many times.");
        return;
      }
      this.teleport(player, player.p);
      return;
    }

    const from = player.p;
    const now = Date.now();
    player.p = msg.p;
    player.ry = msg.ry;
    this.broadcast({ t: "moved", id: player.conn.id, p: msg.p, ry: msg.ry, time: now }, player.conn.id);
    this.onPlayerMoved(player, from, msg.p, now);
  }

  protected broadcast(msg: ServerMsg, exceptId?: number): void {
    const text = JSON.stringify(msg);
    for (const player of this.players.values()) {
      if (player.conn.id !== exceptId) player.conn.sendRaw(text);
    }
  }
}
