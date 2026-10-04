// Low-poly weapon models, built from a few boxes and shapes. Used for your
// own view (Viewmodel.ts) and in other players' hands (Avatar.ts). Each
// model's grip is at its origin, pointing up (+Y) like a held sword.

import * as THREE from "three";
import type { WeaponId } from "../../../shared/src/classes.ts";

const mat = (color: string, emissive = 0) =>
  new THREE.MeshLambertMaterial({ color, flatShading: true, emissive: emissive ? color : "#000000", emissiveIntensity: emissive });

function part(geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  return m;
}

export function makeWeapon(weapon: WeaponId, spellColor = "#b48cff"): THREE.Group {
  const g = new THREE.Group();
  const steel = mat("#c9cdd6");
  const wood = mat("#7a5236");
  const gold = mat("#e8c547");
  switch (weapon) {
    case "sword":
      g.add(part(new THREE.BoxGeometry(0.06, 0.2, 0.06), wood, 0, 0.0)); // grip
      g.add(part(new THREE.BoxGeometry(0.28, 0.05, 0.08), gold, 0, 0.12)); // guard
      g.add(part(new THREE.BoxGeometry(0.07, 0.8, 0.02), steel, 0, 0.55)); // blade
      g.add(part(new THREE.ConeGeometry(0.05, 0.12, 4), steel, 0, 1.0)); // tip
      break;
    case "shield": {
      const face = part(new THREE.BoxGeometry(0.55, 0.7, 0.06), mat("#2f4f9e"), 0, 0.1);
      g.add(face);
      g.add(part(new THREE.BoxGeometry(0.6, 0.06, 0.08), gold, 0, 0.45)); // rim top
      g.add(part(new THREE.BoxGeometry(0.06, 0.62, 0.08), gold, 0, 0.1, 0.0)); // a cross
      g.add(part(new THREE.BoxGeometry(0.42, 0.06, 0.08), gold, 0, 0.18));
      break;
    }
    case "bow": {
      // Three segments in a curve, and a string.
      for (const [y, rz] of [
        [0.35, 0.35],
        [0, 0],
        [-0.35, -0.35],
      ]) {
        const limb = part(new THREE.BoxGeometry(0.05, 0.4, 0.05), wood, rz * 0.25, y);
        limb.rotation.z = rz;
        g.add(limb);
      }
      g.add(part(new THREE.BoxGeometry(0.01, 1.0, 0.01), mat("#f4efe6"), -0.12, 0));
      break;
    }
    case "daggers":
      for (const x of [-0.12, 0.12]) {
        g.add(part(new THREE.BoxGeometry(0.05, 0.12, 0.05), wood, x, 0));
        g.add(part(new THREE.BoxGeometry(0.04, 0.32, 0.015), steel, x, 0.22));
      }
      break;
    case "staff":
      g.add(part(new THREE.CylinderGeometry(0.03, 0.035, 1.3, 6), wood, 0, 0.35));
      g.add(part(new THREE.OctahedronGeometry(0.09), mat("#8fe3ff", 0.6), 0, 1.07));
      break;
    case "mace": {
      // A wooden haft, a flanged steel head, a gold collar.
      g.add(part(new THREE.CylinderGeometry(0.03, 0.035, 0.6, 6), wood, 0, 0.15));
      g.add(part(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 8), gold, 0, 0.43));
      g.add(part(new THREE.DodecahedronGeometry(0.11, 0), steel, 0, 0.55));
      for (let i = 0; i < 4; i++) {
        const flange = part(new THREE.BoxGeometry(0.03, 0.18, 0.07), steel, Math.cos((i * Math.PI) / 2) * 0.1, 0.55, Math.sin((i * Math.PI) / 2) * 0.1);
        flange.rotation.y = (-i * Math.PI) / 2;
        g.add(flange);
      }
      break;
    }
    case "holy": {
      // A holy symbol: a gold sunburst on a short handle, glowing.
      g.add(part(new THREE.CylinderGeometry(0.025, 0.03, 0.22, 6), wood, 0, 0));
      g.add(part(new THREE.TorusGeometry(0.1, 0.022, 6, 16), gold, 0, 0.22));
      g.add(part(new THREE.OctahedronGeometry(0.07), mat("#ffe9a0", 0.9), 0, 0.22));
      break;
    }
    case "spell": {
      // A glowing orb hovering over an open hand.
      g.add(part(new THREE.BoxGeometry(0.14, 0.05, 0.16), mat("#f3dcc4"), 0, 0));
      g.add(part(new THREE.IcosahedronGeometry(0.09, 1), mat(spellColor, 0.9), 0, 0.16));
      break;
    }
  }
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = false;
  });
  return g;
}

export function disposeWeapon(g: THREE.Object3D): void {
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
}
