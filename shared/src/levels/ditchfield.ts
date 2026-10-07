// The Ditchquid pitch: a long lawn with three hoops at each end (low, high,
// middling), stands for the crowd along both sides, banners in team
// colors, and an invisible ceiling high above so nobody flies off forever.

import { DQ_TEAMS, type Hoop } from "../ditchquid.ts";
import { FALL_RESPAWN_Y } from "../constants.ts";
import type { Vec3 } from "../protocol.ts";
import type { Box, Level, Prop } from "./types.ts";

const LONG = 44; // half length (x)
const WIDE = 24; // half width (z)
const TOP = 46; // the ceiling
const GRASS = "#5f9e4f";
const STRIPE = "#6aab58";
const CHALK = "#e8e4d8";
const WOOD = "#7a5236";
const STONE = "#8d8aa6";
const ROOF = "#3b2a6b";
const boxes: Box[] = [];
const props: Prop[] = [];

// The lawn, mown in stripes, with chalk lines.
boxes.push({ pos: [0, -0.5, 0], size: [LONG * 2 + 30, 1, WIDE * 2 + 30], color: GRASS });
for (let x = -LONG + 4; x < LONG; x += 8) boxes.push({ pos: [x, 0.01, 0], size: [4, 0.02, WIDE * 2], color: STRIPE });
boxes.push({ pos: [0, 0.03, 0], size: [0.3, 0.02, WIDE * 2], color: CHALK });
for (const z of [-WIDE, WIDE]) boxes.push({ pos: [0, 0.03, z], size: [LONG * 2, 0.02, 0.3], color: CHALK });
for (const x of [-LONG, LONG]) boxes.push({ pos: [x, 0.03, 0], size: [0.3, 0.02, WIDE * 2], color: CHALK });

// Invisible walls and ceiling: the pitch is a box you can't fly out of.
for (const [x, z, w, d] of [
  [0, -WIDE - 6, LONG * 2 + 12, 1],
  [0, WIDE + 6, LONG * 2 + 12, 1],
  [-LONG - 6, 0, 1, WIDE * 2 + 12],
  [LONG + 6, 0, 1, WIDE * 2 + 12],
] as const) {
  boxes.push({ pos: [x, TOP / 2, z], size: [w, TOP, d], color: STONE, invisible: true });
}
boxes.push({ pos: [0, TOP + 0.5, 0], size: [LONG * 2 + 12, 1, WIDE * 2 + 12], color: STONE, invisible: true });

// Stands along both sides: tiers of benches under a roof, with team banners.
for (const s of [-1, 1]) {
  for (let tier = 0; tier < 5; tier++) {
    const z = s * (WIDE + 2 + tier * 1.2);
    boxes.push({ pos: [0, tier * 0.9 + 0.45, z], size: [LONG * 1.6, tier * 1.8 + 0.9, 1.2], color: tier % 2 ? WOOD : "#8a6040" });
  }
  boxes.push({ pos: [0, 8.5, s * (WIDE + 5)], size: [LONG * 1.6, 0.4, 7], color: ROOF });
  for (let x = -LONG * 0.8; x <= LONG * 0.8; x += LONG * 0.4) boxes.push({ pos: [x, 4.5, s * (WIDE + 8.2)], size: [0.5, 8.6, 0.5], color: WOOD });
  for (let i = 0; i < 8; i++) {
    const x = -LONG * 0.7 + i * (LONG * 1.4) / 7;
    props.push({ kind: "banner", pos: [x, 8.2, s * (WIDE + 1.6)], yaw: s > 0 ? Math.PI : 0, size: [1.6, 3.4], color: DQ_TEAMS[x < 0 ? 0 : 1].color });
  }
  for (let i = 0; i < 6; i++) props.push({ kind: "student", pos: [-LONG * 0.6 + i * LONG * 0.24, 0, s * (WIDE + 0.8)], scale: 1.2 });
}

// The hoops: three at each end, low / high / middling, on poles. Team 0
// (Crimson) defends the west end, team 1 (Azure) the east.
const HOOP_R = 1.7;
export const HOOPS: Hoop[] = [];
for (const [team, x] of [[0, -LONG + 6], [1, LONG - 6]] as const) {
  for (const [z, y] of [[-8, 9], [0, 15], [8, 12]]) {
    const pos: Vec3 = [x, y, z];
    HOOPS.push({ pos, r: HOOP_R, team });
    boxes.push({ pos: [x, (y - HOOP_R) / 2, z], size: [0.35, y - HOOP_R, 0.35], color: STONE });
    boxes.push({ pos: [x, 0.3, z], size: [1.6, 0.6, 1.6], color: STONE });
    props.push({ kind: "hoop", pos, size: [HOOP_R, 0.12], color: DQ_TEAMS[team].color });
  }
  // A tall team banner behind the hoops.
  props.push({ kind: "banner", pos: [x + (team ? 5 : -5), 20, 0], yaw: team ? -Math.PI / 2 : Math.PI / 2, size: [3, 8], color: DQ_TEAMS[team].color });
  boxes.push({ pos: [x + (team ? 5.2 : -5.2), 10.2, 0], size: [0.4, 20.4, 0.4], color: WOOD });
}

// Spawns: each team on the ground in front of its own hoops.
const spawns = (team: 0 | 1): Vec3[] => {
  const x = team ? LONG - 14 : -LONG + 14;
  return [-12, -6, 0, 6, 12, -9, 3, 9].map((z) => [x, 1.2, z] as Vec3);
};

export const ditchfield: Level = {
  id: "ditchfield",
  name: "The Academy Pitch",
  spawn: [0, 1.2, 0],
  spawnSpread: 2,
  spawnYaw: 0,
  spawnPoints: [...spawns(0), ...spawns(1)],
  killY: FALL_RESPAWN_Y,
  sky: "#9cc4f0",
  skyStyle: "golden",
  boxes,
  props,
  ditchquid: { hoops: HOOPS, spawns: [spawns(0), spawns(1)], ball: [0, 10, 0], bounds: { x: LONG + 5, z: WIDE + 5, top: TOP - 1 } },
};
