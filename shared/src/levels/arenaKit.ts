// Helpers for building battle royale arenas out of boxes: solid blocks and
// towers, ramps between two heights, bridges, walls, and spawn and pickup
// spots. Heights are where you stand (the top of something), so a ramp from
// 0 to 4 starts on the ground and ends level with a 4 m tower.
//
// Rules the arenas follow so everyone (and the bots) can get around:
// ramps no steeper than about 35 degrees; ledges you're meant to hop up are
// at most 1 m; drops bots take are at most 3 m (anything higher has a ramp).

import type { Vec3 } from "../protocol.ts";
import type { Box, Level } from "./types.ts";
import { FALL_RESPAWN_Y } from "../constants.ts";

export type ArenaSize = "small" | "medium" | "large";

export class ArenaKit {
  readonly boxes: Box[] = [];
  readonly spawns: Vec3[] = [];
  readonly pickups: Vec3[] = [];
  readonly half: number;

  // A walled square arena, 2*half wide, with a floor of `ground` color.
  constructor(half: number, ground: string, wall: string, wallHeight = 6) {
    this.half = half;
    this.boxes.push({ pos: [0, -0.5, 0], size: [half * 2 + 4, 1, half * 2 + 4], color: ground });
    for (const [x, z, w, d] of [
      [0, -half, half * 2, 1],
      [0, half, half * 2, 1],
      [-half, 0, 1, half * 2],
      [half, 0, 1, half * 2],
    ]) {
      this.boxes.push({ pos: [x, wallHeight / 2, z], size: [w, wallHeight, d], color: wall });
    }
  }

  // Solid from the ground up to `top`.
  block(x: number, z: number, w: number, d: number, top: number, color: string): this {
    this.boxes.push({ pos: [x, top / 2, z], size: [w, top, d], color });
    return this;
  }

  // A box floating from y0 up to y1 (a slab, a lintel...).
  slab(x: number, z: number, w: number, d: number, y0: number, y1: number, color: string, overhead = false): this {
    this.boxes.push({ pos: [x, (y0 + y1) / 2, z], size: [w, y1 - y0, d], color, overhead: overhead || undefined });
    return this;
  }

  // A walkable bridge whose top is at height y (you can walk under it).
  bridge(x: number, z: number, w: number, d: number, y: number, color: string): this {
    return this.slab(x, z, w, d, y - 0.4, y, color, true);
  }

  // A ramp along x from (x0, height y0) to (x1, height y1), `width` wide, at z.
  rampX(x0: number, x1: number, z: number, width: number, y0: number, y1: number, color: string): this {
    const run = Math.abs(x1 - x0);
    const rise = y1 - y0;
    const angle = Math.atan2(rise, run) * Math.sign(x1 - x0); // rises toward x1
    this.boxes.push({
      pos: [(x0 + x1) / 2, (y0 + y1) / 2 - 0.2, z],
      size: [Math.hypot(run, rise), 0.4, width],
      color,
      rot: [0, 0, angle],
    });
    return this;
  }

  // A ramp along z from (z0, height y0) to (z1, height y1), `width` wide, at x.
  rampZ(z0: number, z1: number, x: number, width: number, y0: number, y1: number, color: string): this {
    const run = Math.abs(z1 - z0);
    const rise = y1 - y0;
    // Rotating about x by -a lifts the +z end, so rising toward +z is -a.
    const angle = -Math.atan2(rise, run) * Math.sign(z1 - z0);
    this.boxes.push({
      pos: [x, (y0 + y1) / 2 - 0.2, (z0 + z1) / 2],
      size: [width, 0.4, Math.hypot(run, rise)],
      color,
      rot: [angle, 0, 0],
    });
    return this;
  }

  // A low wall to hide behind (or shoot over, if it's low).
  wall(x: number, z: number, w: number, d: number, h: number, color: string, floor = 0): this {
    this.boxes.push({ pos: [x, floor + h / 2, z], size: [w, h, d], color });
    return this;
  }

  // A tree: trunk and two blocks of leaves (solid: you can hide behind it).
  tree(x: number, z: number, scale = 1, floor = 0): this {
    this.boxes.push({ pos: [x, floor + 1.2 * scale, z], size: [0.6 * scale, 2.4 * scale, 0.6 * scale], color: "#6b4a30" });
    this.boxes.push({ pos: [x, floor + 3.1 * scale, z], size: [2.8 * scale, 1.8 * scale, 2.8 * scale], color: "#3f8a4a" });
    this.boxes.push({ pos: [x, floor + 4.4 * scale, z], size: [1.7 * scale, 1.1 * scale, 1.7 * scale], color: "#4f9a55" });
    return this;
  }

  // A pickup floating over the floor at (x, z), floor height `floor`.
  pickup(x: number, z: number, floor = 0): this {
    this.pickups.push([x, floor + 0.9, z]);
    return this;
  }

  spawn(x: number, z: number, floor = 0): this {
    this.spawns.push([x, floor + 1, z]);
    return this;
  }

  // n spawn points evenly around a circle.
  spawnRing(n: number, radius: number, floor = 0, offsetDeg = 0): this {
    for (let k = 0; k < n; k++) {
      const a = ((offsetDeg + (k * 360) / n) * Math.PI) / 180;
      this.spawn(Math.round(radius * Math.cos(a) * 10) / 10, Math.round(radius * Math.sin(a) * 10) / 10, floor);
    }
    return this;
  }

  level(id: string, name: string, size: ArenaSize, sky: "day" | "dusk", stormRadius: number): Level {
    return {
      id,
      name,
      spawn: this.spawns[0],
      spawnSpread: 0.5,
      spawnPoints: this.spawns,
      killY: FALL_RESPAWN_Y,
      sky: sky === "dusk" ? "#e3b7c8" : "#a9c8f5",
      skyStyle: sky,
      boxes: this.boxes,
      pickupSpots: this.pickups,
      arena: { size, stormRadius, stormScale: stormRadius / 46 },
    };
  }
}
