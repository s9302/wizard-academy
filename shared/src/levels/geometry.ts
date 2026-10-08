// Straight-line tests against level boxes and players, shared by the server
// (spell hits, bots' line of sight) and the client (where a spell's glow
// stops at a wall). Plain math, not a physics engine: a spell flies in a
// straight line, so all we need is "where does this line segment first touch
// something?".

import { CROUCH_DROP, PLAYER_HALF_HEIGHT, PLAYER_RADIUS } from "../constants.ts";
import type { Vec3 } from "../protocol.ts";
import type { Box } from "./types.ts";

// Undo a box's rotation (three.js euler order XYZ: R = Rx * Ry * Rz, so the
// inverse applies Rx^-1, then Ry^-1, then Rz^-1).
function unrotate(v: Vec3, rot: Vec3): Vec3 {
  let [x, y, z] = v;
  const [rx, ry, rz] = rot;
  [y, z] = [y * Math.cos(rx) + z * Math.sin(rx), -y * Math.sin(rx) + z * Math.cos(rx)];
  [x, z] = [x * Math.cos(ry) - z * Math.sin(ry), x * Math.sin(ry) + z * Math.cos(ry)];
  [x, y] = [x * Math.cos(rz) + y * Math.sin(rz), -x * Math.sin(rz) + y * Math.cos(rz)];
  return [x, y, z];
}

// Where along the segment from -> to (0..1) it first enters the box, grown by
// `pad` meters on every side; null if it misses. The "slab" method: clip the
// segment against each pair of parallel faces in turn.
export function segmentHitsBox(from: Vec3, to: Vec3, box: Box, pad = 0): number | null {
  const rel = (p: Vec3): Vec3 => [p[0] - box.pos[0], p[1] - box.pos[1], p[2] - box.pos[2]];
  const a = box.rot ? unrotate(rel(from), box.rot) : rel(from);
  const b = box.rot ? unrotate(rel(to), box.rot) : rel(to);
  let t0 = 0;
  let t1 = 1;
  for (let k = 0; k < 3; k++) {
    const half = box.size[k] / 2 + pad;
    const d = b[k] - a[k];
    if (Math.abs(d) < 1e-9) {
      if (Math.abs(a[k]) > half) return null; // parallel and outside this slab
      continue;
    }
    let tNear = (-half - a[k]) / d;
    let tFar = (half - a[k]) / d;
    if (tNear > tFar) [tNear, tFar] = [tFar, tNear];
    t0 = Math.max(t0, tNear);
    t1 = Math.min(t1, tFar);
    if (t0 > t1) return null;
  }
  return t0;
}

// The first box the segment touches: fraction along it, or null.
export function segmentHitsLevel(from: Vec3, to: Vec3, boxes: Box[], pad = 0): number | null {
  let best: number | null = null;
  for (const box of boxes) {
    const t = segmentHitsBox(from, to, box, pad);
    if (t !== null && (best === null || t < best)) best = t;
  }
  return best;
}

// Can a straight line get from a to b without touching a box?
export function lineOfSight(a: Vec3, b: Vec3, boxes: Box[]): boolean {
  return segmentHitsLevel(a, b, boxes) === null;
}

// Does the segment from -> to pass within `radius` of a player standing at
// p (capsule center)? Returns the fraction along the segment of the closest
// approach if so, else null. The capsule is its core line (top to bottom
// sphere centers) grown by PLAYER_RADIUS. A crouching player is CROUCH_DROP
// shorter, from the top (p stays where the standing center would be).
export function segmentHitsPlayer(from: Vec3, to: Vec3, p: Vec3, radius: number, crouch = false): number | null {
  const top: Vec3 = [p[0], p[1] + PLAYER_HALF_HEIGHT - (crouch ? CROUCH_DROP : 0), p[2]];
  const bottom: Vec3 = [p[0], p[1] - PLAYER_HALF_HEIGHT, p[2]];
  const [s, dist] = closestBetweenSegments(from, to, bottom, top);
  return dist <= radius + PLAYER_RADIUS ? s : null;
}

// The same for any upright capsule: center c, `half` from center to each
// end sphere's center, `r` thick (monsters come in all sizes).
export function segmentHitsCapsule(from: Vec3, to: Vec3, c: Vec3, half: number, r: number, radius: number): number | null {
  const [s, dist] = closestBetweenSegments(from, to, [c[0], c[1] - half, c[2]], [c[0], c[1] + half, c[2]]);
  return dist <= radius + r ? s : null;
}

// Closest points between segments p1-q1 and p2-q2 (Ericson, "Real-Time
// Collision Detection" 5.1.9). Returns [s along the first, distance].
function closestBetweenSegments(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3): [number, number] {
  const d1 = sub(q1, p1);
  const d2 = sub(q2, p2);
  const r = sub(p1, p2);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  let s: number;
  let t: number;
  if (a < 1e-9 && e < 1e-9) {
    s = t = 0;
  } else if (a < 1e-9) {
    s = 0;
    t = clamp01(f / e);
  } else {
    const c = dot(d1, r);
    if (e < 1e-9) {
      t = 0;
      s = clamp01(-c / a);
    } else {
      const b = dot(d1, d2);
      const denom = a * e - b * b;
      s = denom > 1e-9 ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  const c1 = add(p1, scale(d1, s));
  const c2 = add(p2, scale(d2, t));
  return [s, Math.hypot(c1[0] - c2[0], c1[1] - c2[1], c1[2] - c2[2])];
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// The highest walkable surface at (x, z) no higher than `maxY` (a little
// above the point you're asking about), or null if there's nothing below.
// Handles ramps (rotated boxes) by intersecting with their top face.
export function floorBelow(x: number, z: number, maxY: number, boxes: Box[]): number | null {
  let best: number | null = null;
  for (const box of boxes) {
    const top = topOf(box, x, z);
    if (top !== null && top <= maxY + 0.05 && (best === null || top > best)) best = top;
  }
  return best;
}

// Where a spell aimed at a spot lands: the floor under `at` (what your
// crosshair is on), or, past `range` meters from `eye`, under the point that
// far along the same line. Pulled 0.3 m back toward you first, so a point on
// a wall's face lands at the foot of the wall, not on top of it. Shared, so
// the client's landing circle and the server agree.
export function groundTarget(eye: Vec3, at: Vec3, range: number, boxes: Box[]): Vec3 | null {
  const dist = Math.hypot(at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]);
  let p = dist > range ? lerp3(eye, at, range / dist) : at;
  const flat = Math.hypot(p[0] - eye[0], p[2] - eye[2]);
  if (flat > 0.6) p = [p[0] - ((p[0] - eye[0]) / flat) * 0.3, p[1], p[2] - ((p[2] - eye[2]) / flat) * 0.3];
  const floor = floorBelow(p[0], p[2], p[1] + 0.3, boxes);
  return floor === null ? null : [p[0], floor, p[2]];
}

// Height of a box's top surface at (x, z), or null if (x, z) isn't over it.
function topOf(box: Box, x: number, z: number): number | null {
  const [w, h, d] = box.size;
  if (!box.rot) {
    if (Math.abs(x - box.pos[0]) > w / 2 || Math.abs(z - box.pos[2]) > d / 2) return null;
    return box.pos[1] + h / 2;
  }
  // A rotated box: drop a vertical line through its top face.
  const top = segmentHitsBox([x, box.pos[1] + 50, z], [x, box.pos[1] - 50, z], box);
  return top === null ? null : box.pos[1] + 50 - top * 100;
}

// Does a box overlap a player standing at p (capsule center)?
export function boxTouchesPlayer(box: Box, p: Vec3): boolean {
  return segmentHitsBox([p[0], p[1] - PLAYER_HALF_HEIGHT, p[2]], [p[0], p[1] + PLAYER_HALF_HEIGHT, p[2]], box, PLAYER_RADIUS) !== null;
}
