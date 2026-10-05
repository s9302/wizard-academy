// Creates one room per entry in shared/src/rooms.ts and puts players into the
// room they asked for. Players start in the hub and switch rooms through its
// portals (each switch is a new connection that says hello to the new room).

import { LEVELS } from "../../shared/src/levels/index.ts";
import { ROOMS, type RoomInfo } from "../../shared/src/rooms.ts";
import type { Level } from "../../shared/src/levels/types.ts";
import type { Connection } from "./Connection.ts";
import { BossRoom } from "./rooms/BossRoom.ts";
import { CtfRoom } from "./rooms/CtfRoom.ts";
import { HordeRoom } from "./rooms/HordeRoom.ts";
import { HubRoom } from "./rooms/HubRoom.ts";
import { InfectionRoom } from "./rooms/InfectionRoom.ts";
import { ParkourRoom } from "./rooms/ParkourRoom.ts";
import { PlaygroundRoom } from "./rooms/PlaygroundRoom.ts";
import { RoyaleRoom } from "./rooms/RoyaleRoom.ts";
import type { Room } from "./rooms/Room.ts";
import { TagRoom } from "./rooms/TagRoom.ts";

function createRoom(info: RoomInfo, level: Level, manager: RoomManager): Room {
  switch (info.mode) {
    case "hub":
      return new HubRoom(info, level, () => manager.humanCounts());
    case "parkour":
      return new ParkourRoom(info, level);
    case "tag":
      return new TagRoom(info, level);
    case "infection":
      return new InfectionRoom(info, level);
    case "royale":
      return new RoyaleRoom(info, level);
    case "boss":
      return new BossRoom(info, level);
    case "ctf":
      return new CtfRoom(info, level);
    case "horde":
      return new HordeRoom(info, level);
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
      const room = createRoom(info, level, this);
      this.rooms.set(room.name, room);
      room.start();
    }
  }

  // People (not bots) in each room, for the hub's portal signs.
  humanCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const [id, room] of this.rooms) counts[id] = room.humanCount;
    return counts;
  }

  join(conn: Connection, roomName: string, from?: string): void {
    const room = this.rooms.get(roomName);
    if (!room) {
      conn.kick("That room doesn't exist.");
      return;
    }
    if (room.isFull) {
      conn.kick("The room is full.");
      return;
    }
    room.join(conn, from);
  }

  disconnect(conn: Connection): void {
    conn.room?.leave(conn);
  }
}
