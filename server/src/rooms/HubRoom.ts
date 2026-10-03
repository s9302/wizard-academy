// The academy hub: free movement, plus portals to every other room. Walking
// into a portal is detected by the client (it can join any room anyway); the
// hub's jobs are putting people who come back in front of the portal they
// used, and keeping the portal signs' player counts up to date.

import type { Vec3 } from "../../../shared/src/protocol.ts";
import type { Level } from "../../../shared/src/levels/types.ts";
import { portalPoint } from "../../../shared/src/levels/types.ts";
import type { RoomInfo } from "../../../shared/src/rooms.ts";
import { PLAYER_HALF_HEIGHT, PLAYER_RADIUS } from "../../../shared/src/constants.ts";
import { type Player, Room } from "./Room.ts";

const COUNTS_INTERVAL_MS = 2000;
// How far in front of its portal someone coming back appears.
const ARRIVAL_DISTANCE = 3.5;
const CAPSULE_CENTER = PLAYER_HALF_HEIGHT + PLAYER_RADIUS; // above the floor

export class HubRoom extends Room {
  private counts: () => Record<string, number>;
  private lastCounts = "";
  private nextCountsAt = 0;

  constructor(info: RoomInfo, level: Level, counts: () => Record<string, number>) {
    super(info, level);
    this.counts = counts;
  }

  protected override arrivalPoint(from: string): { p: Vec3; yaw: number } | null {
    const portal = this.level.portals?.find((x) => x.room === from);
    if (!portal) return null;
    const side = (Math.random() - 0.5) * 1.5; // a little apart if several come back at once
    // On the path past the step, facing away from the portal (toward the plaza).
    return { p: portalPoint(portal, side, CAPSULE_CENTER + 0.1, ARRIVAL_DISTANCE), yaw: portal.yaw };
  }

  protected override onPlayerJoined(player: Player): void {
    player.conn.send({ t: "roomCounts", counts: this.counts() });
  }

  protected override onTick(now: number): void {
    if (now < this.nextCountsAt || this.playerCount === 0) return;
    this.nextCountsAt = now + COUNTS_INTERVAL_MS;
    const counts = this.counts();
    const text = JSON.stringify(counts);
    if (text === this.lastCounts) return;
    this.lastCounts = text;
    this.broadcast({ t: "roomCounts", counts });
  }
}
