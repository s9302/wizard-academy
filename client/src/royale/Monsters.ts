// Draws the battle royale's monsters from the server's updates (~10 a
// second), sliding smoothly between them like other players. Each kind has
// its own little model and way of moving: slimes hop, wolves lope, golems
// stomp. A wind-up (the attack you can still dodge) rears them back and
// tints them red.

import * as THREE from "three";
import { type MonsterKind, MONSTERS, type MonsterState } from "../../../shared/src/monsters.ts";
import { particles } from "../graphics/Particles.ts";
import { sound } from "../audio/Sound.ts";

type View = {
  kind: MonsterKind;
  root: THREE.Group; // positioned at the monster's center
  body: THREE.Group; // animated
  legs: THREE.Object3D[];
  mats: THREE.MeshLambertMaterial[];
  bar: THREE.Sprite;
  from: THREE.Vector3;
  to: THREE.Vector3;
  fromRy: number;
  toRy: number;
  at: number; // when `to` arrived (performance.now)
  hp: number;
  attacking: boolean;
  phase: number;
  flashUntil: number;
};

const LERP_MS = 110;

function lambert(color: string, emissive?: string): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, flatShading: true, emissive: emissive ?? "#000000" });
}

function eyes(g: THREE.Object3D, y: number, z: number, spread: number, size: number, color = "#1a1a1a"): void {
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(size, 6, 4), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
    e.position.set(s * spread, y, z);
    g.add(e);
  }
}

function build(kind: MonsterKind): { body: THREE.Group; legs: THREE.Object3D[]; mats: THREE.MeshLambertMaterial[] } {
  const body = new THREE.Group();
  const legs: THREE.Object3D[] = [];
  const mats: THREE.MeshLambertMaterial[] = [];
  const add = (m: THREE.Mesh) => {
    m.castShadow = true;
    if (m.material instanceof THREE.MeshLambertMaterial) mats.push(m.material);
    body.add(m);
    return m;
  };
  if (kind === "slime") {
    const goo = new THREE.MeshLambertMaterial({ color: "#5ad16e", transparent: true, opacity: 0.85, flatShading: true });
    const blob = add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.72, 1), goo));
    blob.scale.set(1, 0.8, 1);
    add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 0), lambert("#2f8a3e"))).position.set(0.1, -0.1, 0.1);
    eyes(body, 0.15, -0.6, 0.22, 0.09);
  } else if (kind === "wolf") {
    const fur = lambert("#3a3550");
    add(new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 1.2), fur)).position.set(0, 0.05, 0);
    const head = add(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.4, 0.5), fur));
    head.position.set(0, 0.3, -0.75);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, 0.3), lambert("#2a2640"))).position.set(0, 0.2, -1.1);
    for (const s of [-1, 1]) {
      const ear = add(new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.2, 4), fur));
      ear.position.set(s * 0.13, 0.58, -0.7);
    }
    eyes(body, 0.38, -1.0, 0.12, 0.05, "#b48cff");
    const tail = add(new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.6, 5), fur));
    tail.position.set(0, 0.25, 0.75);
    tail.rotation.x = 1.0;
    for (const [x, z] of [[-0.2, -0.4], [0.2, -0.4], [-0.2, 0.4], [0.2, 0.4]]) {
      const leg = new THREE.Group();
      leg.position.set(x, -0.15, z);
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.55, 0.13), fur);
      m.position.y = -0.27;
      m.castShadow = true;
      leg.add(m);
      body.add(leg);
      legs.push(leg);
    }
  } else if (kind === "imp") {
    // A Fire Imp: a small red demon with horns, bat wings and a tail,
    // hovering, a ball of fire in its hand (it flares up as it winds up).
    const skin = lambert("#e0452f");
    const dark = lambert("#7a1e16");
    add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.38), skin)).position.set(0, 0, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 0.05), lambert("#ffb08a"))).position.set(0, -0.02, -0.2); // belly
    add(new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.42, 0.42), skin)).position.set(0, 0.5, -0.02);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.05), dark)).position.set(0, 0.38, -0.24); // a grin
    eyes(body, 0.56, -0.24, 0.11, 0.07, "#ffd23a");
    for (const s of [-1, 1]) {
      const horn = add(new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.25, 4), dark));
      horn.position.set(s * 0.15, 0.8, 0);
      horn.rotation.z = -s * 0.4;
      // Wings flap (they're its "legs" for the walk cycle).
      // A bat wing behind each shoulder: a bony spar and a sail hanging off it.
      const wing = new THREE.Group();
      wing.position.set(s * 0.2, 0.2, 0.2);
      const sailMat = new THREE.MeshLambertMaterial({ color: "#5a1610", flatShading: true, side: THREE.DoubleSide });
      const spar = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.06, 0.06), dark.clone());
      spar.position.set(s * 0.37, 0.22, 0);
      spar.rotation.z = s * 0.5;
      const sail = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.5, 0.03), sailMat);
      sail.position.set(s * 0.34, 0.02, 0);
      sail.rotation.z = s * 0.25;
      wing.add(spar, sail);
      body.add(wing);
      legs.push(wing);
      const leg = add(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.35, 0.14), dark));
      leg.position.set(s * 0.13, -0.45, 0);
    }
    const tail = add(new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.6, 4), dark));
    tail.position.set(0, -0.3, 0.35);
    tail.rotation.x = -1.1;
    const fire = new THREE.Mesh(new THREE.IcosahedronGeometry(0.14, 1), new THREE.MeshBasicMaterial({ color: "#ffb347", toneMapped: false }));
    fire.name = "fire";
    fire.position.set(0.35, 0.1, -0.25);
    body.add(fire);
  } else {
    const stone = lambert("#7d7890");
    const dark = lambert("#5a5568");
    add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.3, 1.0), stone)).position.set(0, 0.3, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.7, 0.7), dark)).position.set(0, 1.2, -0.1);
    eyes(body, 1.25, -0.46, 0.18, 0.08, "#ffb347");
    // A glowing rune on its chest.
    const rune = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), new THREE.MeshBasicMaterial({ color: "#ffb347", toneMapped: false }));
    rune.position.set(0, 0.4, -0.52);
    body.add(rune);
    for (const s of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(s * 0.95, 0.8, 0);
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.3, 0.45), stone);
      m.position.y = -0.6;
      m.castShadow = true;
      arm.add(m);
      body.add(arm);
      legs.push(arm); // arms swing like legs
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 0.5), dark);
      leg.position.set(s * 0.4, -0.65, 0);
      leg.castShadow = true;
      body.add(leg);
    }
  }
  return { body, legs, mats };
}

function healthBar(): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 14;
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, toneMapped: false }));
  s.scale.set(0.9, 0.13, 1);
  return s;
}

function drawBar(bar: THREE.Sprite, frac: number): void {
  const t = bar.material.map as THREE.CanvasTexture;
  const g = (t.image as HTMLCanvasElement).getContext("2d")!;
  g.clearRect(0, 0, 96, 14);
  g.fillStyle = "rgba(0,0,0,0.6)";
  g.fillRect(0, 0, 96, 14);
  g.fillStyle = "#ff7a3d";
  g.fillRect(2, 2, 92 * frac, 10);
  t.needsUpdate = true;
}

export class MonsterViews {
  private scene: THREE.Scene;
  private views = new Map<number, View>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  // The server's latest list.
  set(list: MonsterState[]): void {
    const now = performance.now();
    const keep = new Set(list.map((m) => m.id));
    for (const [id, v] of this.views) if (!keep.has(id)) this.remove(id, v);
    for (const m of list) {
      let v = this.views.get(m.id);
      if (!v) {
        const { body, legs, mats } = build(m.kind);
        const root = new THREE.Group();
        root.add(body);
        const bar = healthBar();
        bar.position.y = MONSTERS[m.kind].height + 0.7;
        root.add(bar);
        if (m.owner !== undefined) {
          // A Druid's beast: a green ring under it.
          const r = MONSTERS[m.kind].radius;
          const ring = new THREE.Mesh(new THREE.RingGeometry(r + 0.1, r + 0.3, 28), new THREE.MeshBasicMaterial({ color: "#7fd06a", transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
          ring.rotation.x = -Math.PI / 2;
          ring.position.y = -MONSTERS[m.kind].height + 0.05;
          root.add(ring);
        }
        root.position.set(...m.p);
        this.scene.add(root);
        v = {
          kind: m.kind, root, body, legs, mats, bar,
          from: new THREE.Vector3(...m.p), to: new THREE.Vector3(...m.p), fromRy: m.ry, toRy: m.ry,
          at: now, hp: -1, attacking: false, phase: Math.random() * 6, flashUntil: 0,
        };
        this.views.set(m.id, v);
        particles.emit({ at: m.p, count: 30, color: "#b48cff", color2: "#2a1050", speed: 3, life: 0.8, size: 0.3 });
      }
      v.from.copy(v.root.position);
      v.fromRy = v.root.rotation.y;
      v.to.set(...m.p);
      v.toRy = m.ry;
      v.at = now;
      if (m.hp !== v.hp) {
        if (v.hp >= 0 && m.hp < v.hp) v.flashUntil = now + 140;
        v.hp = m.hp;
        drawBar(v.bar, m.hp / (m.max ?? MONSTERS[m.kind].hp));
      }
      if (m.attacking && !v.attacking) this.growl(v);
      v.attacking = m.attacking;
    }
  }

  private growl(v: View): void {
    const at: [number, number, number] = [v.to.x, v.to.y, v.to.z];
    if (v.kind === "golem") sound.play(["mining0", "mining1"], { at, rate: 0.6 });
    else if (v.kind === "wolf") sound.fx("sting", { at, volume: 0.5, rate: 1.6 });
    else if (v.kind === "imp") sound.fx("charge", { at, volume: 0.5, rate: 1.8 }); // winding up a throw
    else sound.play("softHeavy", { at, rate: 1.4 });
  }

  // A monster went down.
  died(id: number): void {
    const v = this.views.get(id);
    if (!v) return;
    const color = v.kind === "slime" ? "#5ad16e" : v.kind === "wolf" ? "#6a5a9a" : v.kind === "imp" ? "#ff7a2e" : "#9a96aa";
    particles.emit({ at: v.root.position, count: 50, color, color2: "#ffffff", speed: 4, up: 1.5, life: 1, size: 0.3, gravity: 6 });
    sound.play(v.kind === "golem" ? "metalHeavy0" : "punchHeavy1", { at: [v.root.position.x, v.root.position.y, v.root.position.z] });
    // It keels over and shrinks away (see update) instead of vanishing.
    this.views.delete(id);
    this.dying.push({ v, at: performance.now(), y: v.root.position.y });
  }

  private dying: { v: View; at: number; y: number }[] = [];

  flash(id: number): boolean {
    const v = this.views.get(id);
    if (!v) return false;
    v.flashUntil = performance.now() + 140;
    return true;
  }

  // Where one is (for sounds), or null.
  positionOf(id: number): [number, number, number] | null {
    const v = this.views.get(id);
    return v ? [v.root.position.x, v.root.position.y, v.root.position.z] : null;
  }

  private remove(id: number, v: View): void {
    this.scene.remove(v.root);
    v.root.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Sprite) {
        o.geometry.dispose();
        const m = o.material as THREE.Material & { map?: THREE.Texture };
        m.map?.dispose();
        m.dispose();
      }
    });
    this.views.delete(id);
  }

  update(): void {
    const now = performance.now();
    this.dying = this.dying.filter((d) => {
      const k = (now - d.at) / 800;
      if (k >= 1) {
        this.remove(-1, d.v);
        return false;
      }
      d.v.root.rotation.z = Math.min(1, k * 2.5) * (Math.PI / 2) * 0.9; // over onto its side
      d.v.root.position.y = d.y - k * 0.6;
      d.v.root.scale.setScalar(1 - Math.max(0, k - 0.5) * 2);
      return true;
    });
    for (const v of this.views.values()) {
      const k = Math.min(1, (now - v.at) / LERP_MS);
      const before = v.root.position.clone();
      v.root.position.lerpVectors(v.from, v.to, k);
      let dr = v.toRy - v.fromRy;
      dr = Math.atan2(Math.sin(dr), Math.cos(dr));
      v.root.rotation.y = v.fromRy + dr * k;
      const speed = before.distanceTo(v.root.position) * 60;
      v.phase += Math.min(speed, 8) * 0.03 + 0.02;
      const s = Math.sin(v.phase * 3);
      if (v.kind === "imp") {
        // Hovering, wings beating; the fire in its hand swells as it winds up.
        v.body.position.y = Math.sin(now / 220 + v.phase) * 0.12;
        v.legs.forEach((w, i) => (w.rotation.y = (i ? 1 : -1) * (0.3 + Math.sin(now / 70) * 0.5)));
        v.body.getObjectByName("fire")?.scale.setScalar(v.attacking ? 1.8 + Math.sin(now / 40) * 0.3 : 1);
        if (Math.random() < 0.15) particles.emit({ at: [v.root.position.x, v.root.position.y + 0.1, v.root.position.z], count: 1, color: "#ffb347", color2: "#ff3a1a", speed: 0.4, up: 1, life: 0.5, size: 0.12, gravity: -1 });
      } else if (v.kind === "slime") {
        const hop = Math.abs(Math.sin(v.phase * 2.2));
        v.body.position.y = hop * 0.35 - 0.1;
        v.body.scale.set(1 + (1 - hop) * 0.15, 0.85 + hop * 0.25, 1 + (1 - hop) * 0.15);
      } else {
        v.legs.forEach((leg, i) => (leg.rotation.x = (i % 2 ? s : -s) * Math.min(1, speed / 3) * 0.7));
        v.body.position.y = v.kind === "golem" ? Math.abs(s) * 0.06 : Math.abs(s) * 0.05;
      }
      // Rearing back to strike.
      v.body.rotation.x = v.attacking ? 0.35 + Math.sin(now / 60) * 0.05 : 0;
      const red = now < v.flashUntil ? "#ff3030" : v.attacking ? "#5a1010" : "#000000";
      for (const m of v.mats) m.emissive.set(red);
    }
  }

  clear(): void {
    for (const [id, v] of this.views) this.remove(id, v);
    for (const d of this.dying) this.remove(-1, d.v);
    this.dying = [];
  }
}
