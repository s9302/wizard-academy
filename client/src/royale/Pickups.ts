// Battle royale pickups, floating and spinning where the server put them:
// a Fire Tome (orange book), a Healing Draught (pink crystal), a Ward (blue
// gem). Walking into one is all it takes; the server decides if you got it.

import * as THREE from "three";
import { type PickupKind, PICKUPS } from "../../../shared/src/combat.ts";
import type { PickupInfo } from "../../../shared/src/protocol.ts";

function makeItem(kind: PickupKind): THREE.Group {
  const color = new THREE.Color(PICKUPS[kind].color);
  const mat = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.55, flatShading: true });
  const group = new THREE.Group();
  if (kind === "tome") {
    group.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.65, 0.16), mat));
    const pages = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.58, 0.18), new THREE.MeshLambertMaterial({ color: "#f4efe6" }));
    pages.position.x = 0.04;
    group.add(pages);
  } else if (kind === "potion") {
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.32), mat);
    crystal.scale.y = 1.4;
    group.add(crystal);
  } else {
    group.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.33, 0), mat));
  }
  // A soft glow on the ground under it.
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(0.7, 16),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = -0.85;
  glow.userData.ground = true;
  group.add(glow);
  return group;
}

export class Pickups {
  private scene: THREE.Scene;
  private items = new Map<number, { group: THREE.Group; baseY: number }>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  set(list: PickupInfo[]): void {
    const keep = new Set(list.map((p) => p.id));
    for (const [id, item] of this.items) {
      if (keep.has(id)) continue;
      this.scene.remove(item.group);
      this.items.delete(id);
    }
    for (const p of list) {
      if (this.items.has(p.id)) continue;
      const group = makeItem(p.kind);
      group.position.set(...p.p);
      this.scene.add(group);
      this.items.set(p.id, { group, baseY: p.p[1] });
    }
  }

  update(time: number): void {
    let i = 0;
    for (const { group, baseY } of this.items.values()) {
      const bob = Math.sin(time * 2 + i++) * 0.12;
      group.position.y = baseY + bob;
      for (const child of group.children) {
        if (child.userData.ground) child.position.y = -0.85 - bob;
        else child.rotation.y = time * 1.5;
      }
    }
  }
}
