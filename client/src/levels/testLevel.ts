// A small playground for trying out movement: open ground, a ramp, stairs,
// stepping-stone platforms at increasing heights, a tunnel to test head bumps,
// and a perimeter wall. Every piece is a box with a flat color, and each box
// gets a matching physics collider.

import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

type BoxSpec = {
  pos: [number, number, number]; // center
  size: [number, number, number]; // full width, height, depth
  color: THREE.ColorRepresentation;
  rot?: [number, number, number]; // euler angles in radians
};

function addBox(scene: THREE.Scene, world: RAPIER.World, spec: BoxSpec): void {
  const [w, h, d] = spec.size;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color: spec.color, flatShading: true }),
  );
  mesh.position.set(...spec.pos);
  if (spec.rot) mesh.rotation.set(...spec.rot);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  const q = mesh.quaternion;
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2)
      .setTranslation(...spec.pos)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
  );
}

const STONE = "#8d8aa6";
const STONE_DARK = "#6c6889";
const GRASS = "#6fae5c";
const WOOD = "#a8744f";
const GOLD = "#e8c547";

export function buildTestLevel(scene: THREE.Scene, world: RAPIER.World): void {
  // Ground: 80 x 80 m, top surface at y = 0.
  addBox(scene, world, { pos: [0, -0.5, 0], size: [80, 1, 80], color: GRASS });

  // Perimeter walls so nobody walks off the edge (yet).
  for (const [x, z, w, d] of [
    [0, -40, 80, 1],
    [0, 40, 80, 1],
    [-40, 0, 1, 80],
    [40, 0, 1, 80],
  ]) {
    addBox(scene, world, { pos: [x, 1.5, z], size: [w, 3, d], color: STONE_DARK });
  }

  // Ramp up to a platform (north).
  const rampAngle = 0.35; // ~20 degrees
  addBox(scene, world, { pos: [0, 1.35, -14], size: [4, 0.4, 8], color: STONE, rot: [rampAngle, 0, 0] });
  addBox(scene, world, { pos: [0, 1.4, -21], size: [8, 2.8, 6], color: STONE_DARK });

  // Stairs (east): 0.3 m steps, walkable thanks to the controller's autostep.
  for (let i = 0; i < 8; i++) {
    const h = 0.3 * (i + 1);
    addBox(scene, world, { pos: [10 + i * 0.6, h / 2, 0], size: [0.6, h, 3], color: WOOD });
  }
  addBox(scene, world, { pos: [17.5, 1.2, 0], size: [3, 2.4, 3], color: WOOD });

  // Stepping stones (west), each one higher: a first taste of parkour.
  const stones: [number, number, number][] = [
    [-8, 0.5, 4],
    [-11, 1.1, 6],
    [-14, 1.7, 4],
    [-17, 2.3, 6],
    [-20, 2.9, 4],
    [-23, 3.5, 6],
  ];
  stones.forEach(([x, y, z], i) => {
    addBox(scene, world, { pos: [x, y - 0.25, z], size: [2, 0.5, 2], color: i % 2 ? STONE : STONE_DARK });
  });
  addBox(scene, world, { pos: [-23, 4.25, 6], size: [0.6, 0.6, 0.6], color: GOLD, rot: [0.6, 0.6, 0] });

  // Low tunnel (south) to check that jumping into a ceiling stops you.
  addBox(scene, world, { pos: [-2, 1, 14], size: [1, 2, 6], color: STONE });
  addBox(scene, world, { pos: [2, 1, 14], size: [1, 2, 6], color: STONE });
  addBox(scene, world, { pos: [0, 2.25, 14], size: [5, 0.5, 6], color: STONE_DARK });

  // A few crates to hop on and hide behind.
  for (const [x, z, s] of [
    [8, 10, 1],
    [9.2, 11, 1],
    [-6, -8, 1.2],
    [14, -12, 1.5],
  ]) {
    addBox(scene, world, { pos: [x, s / 2, z], size: [s, s, s], color: WOOD });
  }
  addBox(scene, world, { pos: [8, 1.5, 10], size: [1, 1, 1], color: WOOD }); // stacked crate

  // Tower (northeast): a 2 m gap jump up from the ramp platform.
  // Max jump height is JUMP_SPEED^2 / (2 * GRAVITY) = ~1.2 m, so +0.8 m is doable.
  addBox(scene, world, { pos: [8, 1.8, -21], size: [4, 3.6, 4], color: STONE });
}
