// The academy's upper floor (Spencer's 2026-10-06 request): a grand staircase
// up from either side of the great doors, and over the Hall of Trials an open
// atrium with a gallery round it: the Common Room on the west side, the
// Potions Classroom on the east, and a bridge over the Sanctum's doors. Over
// the Sanctum, the Portrait Gallery (armor and paintings) leads to the
// Library, the Hall of Champions (the leaderboards) and the Headmaster's
// Office. None of it is gated: it's somewhere to explore and hang out.
//
// Everything is level data like the rest of the hub; academy.ts calls
// upperFloor() with its own boxes and props.

import type { Vec3 } from "../protocol.ts";
import type { Box, Label, PointLightDef, Prop, Station } from "./types.ts";

export const UPPER = 7.6; // the upper floor's walking height
const SLAB = 0.4;
const CEIL = 14; // underside of the academy's roof

const WALL = "#6c6889";
const STONE = "#8d8aa6";
const STONE_DARK = "#57536f";
const STONE_LIGHT = "#a5a2bb";
const WOOD = "#7a5236";
const WOOD_DARK = "#4e3322";
const GOLD = "#e8c547";
const SILVER = "#c9ccd8";
const BRONZE = "#b0723a";
const CARPET = "#8c2a3c";
const IRON = "#2e2b38";
const BOOKS = ["#7a3b9e", "#2f6fa8", "#a8483b", "#3b8c5a", "#c9a227", "#5b3a2a", "#2a5b5b"];

export type AcademyFrame = {
  front: number; // z of the facade (its inside face is 0.6 further in)
  mid: number; // z of the wall between the Hall of Trials and the Sanctum
  back: number; // z of the back wall
  inner: number; // inside face of the side walls (x = +-inner)
};

export function upperFloor(boxes: Box[], props: Prop[], f: AcademyFrame): { stations: Station[]; labels: Label[]; lights: PointLightDef[] } {
  const { front, mid, back, inner } = f;
  const F = UPPER;
  const zFront = front - 0.6; // inside face of the facade
  const zMidN = mid + 0.3; // the inner wall's hall-side face
  const zMidS = mid - 0.3; // ...and its Sanctum-side face
  const zBack = back + 0.6; // inside face of the back wall
  const HEAD = CEIL - F; // room height upstairs
  const stations: Station[] = [];
  const labels: Label[] = [];
  const lights: PointLightDef[] = [];

  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: string, extra: Partial<Box> = {}) =>
    boxes.push({ pos: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], size: [Math.abs(x1 - x0), y1 - y0, Math.abs(z1 - z0)], color, ...extra });
  const floor = (x0: number, x1: number, z0: number, z1: number) => box(x0, x1, F - SLAB, F, z0, z1, STONE);
  // A rail along a floor edge: posts and a handrail, 1 m high.
  const rail = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const yaw = Math.atan2(x1 - x0, z1 - z0);
    boxes.push({ pos: [(x0 + x1) / 2, F + 1, (z0 + z1) / 2], size: [0.16, 0.12, len], color: WOOD_DARK, rot: [0, yaw, 0] });
    boxes.push({ pos: [(x0 + x1) / 2, F + 0.1, (z0 + z1) / 2], size: [0.2, 0.2, len], color: STONE_DARK, rot: [0, yaw, 0] });
    const n = Math.max(1, Math.round(len / 1.2));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      boxes.push({ pos: [x0 + (x1 - x0) * t, F + 0.5, z0 + (z1 - z0) * t], size: [0.12, 0.9, 0.12], color: STONE_LIGHT });
    }
  };
  // A bookcase against a wall, books on its shelves. Runs along x (facing
  // +z or -z) or along z (facing +x or -x); `face` is the side the books are on.
  let bookSeed = 7;
  const bookRand = () => ((bookSeed = (bookSeed * 16807) % 2147483647) / 2147483647);
  const bookcase = (cx: number, cz: number, len: number, along: "x" | "z", face: 1 | -1, h = 4.4, depth = 0.6, shelf = true, y0 = F) => {
    const rows = Math.floor((h - 0.3) / 0.75);
    if (!shelf) {
      // (the other side of a double-sided stack: its books only)
    } else if (along === "x") box(cx - len / 2, cx + len / 2, y0, y0 + h, cz - depth / 2, cz + depth / 2, WOOD);
    else box(cx - depth / 2, cx + depth / 2, y0, y0 + h, cz - len / 2, cz + len / 2, WOOD);
    for (let r = 0; r < rows; r++) {
      let t = -len / 2 + 0.15;
      while (t < len / 2 - 0.35) {
        const w = Math.min(0.3 + bookRand() * 0.5, len / 2 - 0.15 - t);
        const bh = 0.45 + bookRand() * 0.2;
        const y = y0 + 0.3 + r * 0.75 + bh / 2;
        const color = BOOKS[Math.floor(bookRand() * BOOKS.length)];
        const out = face * (depth / 2 + 0.04);
        if (along === "x") boxes.push({ pos: [cx + t + w / 2, y, cz + out], size: [w - 0.04, bh, 0.1], color });
        else boxes.push({ pos: [cx + out, y, cz + t + w / 2], size: [0.1, bh, w - 0.04], color });
        t += w;
      }
    }
  };
  // A chair (seat, back, legs as one block), facing yaw (its front).
  const chair = (x: number, z: number, yaw: number, color = WOOD, high = false) => {
    const back: Vec3 = [x - Math.sin(yaw) * 0.25, F + (high ? 1.15 : 0.8), z - Math.cos(yaw) * 0.25];
    boxes.push({ pos: [x, F + 0.25, z], size: [0.55, 0.5, 0.55], color, rot: [0, yaw, 0] });
    boxes.push({ pos: back, size: [0.55, high ? 1.3 : 0.6, 0.1], color, rot: [0, yaw, 0] });
  };
  // A padded armchair.
  const armchair = (x: number, z: number, yaw: number, color: string) => {
    const r: Vec3 = [0, yaw, 0];
    const off = (dx: number, dz: number): [number, number] => [x + dx * Math.cos(yaw) + dz * Math.sin(yaw), z - dx * Math.sin(yaw) + dz * Math.cos(yaw)];
    boxes.push({ pos: [x, F + 0.25, z], size: [1.1, 0.5, 1], color, rot: r });
    const [bx, bz] = off(0, -0.42);
    boxes.push({ pos: [bx, F + 0.75, bz], size: [1.1, 1, 0.22], color, rot: r });
    for (const s of [-1, 1]) {
      const [ax, az] = off(s * 0.5, 0);
      boxes.push({ pos: [ax, F + 0.6, az], size: [0.18, 0.4, 1], color, rot: r });
    }
  };
  const table = (x: number, z: number, w: number, d: number, h = 0.85, color = WOOD) => {
    box(x - w / 2, x + w / 2, F + h - 0.1, F + h, z - d / 2, z + d / 2, color);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(x + sx * (w / 2 - 0.15) - 0.06, x + sx * (w / 2 - 0.15) + 0.06, F, F + h - 0.1, z + sz * (d / 2 - 0.15) - 0.06, z + sz * (d / 2 - 0.15) + 0.06, color);
  };
  // A fireplace in a wall: hearth, a dark firebox, a mantel and a chimney
  // breast up to the roof. `face` is the direction into the room (+-x).
  const fireplace = (wallX: number, z: number, face: 1 | -1) => {
    const x = (d: number) => wallX + face * d;
    box(Math.min(x(0), x(0.9)), Math.max(x(0), x(0.9)), F, CEIL, z - 1.9, z - 1.2, STONE_DARK);
    box(Math.min(x(0), x(0.9)), Math.max(x(0), x(0.9)), F, CEIL, z + 1.2, z + 1.9, STONE_DARK);
    box(Math.min(x(0), x(0.9)), Math.max(x(0), x(0.9)), F + 1.8, CEIL, z - 1.2, z + 1.2, STONE_DARK);
    box(Math.min(x(0), x(0.3)), Math.max(x(0), x(0.3)), F, F + 1.8, z - 1.2, z + 1.2, "#1d1822");
    box(Math.min(x(0), x(1.2)), Math.max(x(0), x(1.2)), F + 1.8, F + 2.05, z - 2.1, z + 2.1, WOOD_DARK); // mantel
    box(Math.min(x(0.9), x(1.9)), Math.max(x(0.9), x(1.9)), F, F + 0.12, z - 2, z + 2, STONE_LIGHT); // hearth
    props.push({ kind: "fire", pos: [x(0.6), F, z], light: true });
    for (const s of [-1.6, 1.6]) props.push({ kind: "candle", pos: [x(0.8), F + 2.05, z + s], scale: 1.2 });
  };
  const sconce = (x: number, y: number, z: number, yaw: number) => props.push({ kind: "sconce", pos: [x, y, z], yaw, light: false });
  const painting = (x: number, y: number, z: number, yaw: number, w: number, h: number, subject: string, color?: string) =>
    props.push({ kind: "painting", pos: [x, y, z], yaw, size: [w, h], name: subject, color });
  // A suit of armor on a plinth (solid), facing yaw.
  const armor = (x: number, z: number, yaw: number, plume: string) => {
    box(x - 0.5, x + 0.5, F, F + 0.3, z - 0.5, z + 0.5, STONE_DARK);
    boxes.push({ pos: [x, F + 1.5, z], size: [0.7, 2.4, 0.6], color: STONE_DARK, invisible: true });
    props.push({ kind: "armor", pos: [x, F + 0.3, z], yaw, color: plume });
  };
  // A doorway's stone frame (on both faces of a wall along x at z).
  const doorFrame = (x: number, z: number, w: number, h = 3.4) => {
    for (const s of [-1, 1]) box(x + s * (w / 2 + 0.15) - 0.15, x + s * (w / 2 + 0.15) + 0.15, F, F + h, z - 0.45, z + 0.45, STONE_LIGHT);
    box(x - w / 2 - 0.3, x + w / 2 + 0.3, F + h, F + h + 0.4, z - 0.45, z + 0.45, STONE_LIGHT);
  };

  // ---- The grand staircase ----
  // Two flights up from either side of the great doors, along the facade,
  // to landings at the gallery's front corners. Solid steps (nothing to fall
  // through), each 28 cm: the player's autostep takes up to 35.
  const STEPS = 27;
  const X0 = 5.2; // the first step, either side of the doors (clear of the open door leaves)
  const X1 = 15.8; // the top of the flight
  const run = (X1 - X0) / STEPS;
  const rise = F / STEPS;
  const sz0 = zFront - 3.2; // the flight's inner edge (it runs along the facade)
  for (const s of [-1, 1]) {
    for (let i = 0; i < STEPS; i++) {
      const top = rise * (i + 1);
      const a = s * (X0 + i * run);
      const b = s * X1; // each step runs on to the top, so it's solid underneath
      box(Math.min(a, b), Math.max(a, b), 0, top, sz0, zFront, STONE);
    }
    // A carpet runner laid over the steps' edges, from the first step to
    // the top one (it's solid, so going up feels like a smooth ramp).
    const nx0 = X0;
    const nx1 = X1 - run;
    const slope = Math.atan2(F - rise, nx1 - nx0);
    const len = Math.hypot(F - rise, nx1 - nx0);
    const cx = s * (nx0 + nx1) / 2;
    const cy = (rise + F) / 2 + 0.01;
    boxes.push({ pos: [cx, cy, (sz0 + zFront) / 2], size: [len, 0.02, 1.6], color: CARPET, rot: [0, 0, s * slope] });
    // The banister on the open side, with balusters, and a newel post.
    boxes.push({ pos: [cx, cy + 1, sz0 + 0.1], size: [len, 0.14, 0.14], color: WOOD_DARK, rot: [0, 0, s * slope] });
    for (let i = 0; i <= 9; i++) {
      const xx = nx0 + ((nx1 - nx0) * i) / 9;
      const y = rise + ((xx - nx0) / (nx1 - nx0)) * (F - rise);
      box(s * xx - 0.05, s * xx + 0.05, y - rise, y + 1, sz0 + 0.05, sz0 + 0.15, STONE_LIGHT);
    }
    box(s * X0 - 0.2, s * X0 + 0.2, 0, 1.4, sz0 - 0.1, sz0 + 0.3, STONE_DARK);
    props.push({ kind: "candle", pos: [s * X0, 1.4, sz0 + 0.1], scale: 1.6 });
  }

  // ---- The gallery over the Hall of Trials ----
  const WING = 11; // the atrium (open to the roof) is |x| < WING
  const BRIDGE = mid + 2.8; // the bridge over the Sanctum's doors: z from here to the inner wall
  for (const s of [-1, 1]) {
    const lo = (a: number, b: number) => Math.min(s * a, s * b);
    const hi = (a: number, b: number) => Math.max(s * a, s * b);
    floor(lo(WING, inner), hi(WING, inner), zMidN, sz0); // the wing
    floor(lo(X1, inner), hi(X1, inner), sz0, zFront); // the landing at the top of the stairs
    rail(s * WING, sz0, s * X1, sz0); // beside the top of the flight
    rail(s * WING, sz0, s * WING, BRIDGE); // the atrium's edge
  }
  floor(-WING, WING, zMidN, BRIDGE);
  rail(-WING, BRIDGE, WING, BRIDGE);
  // Chandeliers over the atrium, and the gallery's light.
  for (const z of [front - 8, front - 15]) props.push({ kind: "chandelier", pos: [0, CEIL, z], size: [2.2, 1.8], light: true });
  // Banners hanging down into the atrium from the bridge.
  for (const [x, color] of [[-6, "#4a2a9e"], [-2.2, "#1f4f8f"], [2.2, "#7a1f4a"], [6, "#4a2a9e"]] as const) {
    props.push({ kind: "banner", pos: [x, F - 0.5, BRIDGE + 0.15], yaw: 0, size: [1.4, 3.6], color });
  }

  // ---- The Common Room (west wing) ----
  const CR = { x: -(WING + inner) / 2, z: (sz0 + zMidN) / 2 };
  fireplace(-inner, CR.z, 1);
  painting(-inner + 0.98, F + 3.6, CR.z, Math.PI / 2, 2.2, 1.7, "landscape|The Academy in Spring");
  box(-inner + 2.5, -inner + 8.5, F, F + 0.03, CR.z - 3.5, CR.z + 3.5, "#6a2a4a"); // rug
  armchair(-inner + 4, CR.z - 2.4, -1.03, "#7a1f3a"); // facing the fire
  armchair(-inner + 4, CR.z + 2.4, -2.11, "#1f3a7a");
  // A sofa facing the fire, and a low table.
  box(-inner + 7.4, -inner + 8.3, F, F + 0.5, CR.z - 2, CR.z + 2, "#3a5a2a");
  box(-inner + 8.1, -inner + 8.5, F, F + 1.2, CR.z - 2, CR.z + 2, "#3a5a2a");
  table(-inner + 5.6, CR.z, 1.6, 1, 0.5, WOOD_DARK);
  props.push({ kind: "candle", pos: [-inner + 5.6, F + 0.5, CR.z], scale: 1 });
  // A chess table by the railing.
  const CH = { x: -WING - 3.2, z: front - 17 };
  table(CH.x, CH.z, 1.6, 1.6, 0.8, WOOD_DARK);
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
    const x = CH.x - 0.6 + i * 0.15 + 0.075;
    const z = CH.z - 0.6 + j * 0.15 + 0.075;
    boxes.push({ pos: [x, F + 0.81, z], size: [0.15, 0.02, 0.15], color: (i + j) % 2 ? "#e8e0d0" : "#2a2230" });
  }
  for (const [dx, dz, c] of [[-0.45, -0.52, "#e8e0d0"], [0.15, -0.52, "#e8e0d0"], [0.3, 0.4, "#2a2230"], [-0.15, 0.52, "#2a2230"], [0.45, 0.52, "#2a2230"]] as const) {
    boxes.push({ pos: [CH.x + dx, F + 0.92, CH.z + dz], size: [0.07, 0.2, 0.07], color: c });
  }
  chair(CH.x, CH.z - 1.2, 0);
  chair(CH.x, CH.z + 1.2, Math.PI);
  // Bookshelves on the inner wall, banners and a portrait.
  bookcase(-inner + 5, zMidN + 0.3, 6, "x", 1, 3.6, 0.6);
  for (const [z, color] of [[front - 7.2, "#7a1f4a"], [front - 19.5, "#1f4f8f"]] as const) {
    props.push({ kind: "banner", pos: [-inner + 0.15, F + 5.4, z], yaw: Math.PI / 2, size: [1.4, 3.6], color });
  }
  for (const [x, z] of [[-inner + 1, sz0 - 1], [-WING - 1, zMidN + 1.2]]) props.push({ kind: "bush", pos: [x, F, z], scale: 0.6, color: "#4f8a45" });
  labels.push({ pos: [CR.x, F + 4.2, CR.z], title: "The Common Room", color: "#ff9a6a" });
  lights.push({ pos: [CR.x, F + 4, CR.z], color: "#ffc890", intensity: 30, distance: 18 });
  props.push({ kind: "student", pos: [-WING - 4, F, CR.z + 3], scale: 2 });

  // ---- The Potions Classroom (east wing) ----
  const PC = { x: (WING + inner) / 2, z: (sz0 + zMidN) / 2 };
  // A blackboard on the outer wall, and the teacher's desk in front of it.
  box(inner - 0.1, inner, F + 1.2, F + 4.2, PC.z - 3.5, PC.z + 3.5, WOOD_DARK);
  painting(inner - 0.12, F + 2.7, PC.z, -Math.PI / 2, 6.6, 2.8, "blackboard");
  table(inner - 3, PC.z, 1.2, 3, 0.9, WOOD_DARK);
  props.push({ kind: "cauldron", pos: [inner - 3, F + 0.9, PC.z + 0.9], scale: 0.6, color: "#c45aff" });
  props.push({ kind: "candle", pos: [inner - 3, F + 0.9, PC.z - 1], scale: 1 });
  // Six benches, each with a bubbling cauldron.
  const brews = ["#7dff5a", "#ff5a8b", "#5ad1ff", "#ffd25a", "#ff8a3a", "#b48cff"];
  let n = 0;
  for (const x of [PC.x - 3.2, PC.x + 0.6]) {
    for (const z of [PC.z - 5, PC.z, PC.z + 5]) {
      table(x, z, 1.6, 2.2, 0.8, WOOD);
      props.push({ kind: "cauldron", pos: [x, F + 0.8, z], scale: 0.55, color: brews[n++ % brews.length] });
      chair(x - 1.2, z, Math.PI / 2); // facing the blackboard
    }
  }
  // Ingredient shelves on the inner wall, either side of the gallery door.
  for (const cx of [14.6, 25.4]) {
    box(cx - 2.6, cx + 2.6, F, F + 3.6, zMidN, zMidN + 0.5, WOOD_DARK);
    for (let r = 0; r < 4; r++) {
      for (let i = 0; i < 9; i++) {
        const hue = brews[(i * 3 + r) % brews.length];
        boxes.push({ pos: [cx - 2.3 + i * 0.57, F + 0.55 + r * 0.85, zMidN + 0.62], size: [0.26, 0.38, 0.22], color: hue, glow: i % 3 === 0 ? 1.4 : undefined });
      }
    }
  }
  labels.push({ pos: [PC.x, F + 4.2, PC.z], title: "Potions Classroom", color: "#7dff5a" });
  lights.push({ pos: [PC.x, F + 4, PC.z], color: "#c8ffb0", intensity: 26, distance: 18 });
  props.push({ kind: "npc", talk: "vex", pos: [inner - 4.4, F, PC.z - 2.2], yaw: -Math.PI / 2 });

  // ---- The upper floor over the Sanctum ----
  floor(-inner, inner, zBack, zMidS);
  const CORR = zMidS - 5; // the Portrait Gallery is between the inner wall and here
  const ROOMS = CORR - 0.4; // rooms start behind the gallery's back wall
  const doors: [number, number][] = [[-18, 3], [0, 4], [19, 3]]; // library, champions, office
  // The gallery's back wall, with three doorways.
  {
    let x = -inner;
    for (const [dx, w] of [...doors, [inner + 1, 0] as [number, number]]) {
      const end = Math.min(inner, dx - w / 2);
      if (end > x) box(x, end, F, CEIL, ROOMS, CORR, WALL);
      if (w) box(dx - w / 2, dx + w / 2, F + 3.4, CEIL, ROOMS, CORR, WALL);
      x = dx + w / 2;
    }
    for (const [dx, w] of doors) doorFrame(dx, (ROOMS + CORR) / 2, w);
  }
  // Walls between the three rooms.
  for (const x of [-8, 8]) box(x - 0.2, x + 0.2, F, CEIL, zBack, ROOMS, WALL);
  // The inner wall's doorways need frames on the gallery side too.
  for (const x of [-20, 0, 20]) doorFrame(x, mid, 3);

  // ---- The Portrait Gallery ----
  box(-inner + 1, inner - 1, F, F + 0.03, CORR + 1.6, zMidS - 1.6, CARPET);
  const portraits: [number, string][] = [
    [-25.4, "portrait|Orrin Vale|#4a2a9e"],
    [-14, "dragon|The Wyrm of the Long Winter"],
    [-7.6, "portrait|Seraphine Ashdown|#1f6f5a"],
    [7.6, "seascape|The Drowned Coast"],
    [14, "portrait|Aldous Thorne|#7a1f3a"],
    [25.4, "night|The Academy by Night"],
  ];
  for (const [x, subject] of portraits) {
    const [kind, title, color] = subject.split("|");
    painting(x, F + 3.2, zMidS - 0.08, Math.PI, kind === "portrait" ? 1.9 : 3, kind === "portrait" ? 2.5 : 2, `${kind}|${title}`, color);
  }
  // Suits of armor along the back wall, facing the paintings, and smaller
  // paintings above them.
  const plumes = ["#c8323c", "#3a62c8", "#e8c547", "#3a9e5a"];
  [-27, -23, -13.5, -10, -4.5, 4.5, 10, 14, 24, 27.5].forEach((x, i) => armor(x, CORR + 0.7, 0, plumes[i % plumes.length]));
  for (const [x, subject] of [[-25, "landscape|The Spell Garden"], [-11.8, "castle|The First Academy"], [12, "stars|The Long Night"], [25.8, "landscape|The Northern Peaks"]] as const) {
    painting(x, F + 4.6, CORR + 0.08, 0, 2.6, 1.7, subject);
  }
  for (const x of [-22, -9, 9, 22]) sconce(x, F + 2.6, zMidS - 0.35, Math.PI);
  for (const s of [-1, 1]) props.push({ kind: "window", pos: [s * (inner - 0.04), F + 3.4, (CORR + zMidS) / 2], yaw: -s * Math.PI / 2, size: [1.8, 3] });
  labels.push(
    { pos: [-18, F + 4.4, CORR + 0.6], title: "The Library", color: "#8fb8ff" },
    { pos: [0, F + 4.4, CORR + 0.6], title: "Hall of Champions", subtitle: "The leaderboards", color: GOLD },
    { pos: [19, F + 4.4, CORR + 0.6], title: "The Headmaster's Office", color: "#ff8fb8" },
  );
  lights.push({ pos: [0, F + 4.5, (CORR + zMidS) / 2], color: "#ffd7a0", intensity: 30, distance: 32 });

  // ---- The Library (west) ----
  const LIB = { x0: -inner, x1: -8.2, z0: zBack, z1: ROOMS };
  // Tall bookcases round the walls (the back wall, the outer wall, and the
  // gallery wall either side of the door).
  for (const cx of [-26, -20.5]) bookcase(cx, LIB.z0 + 0.3, 5.2, "x", 1, 5.2);
  for (const cz of [-61, -66.3]) bookcase(LIB.x0 + 0.3, cz, 5, "z", 1, 5.2);
  bookcase(-24.5, LIB.z1 - 0.3, 8, "x", -1, 4.4);
  bookcase(-11.5, LIB.z1 - 0.3, 6, "x", -1, 4.4);
  // Two freestanding double-sided stacks.
  for (const x of [-24, -20.5]) {
    bookcase(x, -64.5, 5, "z", 1, 3.6, 0.8);
    bookcase(x, -64.5, 5, "z", -1, 3.6, 0.8, false);
  }
  // The reading tables, with candles and open books.
  for (const z of [-61.5, -67.5]) {
    table(-13.2, z, 4.2, 1.5, 0.85, WOOD_DARK);
    for (const s of [-1, 1]) for (const dx of [-1.3, 0, 1.3]) chair(-13.2 + dx, z + s * 1.15, s > 0 ? Math.PI : 0);
    props.push({ kind: "candle", pos: [-14.4, F + 0.85, z], scale: 1 });
    props.push({ kind: "candle", pos: [-12, F + 0.85, z], scale: 1 });
    boxes.push({ pos: [-13.2, F + 0.87, z + 0.3], size: [0.7, 0.04, 0.45], color: "#efe6cf", rot: [0, 0.3, 0] });
  }
  // The Restricted Section: an iron grille across the back corner.
  const RS = { x: -15.4, z: LIB.z0 + 3.4 };
  for (let x = RS.x - 2; x <= -8.6; x += 0.35) box(x - 0.04, x + 0.04, F, F + 4, RS.z - 0.04, RS.z + 0.04, IRON);
  box(RS.x - 2, -8.4, F + 3.9, F + 4.1, RS.z - 0.1, RS.z + 0.1, IRON);
  box(RS.x - 2.1, RS.x - 1.9, F, F + 4.1, LIB.z0 + 0.6, RS.z, IRON);
  box(RS.x - 1.8, -8.6, F, F + 5.2, LIB.z0, LIB.z0 + 0.6, WOOD_DARK); // its shelves: glowing books
  for (let x = RS.x - 1.6; x < -8.8; x += 0.9) boxes.push({ pos: [x, F + 1.2 + (Math.abs(x * 7) % 3) * 0.75, LIB.z0 + 0.66], size: [0.5, 0.5, 0.08], color: "#9a5aff", glow: 1.8 });
  box(-11.4, -10.6, F, F + 1.1, RS.z + 1.1, RS.z + 1.9, WOOD_DARK); // a lectern outside it, a book chained to it
  boxes.push({ pos: [-11, F + 1.2, RS.z + 1.5], size: [0.6, 0.1, 0.45], color: "#5a1f7a", glow: 1.6, rot: [-0.3, 0, 0] });
  labels.push({ pos: [-12, F + 5, RS.z], title: "Restricted Section", subtitle: "Absolutely no students", color: "#c58fff" });
  props.push({ kind: "globe", pos: [-10.2, F, -58.8] });
  props.push({ kind: "chandelier", pos: [-18.6, CEIL, -64.5], size: [1.8, 1.8], light: false });
  props.push({ kind: "npc", talk: "inkwell", pos: [-16.5, F, -58.8], yaw: 0.4 });
  props.push({ kind: "student", pos: [-13.2, F, -64.5], scale: 1.5 });
  stations.push({ id: "library", kind: "tablet", pos: [-11, F, RS.z + 2.6], label: "A chained book", tablet: "library" });
  lights.push({ pos: [-18.6, F + 4.6, -64.5], color: "#ffd7a0", intensity: 30, distance: 18 });

  // ---- The Hall of Champions (middle) ----
  const HC = { z0: zBack, z1: ROOMS };
  box(-1.3, 1.3, F, F + 0.03, HC.z0 + 2, HC.z1, CARPET);
  // The leaderboards: the most XP on the back wall, the trial records on the
  // side walls (drawn from /api/halloffame by the client).
  props.push({ kind: "board", pos: [0, F + 3.6, HC.z0 + 0.08], yaw: 0, size: [6, 4.2], name: "xp" });
  props.push({ kind: "board", pos: [-7.75, F + 3.4, -65.5], yaw: Math.PI / 2, size: [7, 4.4], name: "trials:1-5" });
  props.push({ kind: "board", pos: [7.75, F + 3.4, -65.5], yaw: -Math.PI / 2, size: [7, 4.4], name: "trials:6-9" });
  // A podium for the top three.
  const POD = HC.z0 + 5.4;
  for (const [x, h, color] of [[0, 0.9, GOLD], [-1.7, 0.6, SILVER], [1.7, 0.4, BRONZE]] as const) {
    box(x - 0.8, x + 0.8, F, F + h, POD - 0.8, POD + 0.8, color);
  }
  // Trophies on pedestals down both sides.
  for (const s of [-1, 1]) {
    for (const z of [-59, -63, -70]) {
      const x = s * 5.6;
      box(x - 0.45, x + 0.45, F, F + 1.1, z - 0.45, z + 0.45, STONE_LIGHT);
      box(x - 0.18, x + 0.18, F + 1.1, F + 1.2, z - 0.18, z + 0.18, GOLD);
      box(x - 0.05, x + 0.05, F + 1.2, F + 1.45, z - 0.05, z + 0.05, GOLD);
      boxes.push({ pos: [x, F + 1.7, z], size: [0.42, 0.5, 0.42], color: z === -63 ? SILVER : GOLD, glow: 1.2 });
    }
  }
  for (const x of [-4, 4]) props.push({ kind: "banner", pos: [x, CEIL - 0.6, HC.z0 + 0.25], yaw: 0, size: [1.6, 4.4], color: "#7a5a12" });
  props.push({ kind: "chandelier", pos: [0, CEIL, -65], size: [1.6, 1.6], light: false });
  stations.push({ id: "champions", kind: "leaderboard", pos: [0, F, HC.z0 + 2.4], label: "Hall of Champions" });
  lights.push({ pos: [0, F + 4.8, -65], color: "#ffe2a8", intensity: 30, distance: 16 });

  // ---- The Headmaster's Office (east) ----
  const OF = { x0: 8.2, x1: inner, z0: zBack, z1: ROOMS };
  const DESK = { x: 19, z: -70.2 };
  box(OF.x0 + 3, OF.x1 - 3, F, F + 0.03, -73, -60, "#5a1f3a"); // rug
  // The desk: a big one, papers, an inkwell and a quill, and his chair.
  box(DESK.x - 2, DESK.x + 2, F, F + 1, DESK.z - 0.8, DESK.z + 0.8, WOOD_DARK);
  box(DESK.x - 2.1, DESK.x + 2.1, F + 1, F + 1.08, DESK.z - 0.9, DESK.z + 0.9, WOOD);
  boxes.push({ pos: [DESK.x - 0.6, F + 1.1, DESK.z + 0.1], size: [0.6, 0.02, 0.45], color: "#f4efe6", rot: [0, 0.2, 0] });
  boxes.push({ pos: [DESK.x - 0.2, F + 1.11, DESK.z - 0.1], size: [0.6, 0.02, 0.45], color: "#ebe2cc", rot: [0, -0.15, 0] });
  box(DESK.x + 1.1, DESK.x + 1.3, F + 1.08, F + 1.25, DESK.z - 0.1, DESK.z + 0.1, "#1d1822");
  boxes.push({ pos: [DESK.x + 1.25, F + 1.45, DESK.z], size: [0.03, 0.5, 0.08], color: "#f4efe6", rot: [0, 0, 0.35] });
  props.push({ kind: "candle", pos: [DESK.x - 1.6, F + 1.08, DESK.z - 0.4], scale: 1.2 });
  chair(DESK.x, DESK.z - 1.4, 0, CARPET, true);
  for (const s of [-1.3, 1.3]) chair(DESK.x + s, DESK.z + 2.2, Math.PI, "#3a2a5a");
  stations.push({ id: "office", kind: "tablet", pos: [DESK.x, F, DESK.z + 1.6], label: "Vale's journal", tablet: "office" });
  // The fireplace, with Vale's portrait over it.
  fireplace(inner, -64.5, -1);
  painting(inner - 0.98, F + 3.8, -64.5, -Math.PI / 2, 1.9, 2.4, "portrait|Orrin Vale|#4a2a9e");
  armchair(inner - 4, -62, 2.1, "#4a2a6a"); // facing the fire
  // Bookcases on the back wall; past headmasters on the west wall (the first
  // one's face has been scratched out).
  for (const cx of [11.6, 26.2]) bookcase(cx, OF.z0 + 0.3, 5, "x", 1, 5);
  for (const [z, subject, color] of [[-60, "portrait|Aldous Thorne", "#7a1f3a"], [-65.5, "portrait|Seraphine Ashdown", "#1f6f5a"], [-71, "portrait|The First Headmaster", "#3a1f4a"]] as const) {
    painting(OF.x0 + 0.08, F + 3, z, Math.PI / 2, 1.8, 2.3, subject, color);
  }
  // A brass orrery, the scrying basin, and a phoenix on its perch.
  table(12.4, -60.5, 1.4, 1.4, 0.9, WOOD_DARK);
  props.push({ kind: "orrery", pos: [12.4, F + 0.9, -60.5] });
  box(24.5 - 0.6, 24.5 + 0.6, F, F + 0.8, -59.2 - 0.6, -59.2 + 0.6, STONE_DARK);
  box(24.5 - 0.75, 24.5 + 0.75, F + 0.8, F + 1, -59.2 - 0.75, -59.2 + 0.75, STONE_LIGHT);
  boxes.push({ pos: [24.5, F + 1.02, -59.2], size: [1.2, 0.04, 1.2], color: "#9ad8ff", glow: 1.8 });
  props.push({ kind: "phoenix", pos: [14.2, F, -71.5], yaw: 0.6 });
  props.push({ kind: "window", pos: [inner - 0.04, F + 3.4, -58.4], yaw: -Math.PI / 2, size: [1.6, 1.6] });
  lights.push({ pos: [19, F + 4.6, -65], color: "#ffd0a0", intensity: 30, distance: 18 });

  return { stations, labels, lights };
}
