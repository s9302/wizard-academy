// Turns level data (shared/src/levels) into three.js meshes and matching
// Rapier colliders. Every piece is a box with a flat color, except magic
// barriers (gates), which are see-through and left out entirely once the
// player has the unlock that opens them.

import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Box, Level } from "../../../shared/src/levels/types.ts";
import { requirementText, UNLOCKS } from "../../../shared/src/unlocks.ts";
import { Sign } from "./Sign.ts";
import { addSurfaceAttributes, withSurfaceDetail } from "../graphics/surface.ts";
import { quality } from "../quality.ts";

// A stable pseudo-random number for a box (so colors don't change between visits).
function hash(box: Box): number {
  const v = Math.sin(box.pos[0] * 12.9898 + box.pos[1] * 78.233 + box.pos[2] * 37.719) * 43758.5453;
  return v - Math.floor(v);
}

// Cheap shading per box: a touch darker toward the bottom (like the shadow
// where things meet the ground) and a slight random tint, so big walls of the
// same color don't look flat. The box's color is baked into its vertex
// colors, and the box is moved into place, so that every solid box in the
// level can be merged into ONE mesh (see buildLevel).
function shadedBox(box: Box, matrix: THREE.Matrix4, detail: boolean): THREE.BufferGeometry {
  const [w, h, d] = box.size;
  const geometry = new THREE.BoxGeometry(w, h, d);
  if (detail) addSurfaceAttributes(geometry, box);
  const base = new THREE.Color(box.color).multiplyScalar(0.95 + hash(box) * 0.1);
  const pos = geometry.getAttribute("position");
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const k = pos.getY(i) > 0 ? 1 : h > 0.6 ? 0.74 : 0.9;
    colors.set([base.r * k, base.g * k, base.b * k], i * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.applyMatrix4(matrix);
  return geometry;
}

// Where a box sits and how it's turned.
function boxMatrix(box: Box): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(box.rot ?? [0, 0, 0])));
  return new THREE.Matrix4().compose(new THREE.Vector3(...box.pos), q, new THREE.Vector3(1, 1, 1));
}

function addCollider(world: RAPIER.World, box: Box): void {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(box.rot ?? [0, 0, 0])));
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(box.size[0] / 2, box.size[1] / 2, box.size[2] / 2)
      .setTranslation(...box.pos)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
  );
}

// A magic barrier: see-through, its own mesh.
function addBarrier(scene: THREE.Object3D, box: Box): void {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(...box.size),
    new THREE.MeshBasicMaterial({ color: box.color, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }),
  );
  mesh.applyMatrix4(boxMatrix(box));
  scene.add(mesh);
}

const MARKER_IDLE = new THREE.Color("#b48cff");
const MARKER_REACHED = new THREE.Color("#7dffb0");

// Floating crystals over each checkpoint. Decoration only (no colliders):
// they light up when the server says you reached that checkpoint.
export class CheckpointMarkers {
  private crystals: THREE.Mesh<THREE.OctahedronGeometry, THREE.MeshLambertMaterial>[] = [];
  private baseY: number[] = [];

  constructor(scene: THREE.Object3D, level: Level) {
    for (const checkpoint of level.course?.checkpoints ?? []) {
      const crystal = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.45),
        new THREE.MeshLambertMaterial({ color: MARKER_IDLE, emissive: MARKER_IDLE, emissiveIntensity: 0.35, flatShading: true }),
      );
      crystal.position.set(...checkpoint.marker);
      crystal.scale.y = 1.6;
      crystal.castShadow = true;
      scene.add(crystal);
      this.crystals.push(crystal);
      this.baseY.push(crystal.position.y);
    }
  }

  // Light up the first `reached` crystals.
  setReached(reached: number): void {
    this.crystals.forEach((crystal, i) => {
      const color = i < reached ? MARKER_REACHED : MARKER_IDLE;
      crystal.material.color.copy(color);
      crystal.material.emissive.copy(color);
    });
  }

  // Slow spin and bob, so they read as magical things rather than geometry.
  update(time: number): void {
    this.crystals.forEach((crystal, i) => {
      crystal.rotation.y = time * 0.8 + i;
      crystal.position.y = this.baseY[i] + Math.sin(time * 2 + i) * 0.12;
    });
  }
}

// unlocked: what this player has opened (barriers they've earned are left out).
export function buildLevel(scene: THREE.Object3D, world: RAPIER.World, level: Level, unlocked = new Set<string>()): CheckpointMarkers {
  // Game-dev note: drawing each box separately costs one "draw call" each
  // (twice, with shadows), and a level has hundreds. Merged into one mesh,
  // the whole level is a single draw call.
  //
  // Glowing boxes (windows, crystals, lava) are a second merged mesh, drawn
  // unlit and extra bright. On High and Ultra, solid boxes get surface
  // detail (bricks, planks, grass; see graphics/surface.ts).
  const q = quality();
  const detail = q !== "low";
  const solid: THREE.BufferGeometry[] = [];
  const glowing: THREE.BufferGeometry[] = [];
  for (const box of level.boxes) {
    if (box.gate && unlocked.has(box.gate)) continue; // opened: not there at all
    addCollider(world, box);
    if (box.invisible) continue;
    if (box.gate) addBarrier(scene, box);
    else if (box.glow) {
      const g = new THREE.BoxGeometry(...box.size);
      g.deleteAttribute("uv");
      const c = new THREE.Color(box.color).multiplyScalar(q === "ultra" ? box.glow : 1);
      const colors = new Float32Array(g.getAttribute("position").count * 3);
      for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i);
      g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      g.applyMatrix4(boxMatrix(box));
      glowing.push(g);
    } else solid.push(shadedBox(box, boxMatrix(box), detail));
  }
  if (solid.length) {
    const material =
      q === "ultra"
        ? withSurfaceDetail(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.88, metalness: 0 }), true)
        : q === "high"
          ? withSurfaceDetail(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), true)
          : new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const mesh = new THREE.Mesh(mergeGeometries(solid), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    for (const g of solid) g.dispose();
  }
  if (glowing.length) {
    const mesh = new THREE.Mesh(mergeGeometries(glowing), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
    mesh.castShadow = true;
    scene.add(mesh);
    for (const g of glowing) g.dispose();
  }
  for (const label of level.labels ?? []) {
    const locked = label.unlock && !unlocked.has(label.unlock);
    if (label.onlyLocked && !locked) continue;
    const requires = UNLOCKS.find((u) => u.id === label.unlock)?.requires;
    const sign = new Sign({
      title: label.title,
      subtitle: locked && requires ? requirementText(requires) : label.subtitle,
      color: locked ? "#9a93b0" : label.color,
    }, 4.2);
    sign.sprite.position.set(...label.pos);
    scene.add(sign.sprite);
  }
  for (const l of level.lights ?? []) {
    const light = new THREE.PointLight(l.color, l.intensity, l.distance);
    light.position.set(...l.pos);
    scene.add(light);
  }
  return new CheckpointMarkers(scene, level);
}
