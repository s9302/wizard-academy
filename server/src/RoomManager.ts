// Creates one room per level and puts players into the room they asked for.
// Until the hub exists (Phase 6), players pick a room on the join screen.

import { LEVELS } from "../../shared/src/levels/index.ts";
import type { Connection } from "./Connection.ts";
import { ParkourRoom } from "./rooms/ParkourRoom.ts";
import { PlaygroundRoom } from "./rooms/PlaygroundRoom.ts";
import type { Room } from "./rooms/Room.ts";

export class RoomManager {
  private rooms = new Map<string, Room>();

  constructor() {
    for (const level of Object.values(LEVELS)) {
      const room = level.course ? new ParkourRoom(level) : new PlaygroundRoom(level);
      this.rooms.set(room.name, room);
      room.start();
    }
  }

  join(conn: Connection, roomName: string): void {
    const room = this.rooms.get(roomName);
    if (!room) {
      conn.kick("That room doesn't exist.");
      return;
    }
    if (room.isFull) {
      conn.kick("The room is full.");
      return;
    }
    room.join(conn);
  }

  disconnect(conn: Connection): void {
    conn.room?.leave(conn);
  }
}
