// Creates one room per entry in shared/src/rooms.ts and puts players into the
// room they asked for. Until the hub exists (Phase 6), players pick a room on
// the join screen.

import { LEVELS } from "../../shared/src/levels/index.ts";
import { ROOMS, type RoomInfo } from "../../shared/src/rooms.ts";
import type { Level } from "../../shared/src/levels/types.ts";
import type { Connection } from "./Connection.ts";
import { InfectionRoom } from "./rooms/InfectionRoom.ts";
import { ParkourRoom } from "./rooms/ParkourRoom.ts";
import { PlaygroundRoom } from "./rooms/PlaygroundRoom.ts";
import type { Room } from "./rooms/Room.ts";
import { TagRoom } from "./rooms/TagRoom.ts";

function createRoom(info: RoomInfo, level: Level): Room {
  switch (info.mode) {
    case "parkour":
      return new ParkourRoom(info, level);
    case "tag":
      return new TagRoom(info, level);
    case "infection":
      return new InfectionRoom(info, level);
    case "free":
      return new PlaygroundRoom(info, level);
  }
}

export class RoomManager {
  private rooms = new Map<string, Room>();

  constructor() {
    for (const info of ROOMS) {
      const level = LEVELS[info.levelId];
      if (!level) throw new Error(`room ${info.id}: unknown level ${info.levelId}`);
      const room = createRoom(info, level);
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
