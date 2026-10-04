// Small details that make the world look less like boxes: grass tufts on
// lawns and pebbles on sand. Decoration only (no colliders). Drawn as
// "instanced" meshes: thousands of copies of one shape in a single draw call,
// which is what keeps this cheap.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Box, Level } from "../../../shared/src/levels/types.ts";

const GRASS = new Set(["#6fae5c", "#4f7d45", "#6f8f4f"]);
const SAND = new Set(["#b9a27a"]);
const MAX_TUFTS = 7000;
const MAX_PEBBLES = 1500;

// The top of a flat, unrotated box, if it's big enough to decorate.
function topOf(box: Box): { x0: number; x1: number; z0: number; z1: number; y: number } | null {
  if (box.rot || box.gate) return null;
  const [w, h, d] = box.size;
  if (w * d < 20) return null;
  return { x0: box.pos[0] - w / 2, x1: box.pos[0] + w / 2, z0: box.pos[2] - d / 2, z1: box.pos[2] + d / 2, y: box.pos[1] + h / 2 };
}

// Is (x, z) at height y covered by some other box (a wall, a path...)?
function covered(boxes: Box[], self: Box, x: number, y: number, z: number): boolean {
  for (const b of boxes) {
    if (b === self || b.gate) continue;
    const r = b.rot ? Math.hypot(b.size[0], b.size[2]) / 2 : 0;
    const hw = b.rot ? r : b.size[0] / 2;
    const hd = b.rot ? r : b.size[2] / 2;
    if (Math.abs(x - b.pos[0]) > hw + 0.2 || Math.abs(z - b.pos[2]) > hd + 0.2) continue;
    if (b.pos[1] + b.size[1] / 2 > y + 0.01 && b.pos[1] - b.size[1] / 2 < y + 1) return true;
  }
  return false;
}

export function addDecor(scene: THREE.Scene, level: Level): void {
  let seed = 1234;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const tufts: THREE.Matrix4[] = [];
  const tuftColors: THREE.Color[] = [];
  const pebbles: THREE.Matrix4[] = [];
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);

  for (const box of level.boxes) {
    const top = topOf(box);
    if (!top) continue;
    const area = (top.x1 - top.x0) * (top.z1 - top.z0);
    const grass = GRASS.has(box.color.toLowerCase());
    const sand = SAND.has(box.color.toLowerCase());
    if (!grass && !sand) continue;
    const tries = Math.round(area * (grass ? 0.9 : 0.15));
    for (let i = 0; i < tries; i++) {
      const x = top.x0 + rand() * (top.x1 - top.x0);
      const z = top.z0 + rand() * (top.z1 - top.z0);
      if (covered(level.boxes, box, x, top.y, z)) continue;
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      if (grass && tufts.length < MAX_TUFTS) {
        const s = 0.6 + rand() * 0.8;
        tufts.push(new THREE.Matrix4().compose(new THREE.Vector3(x, top.y + 0.12 * s, z), q, new THREE.Vector3(s, s, s)));
        tuftColors.push(new THREE.Color(box.color).offsetHSL(rand() * 0.04 - 0.02, 0.05, rand() * 0.12 - 0.02));
      } else if (sand && pebbles.length < MAX_PEBBLES) {
        const s = 0.08 + rand() * 0.18;
        pebbles.push(new THREE.Matrix4().compose(new THREE.Vector3(x, top.y + s * 0.3, z), q, new THREE.Vector3(s, s * 0.6, s)));
      }
    }
  }

  if (tufts.length) {
    // Three thin blades leaning out a little.
    const blade = new THREE.ConeGeometry(0.05, 0.3, 3);
    const parts = [0, 1, 2].map((k) => blade.clone().rotateZ(0.3).rotateY((k * Math.PI * 2) / 3).translate(Math.cos(k * 2.1) * 0.05, 0, Math.sin(k * 2.1) * 0.05));
    const geometry = mergeGeometries(parts);
    const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshLambertMaterial({ flatShading: true }), tufts.length);
    tufts.forEach((t, i) => {
      mesh.setMatrixAt(i, t);
      mesh.setColorAt(i, tuftColors[i]);
    });
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  if (pebbles.length) {
    const mesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: "#8e8170", flatShading: true }), pebbles.length);
    pebbles.forEach((p, i) => mesh.setMatrixAt(i, p));
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
}
