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
  wings: THREE.Object3D[]; // flap (the dragon's)
};

const LERP_MS = 110;
const FRIEND_TINT = "#4ab8ff"; // a beast on your side
const FOE_TINT = "#ff4a4a"; // another Druid's

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

function build(kind: MonsterKind): { body: THREE.Group; legs: THREE.Object3D[]; mats: THREE.MeshLambertMaterial[]; wings: THREE.Object3D[] } {
  const body = new THREE.Group();
  const legs: THREE.Object3D[] = [];
  const wings: THREE.Object3D[] = [];
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
  } else if (kind === "skeleton" || kind === "zombie") {
    // Two-legged: a skeleton (bones and a rusty sword) or a zombie (green
    // skin, a torn shirt, arms reaching out).
    const bone = kind === "skeleton";
    const skin = lambert(bone ? "#e6e0cc" : "#7fa36a");
    const cloth = lambert(bone ? "#e6e0cc" : "#5a6a7a");
    const pants = lambert(bone ? "#e6e0cc" : "#3e3a4a");
    // Torso: a ribcage of bars for the skeleton, a shirt for the zombie.
    if (bone) {
      add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.6, 0.06), skin)).position.set(0, 0.1, 0.05); // spine
      for (let i = 0; i < 4; i++) add(new THREE.Mesh(new THREE.BoxGeometry(0.4 - i * 0.05, 0.04, 0.24), skin)).position.set(0, 0.32 - i * 0.1, 0);
      add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.2), skin)).position.set(0, -0.22, 0); // pelvis
    } else {
      add(new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.55, 0.26), cloth)).position.set(0, 0.08, 0);
      add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.02), skin)).position.set(0.08, -0.05, -0.14); // a tear
    }
    const head = add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.3), skin));
    head.position.set(0, 0.56, 0);
    if (bone) {
      add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.04), lambert("#3a3530"))).position.set(0, 0.46, -0.15); // teeth
      eyes(body, 0.6, -0.16, 0.07, 0.05, "#1a1410");
    } else eyes(body, 0.6, -0.16, 0.07, 0.035, "#ff3a2a");
    for (const sx of [-1, 1]) {
      // Arms: the zombie's reach forward, the skeleton's hang (one holds a sword).
      const arm = new THREE.Group();
      arm.position.set(sx * 0.27, 0.3, 0);
      arm.rotation.x = bone ? 0 : -1.4;
      const m = new THREE.Mesh(new THREE.BoxGeometry(bone ? 0.07 : 0.12, 0.55, bone ? 0.07 : 0.12), skin);
      m.position.y = -0.27;
      m.castShadow = true;
      arm.add(m);
      if (bone && sx > 0) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.6, 0.015), lambert("#8a7a6a"));
        blade.position.set(0, -0.62, -0.22);
        blade.rotation.x = -1.2;
        arm.add(blade);
      }
      body.add(arm);
      legs.push(arm); // arms swing too
      const leg = new THREE.Group();
      leg.position.set(sx * 0.12, -0.25, 0);
      const lm = new THREE.Mesh(new THREE.BoxGeometry(bone ? 0.08 : 0.15, 0.68, bone ? 0.08 : 0.15), pants);
      lm.position.y = -0.34;
      lm.castShadow = true;
      leg.add(lm);
      body.add(leg);
      legs.push(leg);
    }
  } else if (kind === "witch") {
    // A witch riding her broom: a purple dress, green skin, a tall black hat
    // with a brim, and a hex glowing in her hand (it swells as she winds up).
    const dress = lambert("#4a2a6e");
    const skin = lambert("#8fc27a");
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 6), lambert("#7a5236"));
    stick.rotation.x = Math.PI / 2;
    stick.position.set(0, -0.35, 0.1);
    body.add(stick);
    const bristles = add(new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.45, 8), lambert("#c9a46a")));
    bristles.rotation.x = -Math.PI / 2;
    bristles.position.set(0, -0.35, 1.0);
    add(new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.7, 8), dress)).position.set(0, -0.05, 0.05);
    add(new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), skin)).position.set(0, 0.42, 0);
    const nose = add(new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.12, 4), skin));
    nose.position.set(0, 0.4, -0.18);
    nose.rotation.x = -Math.PI / 2;
    eyes(body, 0.46, -0.15, 0.06, 0.03, "#ffd23a");
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.03, 14), lambert("#1c1626"))).position.set(0, 0.56, 0); // brim
    const hat = add(new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.55, 10), lambert("#1c1626")));
    hat.position.set(0, 0.83, 0.03);
    hat.rotation.x = 0.2;
    for (const sx of [-1, 1]) {
      const leg = add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.35, 0.08), lambert("#1c1626")));
      leg.position.set(sx * 0.12, -0.45, -0.05);
    }
    const hex = new THREE.Mesh(new THREE.IcosahedronGeometry(0.11, 1), new THREE.MeshBasicMaterial({ color: "#d07bff", toneMapped: false }));
    hex.name = "fire";
    hex.position.set(0.3, 0.15, -0.3);
    body.add(hex);
  } else if (kind === "dragon") {
    // A red dragon in flight (its front is -z): a sleek body with gold belly
    // plates, a curving neck up to a wedge of a head (horns swept back, fire
    // in its jaws as it winds up), a long tail with a spade tip, legs tucked
    // up, and two big bat wings, bones and stretched membrane.
    const red = lambert("#a8241c");
    const gold = lambert("#e0a040");
    const dark = lambert("#5a1410");
    const bone = lambert("#efe6cc");
    const torso = add(new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 10), red));
    torso.scale.set(0.85, 0.7, 1.55);
    const belly = add(new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 8), gold));
    belly.scale.set(0.7, 0.5, 1.4);
    belly.position.set(0, -0.14, -0.02);
    // A bone between two points (a neck or tail segment, a wing spar).
    const between = (a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, m: THREE.Material, parent: THREE.Object3D = body) => {
      const len = a.distanceTo(b);
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, 7), m);
      seg.position.copy(a).lerp(b, 0.5);
      seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      seg.castShadow = true;
      if (m instanceof THREE.MeshLambertMaterial && !mats.includes(m)) mats.push(m);
      parent.add(seg);
      return seg;
    };
    // The neck: a curve up and forward.
    const neck = [new THREE.Vector3(0, 0.12, -0.75), new THREE.Vector3(0, 0.32, -1.15), new THREE.Vector3(0, 0.48, -1.52), new THREE.Vector3(0, 0.58, -1.9)];
    for (let i = 0; i < neck.length - 1; i++) between(neck[i], neck[i + 1], 0.27 - i * 0.04, 0.23 - i * 0.04, red);
    for (let i = 0; i < 3; i++) between(neck[i].clone().add(new THREE.Vector3(0, -0.12, -0.03)), neck[i + 1].clone().add(new THREE.Vector3(0, -0.12, -0.03)), 0.15, 0.13, gold); // throat plates
    // The head: skull, snout, jaw, horns, a brow ridge and eyes.
    const head = new THREE.Group();
    head.position.copy(neck[3]);
    head.rotation.x = 0.05;
    head.scale.setScalar(0.9);
    body.add(head);
    const part = (g: THREE.BufferGeometry, m: THREE.MeshLambertMaterial, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      if (!mats.includes(m)) mats.push(m);
      head.add(mesh);
      return mesh;
    };
    part(new THREE.BoxGeometry(0.38, 0.3, 0.42), red, 0, 0.05, -0.1);
    const snout = part(new THREE.BoxGeometry(0.28, 0.18, 0.46), red, 0, 0.0, -0.5);
    snout.scale.x = 0.9;
    part(new THREE.BoxGeometry(0.26, 0.08, 0.5), gold, 0, -0.14, -0.42); // the lower jaw
    part(new THREE.BoxGeometry(0.4, 0.06, 0.12), dark, 0, 0.2, -0.22); // brow
    for (const sx of [-1, 1]) {
      const horn = part(new THREE.ConeGeometry(0.06, 0.55, 5), bone, sx * 0.14, 0.26, 0.15);
      horn.rotation.x = 2.2; // swept back
      horn.rotation.z = -sx * 0.25;
      const small = part(new THREE.ConeGeometry(0.035, 0.22, 4), bone, sx * 0.2, 0.1, 0.12);
      small.rotation.x = 2.0;
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 4), new THREE.MeshBasicMaterial({ color: "#ffc93a", toneMapped: false }));
      eye.position.set(sx * 0.15, 0.12, -0.28);
      head.add(eye);
      part(new THREE.BoxGeometry(0.04, 0.04, 0.04), dark, sx * 0.07, 0.07, -0.73); // nostril
    }
    const fire = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 1), new THREE.MeshBasicMaterial({ color: "#ffb347", toneMapped: false }));
    fire.name = "fire";
    fire.position.set(0, -0.06, -0.8);
    fire.scale.setScalar(0.3);
    head.add(fire);
    // Spines down the back.
    for (let i = 0; i < 6; i++) {
      const sp = add(new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.22 - i * 0.02, 4), dark));
      sp.position.set(0, 0.42 - i * 0.02, -0.55 + i * 0.25);
      sp.rotation.x = 0.5;
    }
    // The tail: tapering segments with a gentle curve, and a spade at the tip.
    const tail = [new THREE.Vector3(0, 0, 0.85), new THREE.Vector3(0, -0.05, 1.45), new THREE.Vector3(0, -0.02, 2.0), new THREE.Vector3(0, 0.08, 2.5), new THREE.Vector3(0, 0.2, 2.95)];
    for (let i = 0; i < tail.length - 1; i++) between(tail[i], tail[i + 1], 0.26 - i * 0.055, 0.21 - i * 0.05, red);
    const spade = add(new THREE.Mesh(new THREE.OctahedronGeometry(0.2), dark));
    spade.position.copy(tail[4]).add(new THREE.Vector3(0, 0.04, 0.15));
    spade.scale.set(1, 0.25, 1.4);
    // Legs, tucked up under the body while it flies.
    for (const [x, z, k] of [[-0.35, -0.45, 0.8], [0.35, -0.45, 0.8], [-0.35, 0.5, 1], [0.35, 0.5, 1]] as const) {
      const leg = new THREE.Group();
      leg.position.set(x, -0.3, z);
      leg.rotation.x = 1.1;
      const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.45 * k, 0.22), red);
      thigh.position.y = -0.2 * k;
      thigh.castShadow = true;
      const claw = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.2), dark);
      claw.position.set(0, -0.44 * k, -0.06);
      leg.add(thigh, claw);
      body.add(leg);
    }
    // Wings: an arm (shoulder, elbow, wrist), three fingers fanning back,
    // and the membrane stretched between them and the body.
    const sail = new THREE.MeshLambertMaterial({ color: "#6e1a14", flatShading: true, side: THREE.DoubleSide });
    mats.push(sail);
    for (const sx of [-1, 1]) {
      const wing = new THREE.Group();
      wing.position.set(sx * 0.38, 0.3, -0.35);
      wing.scale.x = sx; // the left wing is the right one, mirrored
      const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
      const S = V(0, 0, 0);
      const E = V(0.95, 0.3, 0.05);
      const W = V(1.8, 0.42, -0.12);
      const F = [V(2.9, 0.15, 0.45), V(2.45, 0.0, 1.15), V(1.65, -0.05, 1.55)];
      const B = V(0.15, -0.05, 1.05);
      between(S, E, 0.08, 0.07, dark, wing);
      between(E, W, 0.07, 0.05, dark, wing);
      for (const f of F) between(W, f, 0.04, 0.02, dark, wing);
      const claw = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.16, 4), bone);
      claw.position.copy(W).add(V(0, 0.08, -0.05));
      wing.add(claw);
      const tris = [W, F[0], F[1], W, F[1], F[2], W, F[2], E, E, F[2], B, E, B, S];
      const g = new THREE.BufferGeometry().setFromPoints(tris);
      g.computeVertexNormals();
      const membrane = new THREE.Mesh(g, sail);
      membrane.castShadow = true;
      wing.add(membrane);
      body.add(wing);
      wings.push(wing);
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
  return { body, legs, mats, wings };
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

  // isFriend: is this player (a Druid) you or on your team?
  private isFriend: (owner: number) => boolean;

  constructor(scene: THREE.Scene, isFriend: (owner: number) => boolean = () => false) {
    this.scene = scene;
    this.isFriend = isFriend;
  }

  // The server's latest list.
  set(list: MonsterState[]): void {
    const now = performance.now();
    const keep = new Set(list.map((m) => m.id));
    for (const [id, v] of this.views) if (!keep.has(id)) this.remove(id, v);
    for (const m of list) {
      let v = this.views.get(m.id);
      if (!v) {
        const { body, legs, mats, wings } = build(m.kind);
        const root = new THREE.Group();
        root.add(body);
        const bar = healthBar();
        bar.position.y = MONSTERS[m.kind].height + 0.7;
        root.add(bar);
        if (m.owner !== undefined) {
          // A Druid's beast takes on a color: blue if it's on your side (yours
          // or a teammate's), red if it's someone else's.
          const tint = new THREE.Color(this.isFriend(m.owner) ? FRIEND_TINT : FOE_TINT);
          const seen = new Set<THREE.Material>();
          body.traverse((o) => {
            const mat = (o as THREE.Mesh).material;
            if (!(mat instanceof THREE.MeshLambertMaterial) || seen.has(mat)) return;
            seen.add(mat);
            mat.color.lerp(tint, 0.65);
          });
        }
        root.position.set(...m.p);
        this.scene.add(root);
        v = {
          kind: m.kind, root, body, legs, mats, bar,
          from: new THREE.Vector3(...m.p), to: new THREE.Vector3(...m.p), fromRy: m.ry, toRy: m.ry,
          at: now, hp: -1, attacking: false, phase: Math.random() * 6, flashUntil: 0, wings,
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
    else if (v.kind === "imp" || v.kind === "witch") sound.fx("charge", { at, volume: 0.5, rate: v.kind === "witch" ? 1.3 : 1.8 }); // winding up a throw
    else if (v.kind === "dragon") sound.fx("rumble", { at, volume: 0.8, rate: 1.3 });
    else if (v.kind === "skeleton") sound.play(["mining0", "mining1"], { at, rate: 1.6, volume: 0.6 });
    else sound.play("softHeavy", { at, rate: 1.4 });
  }

  // A monster went down.
  died(id: number): void {
    const v = this.views.get(id);
    if (!v) return;
    const color = { slime: "#5ad16e", wolf: "#6a5a9a", imp: "#ff7a2e", golem: "#9a96aa", skeleton: "#e6e0cc", zombie: "#7fa36a", witch: "#c05bff", dragon: "#ff5a1a" }[v.kind];
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
      d.v.root.position.y = d.y - Math.min(1, k * 2) * (MONSTERS[d.v.kind].fly ?? 0) - k * 0.6; // fliers fall out of the sky first
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
      if (v.kind === "witch") {
        // Riding the broom: a slow bob and sway; the hex swells as she winds up.
        v.body.position.y = Math.sin(now / 400 + v.phase) * 0.15;
        v.body.rotation.z = Math.sin(now / 700 + v.phase) * 0.08;
        v.body.getObjectByName("fire")?.scale.setScalar(v.attacking ? 2 + Math.sin(now / 40) * 0.3 : 1);
        if (Math.random() < 0.12) particles.emit({ at: [v.root.position.x, v.root.position.y - 0.3, v.root.position.z], count: 1, color: "#d07bff", color2: "#4a2a6e", speed: 0.3, life: 0.6, size: 0.12, gravity: 0.5 });
      } else if (v.kind === "imp") {
        // Hovering, wings beating; the fire in its hand swells as it winds up.
        v.body.position.y = Math.sin(now / 220 + v.phase) * 0.12;
        v.legs.forEach((w, i) => (w.rotation.y = (i ? 1 : -1) * (0.3 + Math.sin(now / 70) * 0.5)));
        v.body.getObjectByName("fire")?.scale.setScalar(v.attacking ? 1.8 + Math.sin(now / 40) * 0.3 : 1);
        if (Math.random() < 0.15) particles.emit({ at: [v.root.position.x, v.root.position.y + 0.1, v.root.position.z], count: 1, color: "#ffb347", color2: "#ff3a1a", speed: 0.4, up: 1, life: 0.5, size: 0.12, gravity: -1 });
      } else if (v.kind === "slime") {
        const hop = Math.abs(Math.sin(v.phase * 2.2));
        v.body.position.y = hop * 0.35 - 0.1;
        v.body.scale.set(1 + (1 - hop) * 0.15, 0.85 + hop * 0.25, 1 + (1 - hop) * 0.15);
      } else if (v.kind === "dragon") {
        // Flying: a slow rise and fall with each beat of the wings.
        v.body.position.y = Math.sin(now / 260 + v.phase) * 0.18;
      } else {
        v.legs.forEach((leg, i) => (leg.rotation.x = (i % 2 ? s : -s) * Math.min(1, speed / 3) * 0.7));
        v.body.position.y = v.kind === "golem" ? Math.abs(s) * 0.06 : Math.abs(s) * 0.05;
      }
      if (v.wings.length) {
        const flap = Math.sin(now / (v.attacking ? 110 : 260) + v.phase) * 0.55 - 0.05;
        v.wings.forEach((w, i) => (w.rotation.z = i ? -flap : flap));
      }
      if (v.kind === "dragon") {
        const fire = v.body.getObjectByName("fire");
        if (fire) fire.scale.setScalar(v.attacking ? 1.6 + Math.sin(now / 40) * 0.3 : 0.3);
        if (v.attacking && Math.random() < 0.5) particles.emit({ at: fire!.getWorldPosition(new THREE.Vector3()).toArray() as [number, number, number], count: 1, color: "#ffb347", color2: "#ff3a1a", speed: 0.6, up: 1, life: 0.4, size: 0.2 });
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
