// Turns level data (shared/src/levels) into three.js meshes and matching
// Rapier colliders. Every piece is a box with a flat color, except magic
// barriers (gates), which are see-through and left out entirely once the
// player has the unlock that opens them.

import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import type { Box, Level } from "../../../shared/src/levels/types.ts";
import { requirementText, UNLOCKS } from "../../../shared/src/unlocks.ts";
import { Sign } from "./Sign.ts";

function addBox(scene: THREE.Scene, world: RAPIER.World, box: Box): void {
  const [w, h, d] = box.size;
  const material = box.gate
    ? new THREE.MeshBasicMaterial({ color: box.color, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide })
    : new THREE.MeshLambertMaterial({ color: box.color, flatShading: true });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  if (box.gate) mesh.userData.barrier = true;
  mesh.position.set(...box.pos);
  if (box.rot) mesh.rotation.set(...box.rot);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  const q = mesh.quaternion;
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2)
      .setTranslation(...box.pos)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
  );
}

const MARKER_IDLE = new THREE.Color("#b48cff");
const MARKER_REACHED = new THREE.Color("#7dffb0");

// Floating crystals over each checkpoint. Decoration only (no colliders):
// they light up when the server says you reached that checkpoint.
export class CheckpointMarkers {
  private crystals: THREE.Mesh<THREE.OctahedronGeometry, THREE.MeshLambertMaterial>[] = [];
  private baseY: number[] = [];

  constructor(scene: THREE.Scene, level: Level) {
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
export function buildLevel(scene: THREE.Scene, world: RAPIER.World, level: Level, unlocked = new Set<string>()): CheckpointMarkers {
  for (const box of level.boxes) {
    if (!box.gate || !unlocked.has(box.gate)) addBox(scene, world, box);
  }
  for (const label of level.labels ?? []) {
    const locked = label.unlock && !unlocked.has(label.unlock);
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
