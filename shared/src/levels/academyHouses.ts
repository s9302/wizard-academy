// The four house towers on the academy's corners, each with its house's
// common room at the top, on two floors: the common room itself (fly in
// through the arch onto the balcony), and up a staircase inside, the
// dormitory. On foot, a glowing pad takes you up: at the foot of the two
// front towers, and for the two back towers, under an archway on the front
// lawn (so nobody has to walk round the back of the academy).
//
// academy.ts calls houseTowers() with its boxes and props.

import { HOUSES, type HouseId } from "../houses.ts";
import type { Vec3 } from "../protocol.ts";
import type { Box, Label, Prop, Station, Teleporter } from "./types.ts";

export const TOWER_FLOOR = 15; // the common room's floor (above the academy's roof)
export const TOWER_UPPER = 20; // the dormitory's floor
const ROOM_TOP = 25.5; // the dormitory's ceiling
const WIDE = 11; // the tower, outside: across (x)...
const DEEP = 12; // ...and front to back (z)
const WALL = 0.5;
const INNER_EDGE = 29.5; // |x| of the tower's side against the academy
const DOOR_W = 3.4; // the broom arch
const DOOR_H = 3.8;

const STONE = "#57536f";
const STONE_LIGHT = "#a5a2bb";
const FLOOR = "#8d8aa6";
const WOOD = "#7a5236";
const WOOD_DARK = "#4e3322";
const ROOF = "#3b2a6b";
const WINDOW = "#f2d98a";
const LINEN = "#efe6cf";
const BOOKS = ["#7a3b9e", "#2f6fa8", "#a8483b", "#3b8c5a", "#c9a227", "#5b3a2a"];

// Each tower's middle, and which way its arch faces (+1: south, toward the
// plaza; -1: north, over the back of the grounds). `pad`: where its pad on
// the ground is, if not at its own foot.
export const HOUSE_TOWERS: { house: HouseId; x: number; z: number; face: 1 | -1; pad?: Vec3 }[] = [
  { house: "liondor", x: -35, z: -31, face: 1 },
  { house: "ravenhand", x: 35, z: -31, face: 1 },
  { house: "snakerins", x: -35, z: -72, face: -1, pad: [-23.5, 0.05, -23] },
  { house: "simpletonpuff", x: 35, z: -72, face: -1, pad: [23.5, 0.05, -23] },
];

export function houseTowers(boxes: Box[], props: Prop[]): { stations: Station[]; labels: Label[]; teleporters: Teleporter[] } {
  const stations: Station[] = [];
  const labels: Label[] = [];
  const teleporters: Teleporter[] = [];
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: string, extra: Partial<Box> = {}) =>
    boxes.push({ pos: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], size: [Math.abs(x1 - x0), y1 - y0, Math.abs(z1 - z0)], color, ...extra });

  for (const { house, x: cx, z: cz, face: d, pad } of HOUSE_TOWERS) {
    const H = HOUSES[house];
    const sx = Math.sign(cx); // outward, away from the academy
    const F1 = TOWER_FLOOR;
    const F2 = TOWER_UPPER;
    const xi = sx * INNER_EDGE; // the tower's side against the academy
    const xo = sx * (INNER_EDGE + WIDE); // its outer side
    const zf = cz + d * (DEEP / 2); // the arch's wall (outside face)
    const zb = cz - d * (DEEP / 2);
    // Inside, in the room's own terms: u across from the academy side (0)
    // to the outer wall (10), w from the arch wall (0) to the back (11).
    const X = (u: number) => sx * (INNER_EDGE + WALL + u);
    const Z = (w: number) => zf - d * (WALL + w);
    const U = WIDE - 2 * WALL;
    const W = DEEP - 2 * WALL;
    const lbox = (u0: number, u1: number, y0: number, y1: number, w0: number, w1: number, color: string, extra: Partial<Box> = {}) =>
      box(X(u0), X(u1), y0, y1, Z(w0), Z(w1), color, extra);
    // Prop yaws (a prop faces (sin yaw, cos yaw)): toward the back, the
    // front, the outer wall, the academy side.
    const toBack = d > 0 ? Math.PI : 0;
    const toFront = d > 0 ? 0 : Math.PI;
    const toOuter = (sx * Math.PI) / 2;
    const toInner = (-sx * Math.PI) / 2;
    // A rotated piece of furniture: yaw is the way its front faces.
    const at = (u: number, w: number): [number, number] => [X(u), Z(w)];
    const piece = (u: number, y: number, w: number, size: Vec3, color: string, yaw: number) => {
      const [x, z] = at(u, w);
      boxes.push({ pos: [x, y, z], size, color, rot: [0, yaw, 0] });
    };

    // ---- The tower ----
    box(xi, xo, 0, F1, zf, zb, STONE); // solid stone up to the rooms
    box(xi, xo, F1, ROOM_TOP, zb, zb + d * WALL, STONE); // back wall
    box(xi, xi + sx * WALL, F1, ROOM_TOP, zf, zb, STONE); // academy side
    box(xo - sx * WALL, xo, F1, ROOM_TOP, zf, zb, STONE); // outer side
    for (const s of [-1, 1]) box(cx + s * (DOOR_W / 2), s > 0 ? Math.max(xi, xo) : Math.min(xi, xo), F1, ROOM_TOP, zf - d * WALL, zf, STONE);
    box(cx - DOOR_W / 2, cx + DOOR_W / 2, F1 + DOOR_H, ROOM_TOP, zf - d * WALL, zf, STONE);
    box(xi, xo, F1 - 0.2, F1, zf, zb, FLOOR); // the common room's floor
    box(xi, xo, ROOM_TOP, ROOM_TOP + 0.5, zf, zb, STONE); // the roof
    // Lit windows on the outside: the stone below, both rooms above.
    for (const y of [5, 10, F1 + 2.5, F2 + 2.5]) {
      box(xo - sx * 0.05, xo + sx * 0.1, y - 1.1, y + 1.1, cz - 0.8, cz + 0.8, WINDOW, { glow: 2.2 });
      if (y > F1 + 3) for (const s of [-1, 1]) box(cx + s * 3.2 - 0.6, cx + s * 3.2 + 0.6, y - 1, y + 1, zf - d * 0.05, zf + d * 0.1, WINDOW, { glow: 2.2 });
    }
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      boxes.push({ pos: [cx + Math.cos(a) * 5.2, ROOM_TOP + 0.9, cz + Math.sin(a) * 5.6], size: [1, 0.8, 1], color: STONE, rot: [0, -a, 0] });
    }
    props.push({ kind: "cone", pos: [cx, ROOM_TOP + 0.5, cz], size: [7, 13], color: ROOF });
    // The arch's frame in house colors, and the balcony to land on.
    for (const s of [-1, 1]) box(cx + s * (DOOR_W / 2 + 0.15) - 0.15, cx + s * (DOOR_W / 2 + 0.15) + 0.15, F1, F1 + DOOR_H, zf - d * 0.1, zf + d * 0.2, H.color);
    box(cx - DOOR_W / 2 - 0.3, cx + DOOR_W / 2 + 0.3, F1 + DOOR_H, F1 + DOOR_H + 0.35, zf - d * 0.1, zf + d * 0.2, H.trim);
    box(cx - 2.4, cx + 2.4, F1 - 0.3, F1, zf, zf + d * 2.6, STONE_LIGHT);
    for (const s of [-1, 1]) box(cx + s * 2.4 - 0.1, cx + s * 2.4 + 0.1, F1, F1 + 1, zf, zf + d * 2.6, STONE_LIGHT);
    for (const s of [-1, 1]) props.push({ kind: "banner", pos: [cx + s * 3.6, F1 - 0.6, zf + d * 0.15], yaw: toFront, size: [1.8, 6], color: H.color, name: H.emblem });
    labels.push({ pos: [cx, ROOM_TOP + 1.6, zf + d * 2.6], title: H.name, subtitle: H.motto, color: H.color });

    // ---- The common room (lower floor) ----
    lbox(1.2, 7, F1, F1 + 0.03, 6.2, 10.4, H.color); // rug by the fire
    // The fireplace on the back wall, the crest over it.
    lbox(2.6, 3.3, F1, F2 - 0.4, 10.2, W, STONE);
    lbox(4.7, 5.4, F1, F2 - 0.4, 10.2, W, STONE);
    lbox(3.3, 4.7, F1 + 1.8, F2 - 0.4, 10.2, W, STONE);
    lbox(3.3, 4.7, F1, F1 + 1.8, 10.7, W, "#1d1822");
    lbox(2.4, 5.6, F1 + 1.8, F1 + 2.05, 9.9, W, WOOD_DARK);
    const [fx, fz] = at(4, 10.5);
    props.push({ kind: "fire", pos: [fx, F1, fz], light: true });
    for (const u of [2.8, 5.2]) {
      const [x, z] = at(u, 10.1);
      props.push({ kind: "candle", pos: [x, F1 + 2.05, z], scale: 1.2 });
    }
    {
      const [x, z] = at(4, 10.12);
      props.push({ kind: "painting", pos: [x, F1 + 3.3, z], yaw: toFront, size: [1.6, 1.9], name: `crest|${H.name}`, color: H.color });
    }
    // A sofa facing the fire, armchairs either side, a low table.
    piece(4, F1 + 0.25, 7.3, [3, 0.5, 0.9], H.color, toBack);
    piece(4, F1 + 0.75, 6.9, [3, 1, 0.2], H.color, toBack);
    for (const [u, yaw] of [[1.6, toOuter], [6.6, toInner]] as const) {
      piece(u, F1 + 0.25, 9, [1, 0.5, 1], H.color, yaw);
      const [x, z] = at(u - Math.sin(yaw) * sx * 0.42, 9);
      boxes.push({ pos: [x, F1 + 0.75, z], size: [0.22, 1, 1], color: H.color });
    }
    lbox(3.3, 4.7, F1, F1 + 0.45, 8.2, 9, WOOD_DARK);
    // Bookshelves on the academy-side wall.
    lbox(0, 0.5, F1, F1 + 3.4, 5.8, 10, WOOD);
    for (let r = 0; r < 4; r++) for (let i = 0; i < 7; i++) lbox(0.5, 0.6, F1 + 0.3 + r * 0.8, F1 + 0.85 + r * 0.8, 6 + i * 0.57, 6.5 + i * 0.57, BOOKS[(i + r * 3 + (house.length % 3)) % BOOKS.length]);
    // A study table with chairs, candles and open books, by the front.
    lbox(1, 3.8, F1 + 0.75, F1 + 0.85, 2.8, 4.2, WOOD_DARK);
    for (const [u, w] of [[1.2, 3], [3.6, 3], [1.2, 4], [3.6, 4]]) lbox(u - 0.06, u + 0.06, F1, F1 + 0.75, w - 0.06, w + 0.06, WOOD_DARK);
    for (const u of [1.5, 3.2]) {
      piece(u, F1 + 0.25, 2.2, [0.5, 0.5, 0.5], WOOD, toBack);
      piece(u, F1 + 0.25, 4.8, [0.5, 0.5, 0.5], WOOD, toFront);
    }
    {
      const [x, z] = at(2.4, 3.5);
      props.push({ kind: "candle", pos: [x, F1 + 0.85, z], scale: 1 });
      const [bx, bz] = at(1.7, 3.4);
      boxes.push({ pos: [bx, F1 + 0.87, bz], size: [0.5, 0.03, 0.35], color: LINEN, rot: [0, 0.3, 0] });
    }
    // A notice board by the arch, banners, plants, a chandelier.
    {
      const [x, z] = at(1.6, 0.06);
      props.push({ kind: "painting", pos: [x, F1 + 2.1, z], yaw: toBack, size: [2, 1.3], name: `notices|${H.name}`, color: H.color });
      const [bx, bz] = at(0.06, 3.5);
      props.push({ kind: "banner", pos: [bx, F2 - 0.6, bz], yaw: toOuter, size: [1.4, 3.4], color: H.color, name: H.emblem });
      for (const [u, w] of [[0.6, 0.6], [7.4, 10.4]]) {
        const [px, pz] = at(u, w);
        props.push({ kind: "bush", pos: [px, F1, pz], scale: 0.55 });
      }
      const [cx2, cz2] = at(4.2, 6);
      props.push({ kind: "chandelier", pos: [cx2, F2 - 0.4, cz2], size: [1.3, 1.1], light: false });
      for (const w of [5.2, 10.6]) {
        const [sx2, sz2] = at(0.08, w);
        props.push({ kind: "sconce", pos: [sx2, F1 + 2.4, sz2], yaw: toOuter, light: false });
      }
    }
    // The house roll on its lectern: E to join.
    lbox(6.5, 7.2, F1, F1 + 1.1, 4.3, 4.9, WOOD_DARK);
    lbox(6.45, 7.25, F1 + 1.1, F1 + 1.16, 4.25, 4.95, LINEN);
    {
      const [x, z] = at(5.8, 4.6);
      stations.push({ id: `house:${house}`, kind: "house", pos: [x, F1, z], label: `${H.name} house roll`, house });
    }

    // ---- The staircase, along the outer wall, up to the dormitory ----
    const STEPS = 18;
    const S0 = 1; // w where the first step starts
    const S1 = 8.6; // ...and where the top one ends
    const run = (S1 - S0) / STEPS;
    const rise = (F2 - F1) / STEPS;
    const UST = U - 1.8; // the stairs are u from here to the outer wall
    for (let i = 0; i < STEPS; i++) lbox(UST, U, F1, F1 + rise * (i + 1), S0 + i * run, S1, STONE_LIGHT);
    // A banister on the open side, and a rail round the hole upstairs.
    for (let i = 0; i <= 6; i++) {
      const w = S0 + ((S1 - S0) * i) / 6;
      const y = F1 + ((w - S0) / (S1 - S0)) * (F2 - F1);
      lbox(UST - 0.06, UST + 0.06, y, y + 1, w - 0.06, w + 0.06, WOOD_DARK);
    }
    {
      const len = Math.hypot(S1 - S0, F2 - F1);
      const slope = Math.atan2(F2 - F1, S1 - S0);
      const [x, z] = at(UST, (S0 + S1) / 2);
      boxes.push({ pos: [x, (F1 + F2) / 2 + 1, z], size: [0.12, 0.12, len], color: WOOD_DARK, rot: [d * slope, 0, 0] });
    }

    // ---- The dormitory (upper floor) ----
    // Its floor, leaving the stairwell open (u past UST, w up to S1).
    lbox(0, UST, F2 - 0.4, F2, 0, W, FLOOR);
    lbox(UST, U, F2 - 0.4, F2, S1, W, FLOOR);
    for (let i = 0; i <= 8; i++) lbox(UST - 0.2, UST - 0.08, F2, F2 + 1, (S1 * i) / 8 - 0.06, (S1 * i) / 8 + 0.06, WOOD_DARK);
    lbox(UST - 0.22, UST - 0.06, F2 + 0.94, F2 + 1.06, 0, S1, WOOD_DARK);
    lbox(1.5, 6.8, F2, F2 + 0.03, 2.5, 7.5, H.color); // rug
    // Four-poster beds: four along the academy-side wall, two on the back wall.
    const bed = (u0: number, u1: number, w0: number, w1: number) => {
      lbox(u0, u1, F2, F2 + 0.45, w0, w1, WOOD_DARK); // frame
      lbox(u0 + 0.05, u1 - 0.05, F2 + 0.45, F2 + 0.65, w0 + 0.05, w1 - 0.05, LINEN); // mattress
      for (const [u, w] of [[u0, w0], [u0, w1], [u1, w0], [u1, w1]]) lbox(u - 0.06, u + 0.06, F2, F2 + 2.4, w - 0.06, w + 0.06, WOOD_DARK); // posts
      lbox(u0, u1, F2 + 2.35, F2 + 2.45, w0, w1, H.color); // canopy
    };
    for (const w of [0.4, 2.5, 4.6, 6.7]) {
      bed(0.05, 2.25, w, w + 1.4);
      lbox(0.45, 2.25, F2 + 0.66, F2 + 0.72, w + 0.08, w + 1.32, H.color); // blanket
      lbox(0.1, 0.5, F2 + 0.66, F2 + 0.82, w + 0.25, w + 1.15, LINEN); // pillow
      lbox(2.35, 2.95, F2, F2 + 0.5, w + 0.2, w + 1.2, WOOD); // trunk at its foot
    }
    for (const u of [2.8, 5.3]) {
      bed(u, u + 1.4, W - 2.2, W - 0.05);
      lbox(u + 0.08, u + 1.32, F2 + 0.66, F2 + 0.72, W - 2.2, W - 0.45, H.color);
      lbox(u + 0.25, u + 1.15, F2 + 0.66, F2 + 0.82, W - 0.5, W - 0.1, LINEN);
    }
    // A wardrobe and a desk by the front wall, windows, a banner.
    lbox(4.2, 5.8, F2, F2 + 2.4, 0, 0.6, WOOD);
    lbox(5, 5.04, F2 + 0.3, F2 + 2.1, 0.6, 0.62, WOOD_DARK);
    lbox(6.2, 7.6, F2 + 0.75, F2 + 0.82, 0.1, 0.9, WOOD_DARK);
    for (const [u, w] of [[6.3, 0.2], [7.5, 0.2], [6.3, 0.8], [7.5, 0.8]]) lbox(u - 0.05, u + 0.05, F2, F2 + 0.75, w - 0.05, w + 0.05, WOOD_DARK);
    piece(6.9, F2 + 0.25, 1.4, [0.5, 0.5, 0.5], WOOD, toFront);
    {
      const [x, z] = at(6.6, 0.5);
      props.push({ kind: "candle", pos: [x, F2 + 0.82, z], scale: 1 });
      for (const u of [1.6, 3.2]) {
        const [wx, wz] = at(u, 0.02);
        props.push({ kind: "window", pos: [wx, F2 + 2.6, wz], yaw: toBack, size: [1.2, 2] });
      }
      const [ox, oz] = at(U - 0.02, 9.8);
      props.push({ kind: "window", pos: [ox, F2 + 2.6, oz], yaw: toInner, size: [1.6, 1.6] });
      const [bx, bz] = at(4, W - 0.06);
      props.push({ kind: "banner", pos: [bx, ROOM_TOP - 0.4, bz], yaw: toFront, size: [1.4, 2.4], color: H.color, name: H.emblem });
      const [cx3, cz3] = at(4.5, 5);
      props.push({ kind: "chandelier", pos: [cx3, ROOM_TOP, cz3], size: [1.1, 1.4], light: false });
      const [lx, lz] = at(4.5, 5);
      labels.push({ pos: [lx, F2 + 4.2, lz], title: `${H.name} Dormitory`, color: H.color });
    }

    // ---- Up and down on foot ----
    const ground: Vec3 = pad ?? [cx, 0.05, zf + d * 1.6];
    const up = at(1.2, 1.4); // inside, by the arch (the academy side)
    // (A teleporter's yaw is the way you face: forward is (-sin yaw, -cos yaw).)
    const faceBack = d > 0 ? 0 : Math.PI;
    teleporters.push({ pos: ground, to: [cx, F1 + 1, Z(2.2)], yaw: faceBack, color: H.color });
    const outside: Vec3 = pad ? [pad[0], 1, pad[2] + 3] : [cx, 1, zf + d * 4];
    teleporters.push({ pos: [up[0], F1 + 0.05, up[1]], to: outside, yaw: Math.PI, color: H.color });
    if (pad) {
      // An archway in house colors around the pad on the front lawn.
      for (const s of [-1, 1]) box(pad[0] + s * 1.7 - 0.3, pad[0] + s * 1.7 + 0.3, 0, 4, pad[2] - 0.3, pad[2] + 0.3, STONE);
      box(pad[0] - 2.1, pad[0] + 2.1, 4, 4.6, pad[2] - 0.35, pad[2] + 0.35, H.color);
      props.push({ kind: "banner", pos: [pad[0], 4, pad[2] + 0.4], yaw: 0, size: [1.2, 1.8], color: H.color, name: H.emblem });
      labels.push({ pos: [pad[0], 5.8, pad[2]], title: `To ${H.name} Tower`, subtitle: "Step on the pad, or fly round the back on a broom (B)", color: H.color });
    } else {
      box(cx - 1.2, cx + 1.2, 0, 3.2, zf, zf + d * 0.15, "#241c3a"); // the door
      box(cx - 1.5, cx + 1.5, 3.2, 3.5, zf, zf + d * 0.25, H.color);
      labels.push({ pos: [cx, 4.6, zf + d * 1.6], title: `${H.name} Tower`, subtitle: "Step on the pad, or fly in on a broom (B)", color: H.color });
    }
  }
  return { stations, labels, teleporters };
}
