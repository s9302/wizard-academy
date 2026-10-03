// Straight-line tests against level boxes and players, shared by the server
// (spell hits, bots' line of sight) and the client (where a spell's glow
// stops at a wall). Plain math, not a physics engine: a spell flies in a
// straight line, so all we need is "where does this line segment first touch
// something?".

import { PLAYER_HALF_HEIGHT, PLAYER_RADIUS } from "../constants.ts";
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
// sphere centers) grown by PLAYER_RADIUS.
export function segmentHitsPlayer(from: Vec3, to: Vec3, p: Vec3, radius: number): number | null {
  const top: Vec3 = [p[0], p[1] + PLAYER_HALF_HEIGHT, p[2]];
  const bottom: Vec3 = [p[0], p[1] - PLAYER_HALF_HEIGHT, p[2]];
  const [s, dist] = closestBetweenSegments(from, to, bottom, top);
  return dist <= radius + PLAYER_RADIUS ? s : null;
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
