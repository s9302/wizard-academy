// Draws spells in flight and their explosions. The server decides what a
// spell hits; this only shows it.
//
// Game-dev note ("client-side prediction"): when you cast, waiting for the
// server's reply before drawing anything would feel sluggish, so your own
// spell appears the moment you click. When the server's copy arrives (same
// seq number), we keep the one we're already drawing. Everyone's spells are
// drawn at the server's clock, so what you see flying at you is where the
// server thinks it is.

import * as THREE from "three";
import { projectileAt, type SpellId, SPELLS } from "../../../shared/src/combat.ts";
import { segmentHitsLevel } from "../../../shared/src/levels/geometry.ts";
import type { Box } from "../../../shared/src/levels/types.ts";
import type { Vec3 } from "../../../shared/src/protocol.ts";
import type { ServerClock } from "../ServerClock.ts";

const TRAIL = 4; // ghost copies behind each spell
const BLAST_MS = 450;

type Flying = {
  spell: SpellId;
  o: Vec3;
  d: Vec3;
  start: number; // server time
  maxT: number; // seconds until it meets a wall (or runs out of range)
  group: THREE.Group;
};

// How long a projectile flies before it hits a wall, walking its path (which
// curves, for arrows) in short straight pieces.
function flightTime(spell: SpellId, o: Vec3, d: Vec3, boxes: Box[]): number {
  const def = SPELLS[spell];
  const end = def.range / def.speed;
  const dt = def.gravity ? 0.05 : end;
  for (let t = 0; t < end; t += dt) {
    const a = projectileAt(spell, o, d, t);
    const b = projectileAt(spell, o, d, Math.min(end, t + dt));
    const hit = segmentHitsLevel(a, b, boxes, 0.05);
    if (hit !== null) return t + hit * (Math.min(end, t + dt) - t);
  }
  return end;
}

// An arrow: a shaft, a tip and fletching, pointing along -Z.
function makeArrow(): THREE.Group {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.75), new THREE.MeshLambertMaterial({ color: "#c9a36b" }));
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.12, 4), new THREE.MeshLambertMaterial({ color: "#c9cdd6" }));
  tip.rotation.x = -Math.PI / 2;
  tip.position.z = -0.43;
  const feathers = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.01, 0.14), new THREE.MeshLambertMaterial({ color: "#e86f6f" }));
  feathers.position.z = 0.33;
  g.add(shaft, tip, feathers);
  return g;
}

type Blast = { mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>; start: number; size: number };

export class Spells {
  private scene: THREE.Scene;
  private clock: ServerClock;
  private boxes: Box[];
  private byId = new Map<number, Flying>();
  private mine = new Map<string, Flying>(); // my casts by "seq:k", until the server confirms
  private blasts: Blast[] = [];
  private geometry = new THREE.IcosahedronGeometry(1, 0);
  private materials: Record<SpellId, THREE.MeshBasicMaterial>;

  constructor(scene: THREE.Scene, clock: ServerClock, boxes: Box[]) {
    this.scene = scene;
    this.clock = clock;
    this.boxes = boxes;
    const glow = (color: string) => new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.materials = {
      arrow: glow(SPELLS.arrow.color),
      bolt: glow(SPELLS.bolt.color),
      frost: glow(SPELLS.frost.color),
      spark: glow(SPELLS.spark.color),
      fireball: glow(SPELLS.fireball.color),
    };
  }

  private create(spell: SpellId, o: Vec3, d: Vec3, start: number): Flying {
    const def = SPELLS[spell];
    const group = new THREE.Group();
    if (spell === "arrow") {
      group.add(makeArrow());
    } else {
      for (let i = 0; i <= TRAIL; i++) {
        const mesh = new THREE.Mesh(this.geometry, this.materials[spell]);
        const size = def.radius * (i === 0 ? 1 : 0.8 - i * 0.12);
        mesh.scale.setScalar(size);
        group.add(mesh);
      }
    }
    this.scene.add(group);
    const flying: Flying = { spell, o, d, start, maxT: flightTime(spell, o, d, this.boxes), group };
    this.place(flying, this.clock.now());
    return flying;
  }

  // I just cast this (drawn right away). Spark Volley is several projectiles,
  // numbered k like the server's.
  castLocal(seq: number, spell: SpellId, o: Vec3, dirs: Vec3[]): void {
    const now = this.clock.now();
    dirs.forEach((d, k) => this.mine.set(`${seq}:${k}`, this.create(spell, o, d, now)));
  }

  // The server says a spell is flying. mineKey: "seq:k" if it's my cast.
  started(id: number, spell: SpellId, o: Vec3, d: Vec3, time: number, mineKey: string | null): void {
    const local = mineKey !== null ? this.mine.get(mineKey) : undefined;
    if (local) {
      this.mine.delete(mineKey!);
      this.byId.set(id, local);
      return;
    }
    this.byId.set(id, this.create(spell, o, d, time));
  }

  // It hit something at p.
  ended(id: number, p: Vec3): void {
    const flying = this.byId.get(id);
    const spell = flying?.spell ?? "bolt";
    if (flying) this.remove(flying);
    this.byId.delete(id);
    const def = SPELLS[spell];
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), this.materials[spell].clone());
    mesh.position.set(...p);
    this.scene.add(mesh);
    this.blasts.push({ mesh, start: performance.now(), size: def.splashRadius ?? 0.9 });
  }

  // A puff of smoke (a Shadow Step's start and end).
  puff(p: Vec3, color = "#2b2140"): void {
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), material);
    mesh.position.set(...p);
    this.scene.add(mesh);
    this.blasts.push({ mesh, start: performance.now(), size: 1.1 });
  }

  private remove(flying: Flying): void {
    this.scene.remove(flying.group);
  }

  // Position along its path at server time `now`; hidden once past a wall.
  private place(flying: Flying, now: number): boolean {
    const def = SPELLS[flying.spell];
    const t = Math.max(0, (now - flying.start) / 1000);
    flying.group.children.forEach((mesh, i) => {
      const ti = Math.max(0, t - (i * def.radius * 1.4) / def.speed);
      mesh.visible = ti <= flying.maxT;
      mesh.position.set(...projectileAt(flying.spell, flying.o, flying.d, Math.min(ti, flying.maxT)));
      if (flying.spell === "arrow") {
        // Point along the direction of travel (it tips down as it falls).
        const ahead = projectileAt(flying.spell, flying.o, flying.d, Math.min(ti, flying.maxT) + 0.01);
        mesh.lookAt(...ahead);
        mesh.rotateY(Math.PI); // the model points along -Z; lookAt aims +Z
      }
    });
    return t <= def.range / def.speed + 0.5; // keep briefly for the server's verdict
  }

  setBoxes(boxes: Box[]): void {
    this.clear();
    this.boxes = boxes;
  }

  // Walls came or went: new spells stop at them (ones in flight carry on).
  setBoxesKeepFlying(boxes: Box[]): void {
    this.boxes = boxes;
  }

  update(): void {
    const now = this.clock.now();
    for (const [id, flying] of this.byId) {
      if (!this.place(flying, now)) {
        this.remove(flying);
        this.byId.delete(id);
      }
    }
    for (const [seq, flying] of this.mine) {
      // Never confirmed (the server refused it, e.g. on cooldown): drop it.
      if (!this.place(flying, now) || now - flying.start > 1500) {
        this.remove(flying);
        this.mine.delete(seq);
      }
    }
    const t = performance.now();
    this.blasts = this.blasts.filter((blast) => {
      const k = (t - blast.start) / BLAST_MS;
      if (k >= 1) {
        this.scene.remove(blast.mesh);
        blast.mesh.geometry.dispose();
        blast.mesh.material.dispose();
        return false;
      }
      blast.mesh.scale.setScalar(blast.size * (0.3 + 0.7 * Math.sqrt(k)));
      blast.mesh.material.opacity = 0.8 * (1 - k);
      return true;
    });
  }

  clear(): void {
    for (const f of [...this.byId.values(), ...this.mine.values()]) this.remove(f);
    this.byId.clear();
    this.mine.clear();
  }
}
