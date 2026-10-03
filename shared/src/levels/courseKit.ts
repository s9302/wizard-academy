// Helpers for building parkour courses out of boxes.
//
// Jump budget (see constants.ts): a running jump covers ~5.6 m on the flat
// (more when landing lower), a walking jump ~3 m, and the highest jump is
// ~1.2 m. Check new courses with client/scripts/simulate-course.ts.

import type { Vec3 } from "../protocol.ts";
import type { Box, Checkpoint, Zone } from "./types.ts";

export const COLORS = {
  stone: "#8d8aa6",
  stoneDark: "#6c6889",
  violet: "#7b68b5",
  teal: "#4fa3a5", // checkpoint platforms
  gold: "#e8c547",
  start: "#5b8f5a",
  rust: "#a8744f",
};

export class CourseKit {
  readonly boxes: Box[] = [];

  // A platform 1 m thick whose top surface is at `top`. (The physics-bot
  // simulator treats 1 m thick boxes as the course's platforms, in order.)
  plat(x: number, top: number, z: number, w: number, d: number, color: string): void {
    this.boxes.push({ pos: [x, top - 0.5, z], size: [w, 1, d], color });
  }

  // Scenery: anything that isn't a platform on the route.
  deco(pos: Vec3, size: Vec3, color: string): void {
    if (size[1] === 1) throw new Error("decoration boxes must not be 1 m thick (reserved for platforms)");
    this.boxes.push({ pos, size, color });
  }

  // The air above a platform, up to 4 m high: a trigger zone.
  above(x: number, top: number, z: number, w: number, d: number): Zone {
    return { min: [x - w / 2, top, z - d / 2], max: [x + w / 2, top + 4, z + d / 2] };
  }

  checkpoint(x: number, top: number, z: number, size = 6): Checkpoint {
    this.plat(x, top, z, size, size, COLORS.teal);
    const corner = size / 2 - 0.8;
    return {
      zone: this.above(x, top, z, size, size),
      respawn: [x, top + 1, z],
      marker: [x + corner, top + 1.6, z + corner],
    };
  }

  // Finish platform with a golden arch along its far edge (-Z side, or the
  // +X side when `facing` is "x").
  finish(x: number, top: number, z: number, facing: "z" | "x" = "z"): Zone {
    this.plat(x, top, z, 6, 6, COLORS.stone);
    const gold = COLORS.gold;
    if (facing === "z") {
      this.deco([x - 2.5, top + 1.5, z - 2.4], [0.6, 3, 0.6], gold);
      this.deco([x + 2.5, top + 1.5, z - 2.4], [0.6, 3, 0.6], gold);
      this.deco([x, top + 3.2, z - 2.4], [5.6, 0.4, 0.6], gold);
    } else {
      this.deco([x + 2.4, top + 1.5, z - 2.5], [0.6, 3, 0.6], gold);
      this.deco([x + 2.4, top + 1.5, z + 2.5], [0.6, 3, 0.6], gold);
      this.deco([x + 2.4, top + 3.2, z], [0.6, 0.4, 5.6], gold);
    }
    return this.above(x, top, z, 6, 6);
  }
}
