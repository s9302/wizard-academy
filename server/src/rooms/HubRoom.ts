// The academy hub: free movement, plus portals to every other room. Walking
// into a portal is detected by the client (it can join any room anyway); the
// hub's jobs are putting people who come back in front of the portal they
// used, keeping the portal signs' player counts up to date, and saving
// loadouts from the Spellbook and Wardrobe (only here, where they stand).

import type { ClientMsg, Vec3 } from "../../../shared/src/protocol.ts";
import { saveLoadout } from "../accounts.ts";
import { lookOf } from "../../../shared/src/unlocks.ts";
import type { Level } from "../../../shared/src/levels/types.ts";
import { portalPoint } from "../../../shared/src/levels/types.ts";
import type { RoomInfo } from "../../../shared/src/rooms.ts";
import { PLAYER_HALF_HEIGHT, PLAYER_RADIUS } from "../../../shared/src/constants.ts";
import { type Player, Room } from "./Room.ts";

const COUNTS_INTERVAL_MS = 2000;
const LOADOUT_SAVE_MS = 400; // at most this often per player (each one is a database write)
// How far in front of its portal someone coming back appears.
const ARRIVAL_DISTANCE = 3.5;
const CAPSULE_CENTER = PLAYER_HALF_HEIGHT + PLAYER_RADIUS; // above the floor

export class HubRoom extends Room {
  // Anyone can fly about the academy on a broom (B).
  protected override allowsBrooms(): boolean {
    return true;
  }

  private counts: () => Record<string, number>;
  private lastCounts = "";
  private nextCountsAt = 0;
  private lastSave = new Map<number, number>();

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

  protected override onPlayerLeft(player: Player): void {
    this.lastSave.delete(player.conn.id);
  }

  protected override onMessage(player: Player, msg: ClientMsg): void {
    if (msg.t !== "loadout") return;
    const conn = player.conn;
    const account = conn.account;
    const now = Date.now();
    if (!account || now - (this.lastSave.get(conn.id) ?? 0) < LOADOUT_SAVE_MS) return;
    this.lastSave.set(conn.id, now);
    // Checked against fresh unlocks: anything locked falls back to the default.
    // The class and arena abilities aren't part of this message: keep the
    // saved ones. A message without a house keeps yours (you can only switch).
    saveLoadout(account.id, { ...msg, cls: account.loadout.cls, abil: account.loadout.abil, house: msg.house ?? account.loadout.house })
      .then(({ loadout, unlocked }) => {
        account.loadout = loadout;
        account.unlocked = unlocked;
        conn.look = lookOf(loadout);
        conn.send({ t: "loadoutSaved", ...loadout });
        if (conn.room === this) this.broadcast({ t: "look", id: conn.id, look: conn.look }, conn.id);
      })
      .catch((err) => console.error("saving loadout for %s failed:", account.username, err));
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
