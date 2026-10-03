// The battle royale's storm: a tall glowing wall around the safe circle, and
// a white ring on the ground showing where the next circle will be.

import * as THREE from "three";
import { stormCircle } from "../../../shared/src/combat.ts";
import type { ZoneState } from "../../../shared/src/protocol.ts";

const WALL_HEIGHT = 40;

export class Storm {
  private zone: ZoneState | null = null;
  private wall: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  private next: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;

  constructor(scene: THREE.Scene) {
    this.wall = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, WALL_HEIGHT, 64, 1, true),
      new THREE.MeshBasicMaterial({ color: "#b04dff", transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.wall.position.y = WALL_HEIGHT / 2 - 2;
    this.next = new THREE.Mesh(
      new THREE.RingGeometry(0.985, 1, 96),
      new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.next.rotation.x = -Math.PI / 2;
    this.next.position.y = 0.08;
    this.wall.visible = this.next.visible = false;
    scene.add(this.wall, this.next);
  }

  set(zone: ZoneState | null): void {
    this.zone = zone;
  }

  // The safe circle right now, or null if there's no storm.
  circle(now: number): [number, number, number] | null {
    return this.zone ? stormCircle(this.zone, now) : null;
  }

  // Damage per second outside the circle, this stage.
  get dps(): number {
    return this.zone?.dps ?? 0;
  }

  // What the storm is doing and how long until that changes.
  timing(now: number): { phase: "hold" | "shrink" | "final"; msLeft: number } | null {
    const z = this.zone;
    if (!z) return null;
    if (z.endsAt <= z.shrinkAt && now >= z.endsAt) return { phase: "final", msLeft: 0 };
    if (now < z.shrinkAt) return { phase: "hold", msLeft: z.shrinkAt - now };
    return { phase: "shrink", msLeft: Math.max(0, z.endsAt - now) };
  }

  update(now: number): void {
    const c = this.circle(now);
    this.wall.visible = !!c;
    this.next.visible = !!c && !!this.zone && this.zone.to[2] > 0 && this.zone.to[2] < c[2] - 0.1;
    if (!c || !this.zone) return;
    const r = Math.max(c[2], 0.05);
    this.wall.position.x = c[0];
    this.wall.position.z = c[1];
    this.wall.scale.set(r, 1, r);
    this.wall.material.opacity = 0.22 + 0.06 * Math.sin(now / 300);
    const [nx, nz, nr] = this.zone.to;
    this.next.position.x = nx;
    this.next.position.z = nz;
    this.next.scale.set(nr, nr, 1);
  }
}
