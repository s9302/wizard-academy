// Two parkour maps (noBots: true). Floating stones, beams and rooftops over
// a bottomless void, linked by jumps, ladders, jump pads and teleporters:
// too much for the bots' walking map, so bots aren't allowed on them (they
// leave when a round moves there, and can't be added).
//
// Jump numbers: a running jump covers about 5.5 m and rises about 1.2 m, so
// gaps here are 1.5 to 3 m, and steps up are 1 m or less (taller climbs get
// a ladder, a jump pad or a teleporter).

import { ArenaKit } from "./arenaKit.ts";
import type { Level } from "./types.ts";

const STONE = "#8d8aa6";
const STONE_LIGHT = "#a5a2bb";
const STONE_DARK = "#57536f";
const MOSS = "#6f9e5c";
const PLANK = "#a8744f";
const GOLD = "#e8c547";
const SKY = "#e8ecf5";

const FACE = { "+x": Math.PI / 2, "-x": -Math.PI / 2, "+z": 0, "-z": Math.PI };
const CORNERS: [number, number][] = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];

// ---------------- Arena (medium): The Sky Spires ----------------

// Corner islands (2 m up) where you start; stepping stones to side
// platforms; balance beams to a floating plaza in the middle; a spiral of
// stones up a 16 m tower (or its ladder); sky platforms reached by jump pads,
// with teleporters to the tower's top. Fall and you're out.
function skySpires(): Level {
  const k = new ArenaKit(32, SKY, STONE_DARK, 5);
  k.pit(0, 0, 64, 64, "void");
  const stone = (x: number, z: number, w: number, d: number, top: number, color = STONE) => k.slab(x, z, w, d, top - 0.6, top, color);
  // Corner islands.
  for (const [sx, sz] of CORNERS) {
    stone(sx * 24, sz * 24, 8, 8, 2, MOSS);
    k.spawn(sx * 24 - sx * 1.5, sz * 24, 2).spawn(sx * 24, sz * 24 - sz * 1.5, 2);
    k.pad(sx * 21, sz * 21, 18, 2); // up to the sky platform
  }
  // Side platforms (3 m), and stepping stones to them from both corners.
  for (const s of [1, -1]) {
    for (const [px, pz] of [[s * 24, 0], [0, s * 24]]) {
      stone(px, pz, 5, 5, 3, STONE_LIGHT);
      k.pickup(px, pz, 3);
      for (const t of [-1, 1]) {
        // From the corner island's edge (20 from the middle) to the platform's (2.5).
        for (let i = 0; i < 4; i++) {
          const along = t * (17.5 - i * 3.6);
          const x = px === 0 ? along : px;
          const z = px === 0 ? pz : along;
          stone(x, z, 1.6, 1.6, 2.2 + i * 0.2);
        }
      }
      // A balance beam in to the plaza (19.5 out to 5).
      if (px === 0) k.slab(0, s * 12.25, 0.6, 14.5, 2.6, 3, PLANK);
      else k.slab(s * 12.25, 0, 14.5, 0.6, 2.6, 3, PLANK);
    }
  }
  // The plaza in the middle, and the tower on it.
  stone(0, 0, 10, 10, 3, STONE_LIGHT);
  k.block(0, 0, 3, 3, 16, STONE_DARK);
  stone(0, 0, 8, 8, 16.6, STONE_LIGHT); // the top
  k.props.push({ kind: "crystal", pos: [0, 19, 0], color: GOLD, scale: 1 });
  k.pickup(-2.5, -2.5, 16.6).pickup(2.5, 2.5, 16.6);
  k.ladder(0, 1.5, 13, FACE["+z"], 3); // the quick way, if you can hold on
  // The spiral: 20 stones rising from the plaza to just under the top.
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2.6 + Math.PI / 4;
    stone(Math.cos(a) * 6, Math.sin(a) * 6, 1.6, 1.6, 3.7 + i * 0.66, i % 4 === 3 ? STONE_LIGHT : STONE);
  }
  // Sky platforms (8 m) between the corners and the tower.
  for (const [sx, sz] of CORNERS) {
    stone(sx * 15, sz * 15, 5, 5, 8, STONE_LIGHT);
    k.pickup(sx * 15, sz * 15, 8);
  }
  k.teleporterPair([15, 8, 15], [1.8, 16.6, 1.8], "#ffb347");
  k.teleporterPair([-15, 8, -15], [-1.8, 16.6, -1.8], "#ffb347");
  k.teleporterPair([15, 8, -15], [-15, 8, 15]);
  k.pickup(0, 24, 3).pickup(3.5, 0, 3);
  const level = k.level("skyspires", "The Sky Spires (parkour, no bots)", "medium", "golden", 46);
  return { ...level, noBots: true };
}

// ---------------- Infection: Skyrun Rooftops ----------------

// A town's rooftops over the void: a 5 x 5 block of buildings, 9 m square
// with 3 m alleys, rising toward a clocktower in the middle. Jump the
// alleys; where a roof is higher, a crate is a step or a ladder waits across
// the gap; planks bridge some alleys, jump pads and teleporters cut across.
// Fall in and you're infected.
function skyrunRooftops(): Level {
  const k = new ArenaKit(34, SKY, STONE_DARK, 4);
  k.pit(0, 0, 68, 68, "void");
  const H = [
    [4, 5, 6, 5, 4],
    [5, 6, 7, 6, 5],
    [6, 7, 11, 7, 6],
    [5, 6, 7, 6, 5],
    [4, 5, 6, 5, 4],
  ];
  const ROOF_COLORS = ["#a8483b", "#7a8fa8", "#8a6f8f", "#a87a3b", "#6f8a6f"];
  const at = (i: number) => (i - 2) * 12; // building centers: -24, -12, 0, 12, 24
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const x = at(c);
      const z = at(r);
      const h = H[r][c];
      k.block(x, z, 9, 9, h, (r + c) % 2 ? STONE : STONE_LIGHT);
      k.slab(x, z, 9.4, 9.4, h, h + 0.15, ROOF_COLORS[(r * 5 + c) % ROOF_COLORS.length]); // the roof
      // To each neighbor east and south: an easy step needs nothing; a 1 m
      // rise gets a crate on the lower roof; more gets a ladder across the gap.
      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        const r2 = r + dr;
        const c2 = c + dc;
        if (r2 > 4 || c2 > 4) continue;
        const h2 = H[r2][c2];
        const diff = Math.abs(h2 - h);
        const [lowR, lowC, highR, highC] = h2 > h ? [r, c, r2, c2] : [r2, c2, r, c];
        const lx = at(lowC);
        const lz = at(lowR);
        const hx = at(highC);
        const hz = at(highR);
        const dirX = Math.sign(hx - lx);
        const dirZ = Math.sign(hz - lz);
        const low = Math.min(h, h2);
        if (diff === 1) {
          // A crate near the edge facing the higher roof (half a meter up).
          k.block(lx + dirX * 3, lz + dirZ * 3, 1.4, 1.4, low + 0.15 + 0.55, PLANK);
        } else if (diff > 1) {
          // A ladder on the higher building's face, across the alley.
          const fx = hx - dirX * 4.5;
          const fz = hz - dirZ * 4.5;
          const yaw = dirX > 0 ? FACE["-x"] : dirX < 0 ? FACE["+x"] : dirZ > 0 ? FACE["-z"] : FACE["+z"];
          k.ladder(fx, fz, Math.max(h, h2) - low + 1.2, yaw, low - 1);
        } else if ((r + c) % 3 === 0) {
          // Same height: a plank across, now and then.
          const mx = (x + at(c2)) / 2;
          const mz = (z + at(r2)) / 2;
          if (dc) k.slab(mx, mz, 3.6, 0.6, h - 0.1, h + 0.15, PLANK);
          else k.slab(mx, mz, 0.6, 3.6, h - 0.1, h + 0.15, PLANK);
        }
      }
    }
  }
  // The clocktower's crown, and jump pads up to it from the roofs around.
  k.props.push({ kind: "crystal", pos: [0, 13.5, 0], color: GOLD, scale: 1.1 });
  for (const [x, z] of [[-12, 0], [12, 0], [0, -12], [0, 12]]) k.pad(x + Math.sign(-x) * 3.2, z + Math.sign(-z) * 3.2, 16, 7.15);
  // Teleporters between opposite corner roofs.
  k.teleporterPair([24, 4.15, 24], [-24, 4.15, -24], "#ffb347");
  k.teleporterPair([-24, 4.15, 24], [24, 4.15, -24]);
  // Spawns on the outer roofs.
  for (const [x, z, h] of [[-24, -12, 5], [24, 12, 5], [-12, 24, 5], [12, -24, 5], [0, 24, 6], [0, -24, 6], [24, 0, 6], [-24, 0, 6]]) k.spawn(x + 1.5, z + 1.5, h + 0.15);
  const level = k.level("skyrun", "Skyrun Rooftops (parkour, no bots)", "large", "day", 46);
  return { ...level, noBots: true };
}

export const skyspires = skySpires();
export const skyrun = skyrunRooftops();
