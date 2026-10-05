// Your own weapon, held at the bottom of the screen (a "viewmodel"), with an
// attack animation per weapon (a sword's slash, a mace's overhead smash, a
// staff's jab, alternating dagger stabs, a shield bash, a casting push) and
// a dip while swapping hands. The bow is held drawn with an arrow nocked;
// a shot snaps the string forward, then it's re-nocked and drawn again over
// its cooldown. A child of the camera, drawn on top of everything so it
// never pokes into walls.

import * as THREE from "three";
import type { WeaponId } from "../../../shared/src/classes.ts";
import { disposeWeapon, makeWeapon, setBowDraw } from "./WeaponModels.ts";

// How long each weapon's attack animation takes.
const SWING_MS: Partial<Record<WeaponId, number>> = { sword: 340, mace: 420, staff: 300, daggers: 200, shield: 300 };
const DEFAULT_SWING_MS = 280;

const ease = (t: number) => t * t * (3 - 2 * t); // smoothstep
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
// 0 -> 1 over [a, b] of the animation, eased.
const span = (k: number, a: number, b: number) => ease(clamp01((k - a) / (b - a)));
const SWAP_MS = 400;

// Where each weapon sits in view (camera space: x right, y up, -z ahead).
const POSE: Record<WeaponId, { pos: [number, number, number]; rot: [number, number, number]; scale: number }> = {
  sword: { pos: [0.42, -0.42, -0.7], rot: [-0.5, 0.2, -0.3], scale: 0.9 },
  shield: { pos: [-0.5, -0.45, -0.95], rot: [0.1, 0.4, 0.05], scale: 0.55 },
  bow: { pos: [-0.3, -0.27, -0.85], rot: [0.05, -0.2, -0.45], scale: 0.42 },
  daggers: { pos: [0.05, -0.38, -0.6], rot: [-0.7, 0, 0], scale: 0.9 },
  staff: { pos: [0.45, -0.55, -0.7], rot: [-0.25, 0.1, -0.2], scale: 0.9 },
  spell: { pos: [0.34, -0.3, -0.8], rot: [0.1, 0, 0], scale: 0.55 },
  mace: { pos: [0.47, -0.5, -0.78], rot: [-0.45, 0.2, -0.3], scale: 0.75 },
  holy: { pos: [0.44, -0.4, -0.85], rot: [0.15, -0.15, 0], scale: 0.5 },
  thorns: { pos: [0.38, -0.36, -0.75], rot: [-0.3, 0.1, -0.15], scale: 0.7 },
  sickle: { pos: [0.42, -0.42, -0.72], rot: [-0.45, 0.2, -0.3], scale: 0.85 },
  fists: { pos: [0, -0.36, -0.55], rot: [-0.2, 0, 0], scale: 0.9 },
};

export class Viewmodel {
  private root = new THREE.Group();
  private current: THREE.Group | null = null;
  private weapon: WeaponId | null = null;
  private swingAt = -Infinity;
  private swapAt = -Infinity;
  private reloadMs = 900; // the bow: how long until it's drawn again
  private stabSide = 1; // daggers alternate

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

  // An attack. reloadMs: for the bow, its cooldown (re-nock and draw).
  swing(reloadMs = 900): void {
    this.swingAt = performance.now();
    this.reloadMs = reloadMs;
    this.stabSide = -this.stabSide;
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
    this.current.scale.setScalar(pose.scale);
    this.animate(this.current, this.weapon, now - this.swingAt);
  }

  private animate(m: THREE.Group, weapon: WeaponId, ms: number): void {
    if (weapon === "bow") {
      // Held drawn. A shot: the string snaps forward (the arrow's gone), then
      // a new arrow is nocked and the string drawn back over the cooldown.
      const k = ms / this.reloadMs;
      if (k < 0 || k >= 1) return setBowDraw(m, 1, true);
      const snap = clamp01(ms / 60);
      const draw = span(k, 0.35, 0.95);
      setBowDraw(m, k < 0.35 ? 1 - snap : draw, k >= 0.3);
      m.position.z += (k < 0.15 ? Math.sin((k / 0.15) * Math.PI) * 0.05 : 0); // a little kick
      return;
    }
    const dur = SWING_MS[weapon] ?? DEFAULT_SWING_MS;
    const k = ms / dur;
    if (k < 0 || k >= 1) return;
    switch (weapon) {
      case "sword": {
        // Cock up and right, sweep across to the left, settle back.
        const up = span(k, 0, 0.25) * (1 - span(k, 0.25, 0.55));
        const sweep = span(k, 0.25, 0.55) * (1 - span(k, 0.65, 1));
        m.position.x += up * 0.12 - sweep * 0.55;
        m.position.y += up * 0.12 - sweep * 0.05;
        m.rotation.z += -up * 0.7 + sweep * 1.5;
        m.rotation.y += sweep * 0.9;
        m.rotation.x += -sweep * 0.4;
        break;
      }
      case "mace": {
        // Up over the shoulder, then down hard.
        const up = span(k, 0, 0.35) * (1 - span(k, 0.35, 0.55));
        const down = span(k, 0.35, 0.55) * (1 - span(k, 0.7, 1));
        m.position.y += up * 0.22 - down * 0.18;
        m.position.z += down * -0.12;
        m.rotation.x += up * 1.1 - down * 1.6;
        break;
      }
      case "staff": {
        // A jab forward with a twist.
        const jab = span(k, 0, 0.35) * (1 - span(k, 0.45, 1));
        m.position.z -= jab * 0.4;
        m.position.x -= jab * 0.15;
        m.rotation.x -= jab * 0.9;
        m.rotation.y += jab * 0.8;
        break;
      }
      case "daggers": {
        // A quick stab, left and right in turn.
        const stab = Math.sin(clamp01(k) * Math.PI);
        m.position.z -= stab * 0.3;
        m.position.x += stab * 0.12 * this.stabSide;
        m.rotation.x -= stab * 0.5;
        break;
      }
      case "shield": {
        // A bash: forward and toward the middle.
        const bash = span(k, 0, 0.3) * (1 - span(k, 0.4, 1));
        m.position.z -= bash * 0.35;
        m.position.x += bash * 0.18;
        m.rotation.y -= bash * 0.4;
        break;
      }
      default: {
        // Casting (spell, holy light): a push forward and a flare.
        const push = Math.sin(clamp01(k) * Math.PI);
        m.position.z -= push * 0.22;
        m.position.y += push * 0.04;
        m.rotation.x -= push * 0.3;
        m.scale.setScalar(POSE[weapon].scale * (1 + push * 0.15));
        return;
      }
    }
  }

  dispose(): void {
    if (this.current) disposeWeapon(this.current);
    this.root.removeFromParent();
  }
}
