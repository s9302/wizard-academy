// The four house towers on the academy's corners (Spencer's 2026-10-07
// request), each with its house's common room at the top: fly in on a broom
// through the arch onto the balcony, or step on the glowing pad by the door
// at the foot of the tower. Inside: a fire, the house crest over it,
// banners, armchairs, and the house roll (press E to join).
//
// academy.ts calls houseTowers() with its boxes and props.

import { HOUSES, type HouseId } from "../houses.ts";
import type { Vec3 } from "../protocol.ts";
import type { Box, Label, Prop, Station, Teleporter } from "./types.ts";

export const TOWER_FLOOR = 15; // the common rooms' floor (above the academy's roof)
const SIZE = 9; // outside, square
const WALL = 0.5;
const ROOM_TOP = 21.5; // the ceiling
const DOOR_W = 3.4; // the broom arch
const DOOR_H = 3.8;

const STONE = "#57536f";
const STONE_LIGHT = "#a5a2bb";
const FLOOR = "#8d8aa6";
const WOOD_DARK = "#4e3322";
const ROOF = "#3b2a6b";
const WINDOW = "#f2d98a";

// Where each house's tower stands, and which way its arch faces (+1: south,
// toward the plaza; -1: north, over the back of the grounds).
export const HOUSE_TOWERS: { house: HouseId; x: number; z: number; face: 1 | -1 }[] = [
  { house: "liondor", x: -34, z: -32, face: 1 },
  { house: "ravenhand", x: 34, z: -32, face: 1 },
  { house: "snakerins", x: -34, z: -72, face: -1 },
  { house: "simpletonpuff", x: 34, z: -72, face: -1 },
];

export function houseTowers(boxes: Box[], props: Prop[]): { stations: Station[]; labels: Label[]; teleporters: Teleporter[] } {
  const stations: Station[] = [];
  const labels: Label[] = [];
  const teleporters: Teleporter[] = [];
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: string, extra: Partial<Box> = {}) =>
    boxes.push({ pos: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], size: [Math.abs(x1 - x0), y1 - y0, Math.abs(z1 - z0)], color, ...extra });

  for (const { house, x: cx, z: cz, face: d } of HOUSE_TOWERS) {
    const H = HOUSES[house];
    const h = SIZE / 2;
    const F = TOWER_FLOOR;
    const front = cz + d * h; // the arch's wall (outside face)
    const back = cz - d * h;
    const zIn = (k: number) => cz + d * k; // k meters toward the arch from the middle
    // Solid stone up to the room, with lit windows on its outer faces.
    box(cx - h, cx + h, 0, F, cz - h, cz + h, STONE);
    for (const y of [5, 10]) {
      box(cx - 0.8, cx + 0.8, y - 1.1, y + 1.1, front - d * 0.05, front + d * 0.1, WINDOW, { glow: 2.2 });
      box(cx + Math.sign(cx) * (h + 0.05) - 0.08, cx + Math.sign(cx) * (h + 0.05) + 0.08, y - 1.1, y + 1.1, cz - 0.8, cz + 0.8, WINDOW, { glow: 2.2 });
    }
    // The room's walls: the arch wall in two pieces and a lintel.
    box(cx - h, cx + h, F, ROOM_TOP, back - d * 0, back + d * WALL, STONE); // back wall
    box(cx - h, cx - h + WALL, F, ROOM_TOP, cz - h, cz + h, STONE);
    box(cx + h - WALL, cx + h, F, ROOM_TOP, cz - h, cz + h, STONE);
    for (const s of [-1, 1]) box(cx + s * (DOOR_W / 2), cx + s * h, F, ROOM_TOP, front - d * WALL, front, STONE);
    box(cx - DOOR_W / 2, cx + DOOR_W / 2, F + DOOR_H, ROOM_TOP, front - d * WALL, front, STONE);
    // The arch's frame in house colors.
    for (const s of [-1, 1]) box(cx + s * (DOOR_W / 2 + 0.15) - 0.15, cx + s * (DOOR_W / 2 + 0.15) + 0.15, F, F + DOOR_H, front - d * 0.1, front + d * 0.2, H.color);
    box(cx - DOOR_W / 2 - 0.3, cx + DOOR_W / 2 + 0.3, F + DOOR_H, F + DOOR_H + 0.35, front - d * 0.1, front + d * 0.2, H.trim);
    // Floor, ceiling, battlements and the spire.
    box(cx - h, cx + h, F - 0.2, F, cz - h, cz + h, FLOOR);
    box(cx - h, cx + h, ROOM_TOP, ROOM_TOP + 0.5, cz - h, cz + h, STONE);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      boxes.push({ pos: [cx + Math.cos(a) * (h - 0.3), ROOM_TOP + 0.9, cz + Math.sin(a) * (h - 0.3)], size: [1, 0.8, 1], color: STONE, rot: [0, -a, 0] });
    }
    props.push({ kind: "cone", pos: [cx, ROOM_TOP + 0.5, cz], size: [5.6, 10], color: ROOF });
    // A balcony out front to land on (rails on its sides, open ahead).
    box(cx - 2.2, cx + 2.2, F - 0.3, F, front, front + d * 2.4, STONE_LIGHT);
    for (const s of [-1, 1]) box(cx + s * 2.2 - 0.1, cx + s * 2.2 + 0.1, F, F + 1, front, front + d * 2.4, STONE_LIGHT);
    // House banners down the outside of the tower, either side of the arch.
    for (const s of [-1, 1]) props.push({ kind: "banner", pos: [cx + s * 3.1, F - 0.6, front + d * 0.15], yaw: d > 0 ? 0 : Math.PI, size: [1.6, 5], color: H.color, name: H.emblem });
    labels.push({ pos: [cx, ROOM_TOP + 1.4, front + d * 2.5], title: H.name, subtitle: H.motto, color: H.color });

    // ---- The common room ----
    const yawIn = d > 0 ? Math.PI : 0; // facing the back wall (the fire)
    const yawOut = d > 0 ? 0 : Math.PI; // facing the arch
    box(cx - 3, cx + 3, F, F + 0.03, zIn(-2.6), zIn(2), H.color); // rug
    // The fireplace on the back wall, with the crest over it.
    const fb = back + d * WALL; // the back wall's inside face
    box(cx - 1.9, cx - 1.2, F, ROOM_TOP, fb, fb + d * 0.8, STONE);
    box(cx + 1.2, cx + 1.9, F, ROOM_TOP, fb, fb + d * 0.8, STONE);
    box(cx - 1.2, cx + 1.2, F + 1.8, ROOM_TOP, fb, fb + d * 0.8, STONE);
    box(cx - 1.2, cx + 1.2, F, F + 1.8, fb, fb + d * 0.3, "#1d1822");
    box(cx - 2.1, cx + 2.1, F + 1.8, F + 2.05, fb, fb + d * 1.1, WOOD_DARK);
    props.push({ kind: "fire", pos: [cx, F, fb + d * 0.6], light: true });
    for (const s of [-1.6, 1.6]) props.push({ kind: "candle", pos: [cx + s, F + 2.05, fb + d * 0.9], scale: 1.2 });
    props.push({ kind: "painting", pos: [cx, F + 3.7, fb + d * 0.88], yaw: yawOut, size: [1.9, 2.3], name: `crest|${H.name}`, color: H.color });
    // Banners on the side walls.
    for (const s of [-1, 1]) {
      props.push({ kind: "banner", pos: [cx + s * (h - WALL - 0.05), F + 5.6, cz], yaw: s > 0 ? -Math.PI / 2 : Math.PI / 2, size: [1.5, 3.6], color: H.color, name: H.emblem });
      props.push({ kind: "sconce", pos: [cx + s * (h - WALL - 0.3), F + 2.6, zIn(-2.2)], yaw: s > 0 ? -Math.PI / 2 : Math.PI / 2, light: false });
    }
    // Armchairs facing the fire, and a low table.
    for (const s of [-1, 1]) {
      const ax = cx + s * 1.5;
      const az = zIn(-0.6);
      const yaw = yawIn - s * d * 0.35;
      const off = (dx: number, dz: number): [number, number] => [ax + dx * Math.cos(yaw) + dz * Math.sin(yaw), az - dx * Math.sin(yaw) + dz * Math.cos(yaw)];
      boxes.push({ pos: [ax, F + 0.25, az], size: [1.1, 0.5, 1], color: H.color, rot: [0, yaw, 0] });
      const [bx, bz] = off(0, -0.42);
      boxes.push({ pos: [bx, F + 0.75, bz], size: [1.1, 1, 0.22], color: H.color, rot: [0, yaw, 0] });
      for (const t of [-1, 1]) {
        const [rx, rz] = off(t * 0.5, 0);
        boxes.push({ pos: [rx, F + 0.6, rz], size: [0.18, 0.4, 1], color: H.color, rot: [0, yaw, 0] });
      }
    }
    box(cx - 0.6, cx + 0.6, F, F + 0.45, zIn(-1.9) - 0.4, zIn(-1.9) + 0.4, WOOD_DARK);
    // The house roll on its lectern: E to join.
    const lx = cx - Math.sign(cx) * 2.9;
    box(lx - 0.35, lx + 0.35, F, F + 1.1, zIn(1.2) - 0.3, zIn(1.2) + 0.3, WOOD_DARK);
    boxes.push({ pos: [lx, F + 1.18, zIn(1.2)], size: [0.7, 0.06, 0.5], color: "#efe6cf" });
    stations.push({ id: `house:${house}`, kind: "house", pos: [lx + Math.sign(cx) * 0.9, F, zIn(1.2)], label: `${H.name} house roll`, house });
    props.push({ kind: "chandelier", pos: [cx, ROOM_TOP, cz], size: [1.3, 1.6], light: false });
    props.push({ kind: "window", pos: [cx + Math.sign(cx) * (h - WALL - 0.02), F + 3.4, zIn(-2.8)], yaw: cx > 0 ? -Math.PI / 2 : Math.PI / 2, size: [1.4, 2.4] });

    // ---- Up and down on foot: a pad by the door below, and one inside ----
    box(cx - 1.2, cx + 1.2, 0, 3.2, front, front + d * 0.15, "#241c3a"); // the door
    box(cx - 1.5, cx + 1.5, 3.2, 3.5, front, front + d * 0.25, H.color);
    const down: Vec3 = [cx, 0.05, front + d * 1.6];
    const up: Vec3 = [cx + Math.sign(cx) * 2.6, F + 0.05, zIn(2.6)];
    // (A teleporter's yaw is the way you face: forward is (-sin yaw, -cos yaw).)
    teleporters.push({ pos: down, to: [cx, F + 1, zIn(0.9)], yaw: d > 0 ? 0 : Math.PI, color: H.color });
    teleporters.push({ pos: up, to: [cx, 1, front + d * 4], yaw: d > 0 ? Math.PI : 0, color: H.color });
    labels.push({ pos: [cx, 4.6, front + d * 1.6], title: `${H.name} Tower`, subtitle: "Step on the pad, or fly in on a broom (B)", color: H.color });
  }
  return { stations, labels, teleporters };
}
