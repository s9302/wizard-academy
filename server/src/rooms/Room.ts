// Base class for every game mode. A room owns a set of players and runs a
// fixed-rate "tick" for timers and game rules. Each mode (parkour, tag, battle
// royale...) will be a subclass that overrides the hooks below.

import type { ClientMsg, MoveMsg, ServerMsg, Vec3 } from "../../../shared/src/protocol.ts";
import { MAX_PLAYERS_PER_ROOM, NET_INTERVAL_MS } from "../../../shared/src/constants.ts";
import type { Connection } from "../Connection.ts";

export type Player = {
  conn: Connection;
  p: Vec3;
  ry: number;
};

export abstract class Room {
  readonly name: string;
  readonly maxPlayers: number = MAX_PLAYERS_PER_ROOM;
  protected players = new Map<number, Player>();
  private tickTimer: NodeJS.Timeout | null = null;

  constructor(name: string) {
    this.name = name;
  }

  get playerCount(): number {
    return this.players.size;
  }

  get isFull(): boolean {
    return this.players.size >= this.maxPlayers;
  }

  // ---- Hooks for subclasses ----

  // Where a new player appears.
  protected abstract spawnPoint(): Vec3;
  protected onPlayerJoined(_player: Player): void {}
  protected onPlayerLeft(_player: Player): void {}
  // Messages other than movement (mode-specific actions go here later).
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
    const player: Player = { conn, p: spawn, ry: 0 };

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
    } else {
      this.onMessage(player, msg);
    }
  }

  // Movement is client-authoritative: accept the position and relay it.
  // (Phase 2 adds the speed / teleport sanity check here.)
  protected handleMove(player: Player, msg: MoveMsg): void {
    player.p = msg.p;
    player.ry = msg.ry;
    this.broadcast({ t: "moved", id: player.conn.id, p: msg.p, ry: msg.ry, time: Date.now() }, player.conn.id);
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
