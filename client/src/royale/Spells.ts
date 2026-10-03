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
import { type SpellId, SPELLS } from "../../../shared/src/combat.ts";
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
  maxDist: number; // where it meets a wall (or runs out of range)
  group: THREE.Group;
};

type Blast = { mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>; start: number; size: number };

export class Spells {
  private scene: THREE.Scene;
  private clock: ServerClock;
  private boxes: Box[];
  private byId = new Map<number, Flying>();
  private mine = new Map<number, Flying>(); // my casts by seq, until the server confirms
  private blasts: Blast[] = [];
  private geometry = new THREE.IcosahedronGeometry(1, 0);
  private materials: Record<SpellId, THREE.MeshBasicMaterial>;

  constructor(scene: THREE.Scene, clock: ServerClock, boxes: Box[]) {
    this.scene = scene;
    this.clock = clock;
    this.boxes = boxes;
    const glow = (color: string) => new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.materials = { bolt: glow(SPELLS.bolt.color), fireball: glow(SPELLS.fireball.color) };
  }

  private create(spell: SpellId, o: Vec3, d: Vec3, start: number): Flying {
    const def = SPELLS[spell];
    const end: Vec3 = [o[0] + d[0] * def.range, o[1] + d[1] * def.range, o[2] + d[2] * def.range];
    const t = segmentHitsLevel(o, end, this.boxes, 0.05);
    const group = new THREE.Group();
    for (let i = 0; i <= TRAIL; i++) {
      const mesh = new THREE.Mesh(this.geometry, this.materials[spell]);
      const size = def.radius * (i === 0 ? 1 : 0.8 - i * 0.12);
      mesh.scale.setScalar(size);
      group.add(mesh);
    }
    this.scene.add(group);
    const flying: Flying = { spell, o, d, start, maxDist: (t ?? 1) * def.range, group };
    this.place(flying, this.clock.now());
    return flying;
  }

  // I just cast this (drawn right away).
  castLocal(seq: number, spell: SpellId, o: Vec3, d: Vec3): void {
    this.mine.set(seq, this.create(spell, o, d, this.clock.now()));
  }

  // The server says a spell is flying.
  started(id: number, spell: SpellId, o: Vec3, d: Vec3, time: number, mineSeq: number | null): void {
    const local = mineSeq !== null ? this.mine.get(mineSeq) : undefined;
    if (local) {
      this.mine.delete(mineSeq!);
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

  private remove(flying: Flying): void {
    this.scene.remove(flying.group);
  }

  // Position along the line at server time `now`; hidden once past a wall.
  private place(flying: Flying, now: number): boolean {
    const def = SPELLS[flying.spell];
    const dist = def.speed * Math.max(0, (now - flying.start) / 1000);
    flying.group.children.forEach((mesh, i) => {
      const along = Math.max(0, dist - i * def.radius * 1.4);
      mesh.visible = along <= flying.maxDist;
      mesh.position.set(flying.o[0] + flying.d[0] * along, flying.o[1] + flying.d[1] * along, flying.o[2] + flying.d[2] * along);
    });
    return dist <= def.range + def.speed * 0.5; // keep briefly for the server's verdict
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
