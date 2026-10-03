// Decides which room a player goes into. In Phase 1 there is a single test
// room; later the hub sends players to mode rooms through portals.

import type { Connection } from "./Connection.ts";
import type { Room } from "./rooms/Room.ts";
import { TestRoom } from "./rooms/TestRoom.ts";

export class RoomManager {
  private rooms = new Map<string, Room>();

  constructor() {
    this.add(new TestRoom("test"));
  }

  private add(room: Room): void {
    this.rooms.set(room.name, room);
    room.start();
  }

  joinDefault(conn: Connection): void {
    const room = this.rooms.get("test")!;
    if (room.isFull) {
      conn.kick("The room is full.");
      return;
    }
    room.join(conn);
  }

  disconnect(conn: Connection): void {
    conn.room?.leave(conn);
  }

  totalPlayers(): number {
    let total = 0;
    for (const room of this.rooms.values()) total += room.playerCount;
    return total;
  }
}
