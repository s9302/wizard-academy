// Draws Rogue copies (Mirror Images): each one is a full avatar of the Rogue
// who made it, name tag and all, running where the server says it is.

import * as THREE from "three";
import type { DecoyState } from "../../../shared/src/protocol.ts";
import { animateAvatar, disposeAvatar, setAvatarHealth } from "../Avatar.ts";
import { particles } from "../graphics/Particles.ts";

type View = { owner: number; avatar: THREE.Group; from: THREE.Vector3; to: THREE.Vector3; at: number; ry: number };

export class Decoys {
  private scene: THREE.Scene;
  private makeAvatar: (owner: number) => THREE.Group | null;
  private healthOf: (owner: number) => { hp: number; shield: number }; // fractions 0..1
  private views = new Map<number, View>();

  constructor(scene: THREE.Scene, makeAvatar: (owner: number) => THREE.Group | null, healthOf: (owner: number) => { hp: number; shield: number }) {
    this.scene = scene;
    this.makeAvatar = makeAvatar;
    this.healthOf = healthOf;
  }

  // The owner's health changed: their copies' bars match (so they don't give themselves away).
  setHealth(owner: number, hp: number, shield: number): void {
    for (const v of this.views.values()) if (v.owner === owner) setAvatarHealth(v.avatar, hp, shield);
  }

  set(list: DecoyState[]): void {
    const now = performance.now();
    const seen = new Set<number>();
    for (const d of list) {
      seen.add(d.id);
      let v = this.views.get(d.id);
      if (!v) {
        const avatar = this.makeAvatar(d.owner);
        if (!avatar) continue;
        avatar.position.set(...d.p);
        const h = this.healthOf(d.owner);
        setAvatarHealth(avatar, h.hp, h.shield);
        this.scene.add(avatar);
        v = { owner: d.owner, avatar, from: new THREE.Vector3(...d.p), to: new THREE.Vector3(...d.p), at: now, ry: d.ry };
        this.views.set(d.id, v);
      }
      v.from.copy(v.avatar.position);
      v.to.set(...d.p);
      v.at = now;
      v.ry = d.ry;
    }
    for (const [id, v] of this.views) {
      if (seen.has(id)) continue;
      particles.emit({ at: v.avatar.position, count: 30, color: "#5a4a7a", color2: "#c58fff", speed: 2.5, up: 1, spread: 0.4, life: 0.7, size: 0.25 });
      this.scene.remove(v.avatar);
      disposeAvatar(v.avatar);
      this.views.delete(id);
    }
  }

  update(): void {
    const now = performance.now();
    for (const v of this.views.values()) {
      const k = Math.min(1, (now - v.at) / 110);
      v.avatar.position.lerpVectors(v.from, v.to, k);
      v.avatar.rotation.y = v.ry;
      animateAvatar(v.avatar, now, 6.5);
    }
  }

  clear(): void {
    this.set([]);
  }
}
