// Your own weapon, held at the bottom of the screen (a "viewmodel"), with a
// swing animation when you attack and a dip while swapping hands. It's a
// child of the camera, drawn on top of everything so it never pokes into
// walls.

import * as THREE from "three";
import type { WeaponId } from "../../../shared/src/classes.ts";
import { disposeWeapon, makeWeapon } from "./WeaponModels.ts";

const SWING_MS = 260;
const SWAP_MS = 400;

// Where each weapon sits in view (camera space: x right, y up, -z ahead).
const POSE: Record<WeaponId, { pos: [number, number, number]; rot: [number, number, number]; scale: number }> = {
  sword: { pos: [0.42, -0.42, -0.7], rot: [-0.5, 0.2, -0.3], scale: 0.9 },
  shield: { pos: [-0.5, -0.45, -0.95], rot: [0.1, 0.4, 0.05], scale: 0.55 },
  bow: { pos: [0.38, -0.32, -0.9], rot: [0.05, 0.1, 0.3], scale: 0.6 },
  daggers: { pos: [0.05, -0.38, -0.6], rot: [-0.7, 0, 0], scale: 0.9 },
  staff: { pos: [0.45, -0.55, -0.7], rot: [-0.25, 0.1, -0.2], scale: 0.9 },
  spell: { pos: [0.34, -0.3, -0.8], rot: [0.1, 0, 0], scale: 0.55 },
};

export class Viewmodel {
  private root = new THREE.Group();
  private current: THREE.Group | null = null;
  private weapon: WeaponId | null = null;
  private swingAt = -Infinity;
  private swapAt = -Infinity;

  constructor(camera: THREE.Camera) {
    camera.add(this.root);
  }

  show(weapon: WeaponId, spellColor?: string): void {
    if (weapon === this.weapon) return;
    if (this.weapon !== null) this.swapAt = performance.now();
    this.weapon = weapon;
    if (this.current) {
      this.root.remove(this.current);
      disposeWeapon(this.current);
    }
    const model = makeWeapon(weapon, spellColor);
    // Always on top: drawn last, ignoring the depth of the world.
    model.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        (o.material as THREE.Material).depthTest = false;
        o.renderOrder = 999;
      }
    });
    const pose = POSE[weapon];
    model.scale.setScalar(pose.scale);
    this.current = model;
    this.root.add(model);
  }

  swing(): void {
    this.swingAt = performance.now();
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  update(moving: boolean, time: number): void {
    if (!this.current || !this.weapon) return;
    const pose = POSE[this.weapon];
    const now = performance.now();
    // A gentle bob while walking.
    const bob = moving ? Math.sin(time * 9) * 0.015 : 0;
    // Swapping: the new weapon comes up from below.
    const swap = Math.min(1, (now - this.swapAt) / SWAP_MS);
    const dip = (1 - swap) * 0.4;
    this.current.position.set(pose.pos[0], pose.pos[1] + bob - dip, pose.pos[2]);
    this.current.rotation.set(...pose.rot);
    // Swinging: a quick arc (a shove forward for the shield and the bow).
    const k = (now - this.swingAt) / SWING_MS;
    if (k >= 0 && k < 1) {
      const s = Math.sin(k * Math.PI);
      if (this.weapon === "shield" || this.weapon === "bow" || this.weapon === "spell") this.current.position.z -= s * 0.18;
      else {
        this.current.rotation.x -= s * 1.3;
        this.current.rotation.z += s * 0.6;
        this.current.position.x -= s * 0.2;
      }
    }
  }

  dispose(): void {
    if (this.current) disposeWeapon(this.current);
    this.root.removeFromParent();
  }
}
