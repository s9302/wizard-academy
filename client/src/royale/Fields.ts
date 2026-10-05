// Draws the areas level 11+ abilities leave on the ground: a rolling
// tornado, a line of fire, the pit to hell, a Null Zone dome, and smoke. The
// server decides what they do; this only shows them (and says whether a
// point is in a Null Zone, so the client doesn't bother casting there).

import * as THREE from "three";
import { type FieldInfo, fieldCenter, inField } from "../../../shared/src/abilities.ts";
import { sound } from "../audio/Sound.ts";
import { glowMat } from "../bosses/BossView.ts";
import { particles } from "../graphics/Particles.ts";
import type { ServerClock } from "../ServerClock.ts";

type View = { info: FieldInfo; root: THREE.Group; spin: THREE.Object3D[] };

export class Fields {
  private scene: THREE.Scene;
  private clock: ServerClock;
  private views = new Map<number, View>();

  constructor(scene: THREE.Scene, clock: ServerClock) {
    this.scene = scene;
    this.clock = clock;
  }

  add(info: FieldInfo): void {
    this.remove(info.id);
    const root = new THREE.Group();
    root.position.set(...info.p);
    const spin: THREE.Object3D[] = [];
    const see = (color: string, opacity: number) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    switch (info.kind) {
      case "tornado": {
        // Three stacked, spinning funnels, wide at the top.
        for (let i = 0; i < 3; i++) {
          const funnel = new THREE.Mesh(new THREE.CylinderGeometry(info.r * (0.6 + i * 0.25), info.r * 0.25, 6.5 - i, 14, 4, true), see(i ? "#cfd6e6" : "#9aa3b8", 0.45 - i * 0.1));
          funnel.position.y = 3.2 + i * 0.3;
          root.add(funnel);
          spin.push(funnel);
        }
        sound.fx("rumble", { at: info.p });
        break;
      }
      case "flames": {
        const glow = new THREE.Mesh(new THREE.BoxGeometry(info.len ?? 10, 0.15, info.r * 2), glowMat("#ff6a1a", 2.5));
        glow.position.y = 0.08;
        glow.rotation.y = info.yaw ?? 0;
        root.add(glow);
        sound.fx("fireball", { at: info.p });
        break;
      }
      case "hellpit": {
        const rim = new THREE.Mesh(new THREE.RingGeometry(info.r - 0.4, info.r, 40), glowMat("#ff3a1a", 3));
        const hole = new THREE.Mesh(new THREE.CircleGeometry(info.r - 0.4, 40), new THREE.MeshBasicMaterial({ color: "#120404" }));
        const swirl = new THREE.Mesh(new THREE.RingGeometry(0.6, info.r - 0.8, 6, 1), see("#7a0d0d", 0.7));
        for (const m of [rim, hole, swirl]) m.rotation.x = -Math.PI / 2;
        rim.position.y = 0.06;
        hole.position.y = 0.04;
        swirl.position.y = 0.05;
        // A dim red glow rising from it, so it reads on slopes and steps too.
        const column = new THREE.Mesh(new THREE.CylinderGeometry(info.r, info.r * 0.85, 3, 32, 1, true), see("#ff3a1a", 0.13));
        column.position.y = 1.2;
        root.add(rim, hole, swirl, column);
        spin.push(swirl);
        sound.fx("explosion", { at: info.p, volume: 0.7 });
        sound.fx("rumble", { at: info.p });
        break;
      }
      case "nullzone": {
        const dome = new THREE.Mesh(new THREE.SphereGeometry(info.r, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), see("#bfe4ff", 0.12));
        const ring = new THREE.Mesh(new THREE.RingGeometry(info.r - 0.2, info.r, 48), see("#e8f6ff", 0.7));
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.05;
        root.add(dome, ring);
        sound.fx("fortify", { at: info.p });
        break;
      }
      case "smite": {
        // The marked circle; the pillar of light comes when it ends (remove).
        const ring = new THREE.Mesh(new THREE.RingGeometry(info.r - 0.2, info.r, 40), see("#ffe066", 0.85));
        const fill = new THREE.Mesh(new THREE.CircleGeometry(info.r - 0.2, 40), see("#fff2b0", 0.2));
        for (const m of [ring, fill]) {
          m.rotation.x = -Math.PI / 2;
          m.position.y = 0.06;
        }
        root.add(ring, fill);
        spin.push(ring);
        sound.fx("charge", { at: info.p, rate: 1.4, volume: 0.6 });
        break;
      }
      case "sanctuary": {
        const ring = new THREE.Mesh(new THREE.RingGeometry(info.r - 0.25, info.r, 48), glowMat("#ffe9a0", 2));
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.06;
        const glow = new THREE.Mesh(new THREE.CylinderGeometry(info.r, info.r, 0.8, 32, 1, true), see("#fff2b0", 0.12));
        glow.position.y = 0.4;
        root.add(ring, glow);
        sound.fx("levelUp", { at: info.p, volume: 0.5 });
        break;
      }
      case "entangle": {
        // Thorny vines: a dark green ring and spiky stems poking up.
        const ring = new THREE.Mesh(new THREE.RingGeometry(info.r - 0.3, info.r, 40), see("#3f9a3a", 0.85));
        const fill = new THREE.Mesh(new THREE.CircleGeometry(info.r - 0.3, 40), see("#2a5a22", 0.35));
        for (const m of [ring, fill]) {
          m.rotation.x = -Math.PI / 2;
          m.position.y = 0.05;
        }
        root.add(ring, fill);
        const vine = new THREE.MeshLambertMaterial({ color: "#3d7a2e", flatShading: true });
        for (let i = 0; i < 18; i++) {
          const a = Math.random() * Math.PI * 2;
          const d = Math.sqrt(Math.random()) * (info.r - 0.4);
          const stem = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.7 + Math.random() * 0.6, 4), vine);
          stem.position.set(Math.cos(a) * d, 0.35, Math.sin(a) * d);
          stem.rotation.set((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6);
          stem.scale.y = 0.01;
          root.add(stem);
          spin.push(stem);
        }
        sound.fx("rumble", { at: info.p, volume: 0.5 });
        break;
      }
      case "smoke": {
        // Lumpy, nearly opaque grey balls: you really can't see through it.
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2;
          const d = i === 0 ? 0 : info.r * 0.55;
          const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(info.r * (i === 0 ? 0.75 : 0.55), 1), new THREE.MeshLambertMaterial({ color: "#8a8796", transparent: true, opacity: 0.88, flatShading: true }));
          ball.position.set(Math.cos(a) * d, info.r * 0.45 + (i % 3) * 0.4, Math.sin(a) * d);
          root.add(ball);
          spin.push(ball);
        }
        sound.fx("explosion", { at: info.p, volume: 0.4 });
        break;
      }
    }
    this.scene.add(root);
    this.views.set(info.id, { info, root, spin });
  }

  remove(id: number): void {
    const v = this.views.get(id);
    if (!v) return;
    this.scene.remove(v.root);
    v.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    this.views.delete(id);
    if (v.info.kind === "smite") {
      // The pillar of light, for a moment.
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(v.info.r * 0.6, v.info.r, 30, 16, 1, true), glowMat("#fff6c8", 3));
      pillar.position.set(v.info.p[0], v.info.p[1] + 15, v.info.p[2]);
      this.scene.add(pillar);
      setTimeout(() => {
        this.scene.remove(pillar);
        pillar.geometry.dispose();
      }, 350);
      particles.emit({ at: [v.info.p[0], v.info.p[1] + 0.3, v.info.p[2]], count: 70, color: "#fff6c8", color2: "#ffd25a", speed: 6, up: 2, life: 0.7, size: 0.3 });
      sound.fx("thunder", { at: v.info.p, volume: 0.7 });
      sound.fx("explosion", { at: v.info.p, volume: 0.5 });
    }
    if (v.info.kind === "smoke" || v.info.kind === "tornado") particles.emit({ at: fieldCenter(v.info, this.clock.now()), count: 25, color: "#a09cad", speed: 2, up: 1, spread: v.info.r, life: 0.8, size: 0.5 });
  }

  clear(): void {
    for (const id of [...this.views.keys()]) this.remove(id);
  }

  inNullZone(p: THREE.Vector3): boolean {
    const now = this.clock.now();
    for (const v of this.views.values()) if (v.info.kind === "nullzone" && inField(v.info, [p.x, p.y, p.z], now)) return true;
    return false;
  }

  update(dt: number): void {
    const now = this.clock.now();
    for (const v of this.views.values()) {
      const { info, root } = v;
      if (info.kind === "tornado") {
        root.position.set(...fieldCenter(info, now));
        v.spin.forEach((m, i) => (m.rotation.y += dt * (6 + i * 2)));
        if (Math.random() < 0.7) particles.emit({ at: [root.position.x, root.position.y + 0.3, root.position.z], count: 2, color: "#b8b0a0", speed: 3, up: 3, spread: info.r, life: 0.7, size: 0.3 });
      } else if (info.kind === "flames") {
        // Flames along the line.
        const len = info.len ?? 10;
        const ax = Math.cos(info.yaw ?? 0);
        const az = -Math.sin(info.yaw ?? 0);
        for (let i = 0; i < 4; i++) {
          const t = (Math.random() - 0.5) * len;
          particles.emit({ at: [info.p[0] + ax * t, info.p[1] + 0.2, info.p[2] + az * t], count: 1, color: "#ffb347", color2: "#ff3a1a", speed: 0.6, up: 4, spread: info.r * 0.6, life: 0.6, size: 0.45, gravity: -2 });
        }
      } else if (info.kind === "hellpit") {
        v.spin[0].rotation.z += dt * 2;
        if (Math.random() < 0.8) particles.emit({ at: [info.p[0], info.p[1] + 0.2, info.p[2]], count: 2, color: "#ff4a1a", color2: "#3a0000", speed: 0.5, up: 3, spread: info.r * 0.8, life: 0.9, size: 0.3, gravity: -1 });
      } else if (info.kind === "smite") {
        v.spin[0].scale.setScalar(1 - Math.min(1, (now - info.time) / info.ms) * 0.3);
      } else if (info.kind === "sanctuary") {
        if (Math.random() < 0.6) particles.emit({ at: [info.p[0], info.p[1] + 0.2, info.p[2]], count: 1, color: "#fff2a8", color2: "#ffffff", speed: 0.2, up: 1.5, spread: info.r * 0.9, life: 1.2, size: 0.15, gravity: -0.5 });
      } else if (info.kind === "entangle") {
        // The vines grow up out of the ground, then sway.
        const grow = Math.min(1, (now - info.time) / 400);
        v.spin.forEach((m, i) => {
          m.scale.y = grow;
          m.rotation.y = Math.sin(now / 400 + i) * 0.3;
        });
      } else if (info.kind === "smoke") {
        v.spin.forEach((m, i) => {
          m.rotation.y += dt * 0.2 * (i % 2 ? 1 : -1);
          m.scale.setScalar(1 + Math.sin(now / 700 + i) * 0.06);
        });
      }
    }
  }
}
