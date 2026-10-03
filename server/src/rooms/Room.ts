// Base class for every game mode. A room owns a set of players and runs a
// fixed-rate "tick" for timers and game rules. Each mode (parkour, tag, battle
// royale...) will be a subclass that overrides the hooks below.

import type { ClientMsg, MoveMsg, ServerMsg, Vec3 } from "../../../shared/src/protocol.ts";
import { MAX_PLAYERS_PER_ROOM, NET_INTERVAL_MS } from "../../../shared/src/constants.ts";
import type { Level } from "../../../shared/src/levels/types.ts";
import type { Connection } from "../Connection.ts";
import { SlidingWindowLimiter } from "../limits.ts";
import { MoveCheck } from "../MoveCheck.ts";

// A few rejected moves can happen to anyone on a bad connection; this many in
// a short time means a cheat client.
const MAX_STRIKES = 5;
const STRIKE_WINDOW_MS = 30_000;

export type Player = {
  conn: Connection;
  p: Vec3; // last accepted position
  ry: number;
  tp: number; // how many times the server has teleported this player
  moveCheck: MoveCheck;
};

export abstract class Room {
  readonly name: string;
  readonly level: Level;
  readonly maxPlayers: number = MAX_PLAYERS_PER_ROOM;
  protected players = new Map<number, Player>();
  private tickTimer: NodeJS.Timeout | null = null;
  private strikes = new SlidingWindowLimiter(MAX_STRIKES, STRIKE_WINDOW_MS);

  constructor(level: Level) {
    this.name = level.id;
    this.level = level;
  }

  get playerCount(): number {
    return this.players.size;
  }

  get isFull(): boolean {
    return this.players.size >= this.maxPlayers;
  }

  // ---- Hooks for subclasses ----

  // Where a new player appears: the level's spawn, spread out a little so
  // players don't appear inside each other.
  protected spawnPoint(): Vec3 {
    const [x, y, z] = this.level.spawn;
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

  join(conn: Connection): void {
    const spawn = this.spawnPoint();
    const player: Player = { conn, p: spawn, ry: 0, tp: 0, moveCheck: new MoveCheck() };

    conn.send({
      t: "welcome",
      id: conn.id,
      room: this.name,
      spawn,
      time: Date.now(),
      players: [...this.players.values()].map((other) => ({
        id: other.conn.id,
        name: other.conn.name,
        p: other.p,
        ry: other.ry,
      })),
    });

    this.players.set(conn.id, player);
    conn.room = this;
    this.broadcast(
      { t: "join", player: { id: conn.id, name: conn.name, p: player.p, ry: player.ry }, time: Date.now() },
      conn.id,
    );
    this.onPlayerJoined(player);
    console.log(`[${this.name}] ${conn.name} (#${conn.id}) joined, ${this.players.size} online`);
  }

  leave(conn: Connection): void {
    const player = this.players.get(conn.id);
    if (!player) return;
    this.players.delete(conn.id);
    conn.room = null;
    this.broadcast({ t: "leave", id: conn.id });
    this.onPlayerLeft(player);
    console.log(`[${this.name}] ${conn.name} (#${conn.id}) left, ${this.players.size} online`);
  }

  handleMessage(conn: Connection, msg: ClientMsg): void {
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
      if (player.conn.id !== exceptId && player.conn.socket.readyState === player.conn.socket.OPEN) {
        player.conn.socket.send(text);
      }
    }
  }
}
