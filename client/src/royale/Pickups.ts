// Battle royale pickups, floating and spinning where the server put them:
// a Fire Tome (orange book), a Healing Draught (pink crystal), a Ward (blue
// gem), and the powerups you carry until F: a Haste Charm (lightning bolt),
// Cloud Boots (a cloud with wings), a Shadow Cloak (a hood) and a Fury Rune
// (a red star in a ring). Walking into one is all it takes; the server
// decides if you got it.

import * as THREE from "three";
import { type PickupKind, PICKUPS } from "../../../shared/src/combat.ts";
import type { PickupInfo } from "../../../shared/src/protocol.ts";
import { particles } from "../graphics/Particles.ts";

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
  } else if (kind === "haste") {
    // A zigzag lightning bolt.
    const bolt = new THREE.Shape();
    for (const [i, [x, y]] of [[0.1, 0.45], [-0.18, 0.02], [0.02, 0.02], [-0.1, -0.45], [0.2, 0.06], [0, 0.06], [0.1, 0.45]].entries()) {
      if (i === 0) bolt.moveTo(x, y);
      else bolt.lineTo(x, y);
    }
    group.add(new THREE.Mesh(new THREE.ExtrudeGeometry(bolt, { depth: 0.1, bevelEnabled: false }).translate(0, 0, -0.05), mat));
  } else if (kind === "quadjump") {
    // A little cloud with a wing on each side.
    for (const [x, y, r] of [[0, 0.05, 0.22], [-0.2, -0.02, 0.16], [0.2, -0.02, 0.16], [0.08, 0.15, 0.15]]) {
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), mat);
      puff.position.set(x, y, 0);
      group.add(puff);
    }
    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.42, 4), mat);
      wing.position.set(side * 0.42, 0.12, 0);
      wing.rotation.z = side * -1.1;
      group.add(wing);
    }
  } else if (kind === "cloak") {
    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.7, 6, 1, true), mat);
    (hood.material as THREE.MeshLambertMaterial).side = THREE.DoubleSide;
    group.add(hood);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color: "#0b0612" }));
    face.position.set(0, -0.08, 0.14);
    group.add(face);
  } else if (kind === "fury") {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.05, 6, 20), mat);
    const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), mat);
    star.scale.set(1, 1.3, 0.5);
    group.add(ring, star);
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
  private items = new Map<number, { group: THREE.Group; baseY: number; color: string }>();
  private lastSpark = 0;

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
      this.items.set(p.id, { group, baseY: p.p[1], color: PICKUPS[p.kind].color });
    }
  }

  update(time: number): void {
    let i = 0;
    const spark = time - this.lastSpark > 0.1;
    if (spark) this.lastSpark = time;
    for (const { group, baseY, color } of this.items.values()) {
      if (spark) particles.emit({ at: group.position, count: 1, color, color2: "#ffffff", speed: 0.4, up: 0.6, spread: 0.6, life: 1, size: 0.1 });
      const bob = Math.sin(time * 2 + i++) * 0.12;
      group.position.y = baseY + bob;
      for (const child of group.children) {
        if (child.userData.ground) child.position.y = -0.85 - bob;
        else child.rotation.y = time * 1.5;
      }
    }
  }
}
