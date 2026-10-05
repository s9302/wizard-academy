// Draws a boss and everything it throws: the model (moved smoothly between
// server updates), its health bar, boulders and orbs, shockwave rings, and
// the marked circles of lightning, meteors and the Tyrant's leaps. Used by
// the trials with a boss (trials/Trial.ts) and by Trial VII's boss fight
// (Game.ts, alongside the battle royale's combat).

import * as THREE from "three";
import { BOSSES, type BossKind, type BossShot, bossShotAt, SHOT_RANGE, STRIKE_DELAY_MS, STRIKE_RADIUS, type StrikeKind, TYRANT, WAVE_RANGE, WAVE_SPEED } from "../../../shared/src/bosses.ts";
import type { ServerMsg, Vec3 } from "../../../shared/src/protocol.ts";
import { sound } from "../audio/Sound.ts";
import { particles } from "../graphics/Particles.ts";
import { quality } from "../quality.ts";
import type { ServerClock } from "../ServerClock.ts";

export const glowMat = (color: string, k = 2.2): THREE.MeshBasicMaterial => {
  const m = new THREE.MeshBasicMaterial({ color, toneMapped: false });
  if (quality() === "ultra") m.color.multiplyScalar(k);
  return m;
};

// ---- Boss models (positions relative to the body's center) ----

type Model = { root: THREE.Group; mats: THREE.MeshLambertMaterial[]; arms: THREE.Object3D[]; legs: THREE.Object3D[]; wings: THREE.Object3D[] };

function bossModel(kind: BossKind): Model {
  const root = new THREE.Group();
  const mats: THREE.MeshLambertMaterial[] = [];
  const arms: THREE.Object3D[] = [];
  const legs: THREE.Object3D[] = [];
  const wings: THREE.Object3D[] = [];
  const lam = (color: string, opts: THREE.MeshLambertMaterialParameters = {}) => {
    const m = new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts });
    mats.push(m);
    return m;
  };
  const add = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = root) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };
  if (kind === "golem") {
    const stone = lam("#8a8698");
    const dark = lam("#5f5a70");
    const moss = lam("#5a7d45");
    add(new THREE.BoxGeometry(2.6, 2.2, 1.7), stone, 0, 0.2, 0);
    add(new THREE.BoxGeometry(2.7, 0.4, 1.8), moss, 0, 1.35, 0);
    add(new THREE.BoxGeometry(1.2, 1.0, 1.0), dark, 0, 1.9, -0.2);
    for (const s of [-1, 1]) {
      const e = add(new THREE.SphereGeometry(0.12, 6, 4), glowMat("#ffb347", 3), s * 0.28, 1.95, -0.72);
      e.castShadow = false;
      const arm = new THREE.Group();
      arm.position.set(s * 1.7, 1.0, 0);
      add(new THREE.BoxGeometry(0.8, 2.2, 0.8), stone, 0, -1.0, 0, arm);
      add(new THREE.BoxGeometry(1.0, 0.7, 1.0), dark, 0, -2.3, 0, arm);
      root.add(arm);
      arms.push(arm);
      add(new THREE.BoxGeometry(0.9, 1.2, 0.9), dark, s * 0.7, -1.5, 0);
    }
    add(new THREE.OctahedronGeometry(0.35), glowMat("#ffb347", 3), 0, 0.4, -0.9).castShadow = false;
  } else if (kind === "wraith") {
    const robe = lam("#2a2050", { transparent: true, opacity: 0.88 });
    const body = add(new THREE.ConeGeometry(1.3, 3.6, 10, 1, true), robe, 0, -0.4, 0);
    (body.material as THREE.MeshLambertMaterial).side = THREE.DoubleSide;
    add(new THREE.SphereGeometry(0.7, 12, 8), lam("#1a1238"), 0, 1.6, 0);
    const hood = add(new THREE.ConeGeometry(0.85, 1.4, 10), robe, 0, 2.2, 0.1);
    hood.rotation.x = -0.2;
    for (const s of [-1, 1]) add(new THREE.SphereGeometry(0.11, 6, 4), glowMat("#8fe3ff", 3.5), s * 0.24, 1.65, -0.6).castShadow = false;
    for (const s of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(s * 0.9, 1.0, 0);
      const a = add(new THREE.ConeGeometry(0.28, 1.8, 6), robe, 0, -0.8, 0, arm);
      a.rotation.z = s * 0.3;
      add(new THREE.OctahedronGeometry(0.18), glowMat("#c58fff", 3), 0, -1.7, 0, arm).castShadow = false;
      root.add(arm);
      arms.push(arm);
    }
  } else if (kind === "wyrm") {
    // The Frost Wyrm: a pale blue dragon, front -z. A long body, a neck and
    // horned head ahead, a tapering tail behind, and two big wings.
    const scale = lam("#9cc8e0");
    const belly = lam("#e2f4ff");
    const dark = lam("#4f7894");
    const ice = glowMat("#bff4ff", 3);
    add(new THREE.BoxGeometry(2.0, 1.6, 4.2), scale, 0, 0, 0);
    add(new THREE.BoxGeometry(1.6, 0.4, 3.6), belly, 0, -0.8, 0);
    // Neck and head.
    const neck = add(new THREE.BoxGeometry(0.9, 0.9, 2.2), scale, 0, 0.6, -2.8);
    neck.rotation.x = 0.45;
    add(new THREE.BoxGeometry(1.2, 0.9, 1.6), scale, 0, 1.3, -4.1);
    add(new THREE.BoxGeometry(0.9, 0.4, 1.0), belly, 0, 0.95, -4.6); // the jaw
    for (const sx of [-1, 1]) {
      add(new THREE.SphereGeometry(0.13, 6, 4), ice, sx * 0.4, 1.5, -4.85).castShadow = false;
      const horn = add(new THREE.ConeGeometry(0.14, 0.9, 5), belly, sx * 0.4, 2.0, -3.6);
      horn.rotation.x = 0.7;
    }
    // Spines down the back, and the tail.
    for (let i = 0; i < 6; i++) add(new THREE.ConeGeometry(0.18, 0.6, 4), ice, 0, 1.0, -1.6 + i * 0.7).castShadow = false;
    for (let i = 0; i < 4; i++) {
      const w = 1.2 - i * 0.25;
      add(new THREE.BoxGeometry(w, w * 0.8, 1.4), i % 2 ? dark : scale, 0, -0.1 - i * 0.12, 2.6 + i * 1.25);
    }
    add(new THREE.ConeGeometry(0.4, 1.2, 4), ice, 0, -0.55, 7.8).rotation.x = Math.PI / 2;
    // Legs, tucked under (they swing a little when it walks).
    for (const [x, z] of [[-0.9, -1.3], [0.9, -1.3], [-0.9, 1.4], [0.9, 1.4]]) {
      const leg = new THREE.Group();
      leg.position.set(x, -0.7, z);
      add(new THREE.BoxGeometry(0.5, 1.4, 0.6), dark, 0, -0.6, 0, leg);
      root.add(leg);
      legs.push(leg);
    }
    // Wings: a bony arm along x and a sail of thin membrane hanging off it.
    const sail = lam("#7fb2d6", { transparent: true, opacity: 0.85, side: THREE.DoubleSide });
    for (const sx of [-1, 1]) {
      const wing = new THREE.Group();
      wing.position.set(sx * 1.0, 0.6, -0.6);
      add(new THREE.BoxGeometry(5.5, 0.25, 0.3), dark, sx * 2.75, 0, 0, wing);
      const membrane = add(new THREE.BoxGeometry(5.3, 0.05, 3.2), sail, sx * 2.75, -0.05, 1.6, wing);
      membrane.castShadow = false;
      for (let i = 1; i <= 3; i++) add(new THREE.BoxGeometry(0.12, 0.12, 3.2), dark, sx * i * 1.6, 0, 1.6, wing);
      root.add(wing);
      wings.push(wing);
    }
  } else if (kind === "lich") {
    // The Lich Sovereign: a floating skeletal king in tattered violet robes,
    // a crown of bone, glowing eyes, and a staff topped with a soul gem.
    const robe = lam("#3a2458", { transparent: true, opacity: 0.92 });
    const trim = lam("#c9a227");
    const bone = lam("#e6e0cc");
    const body = add(new THREE.ConeGeometry(1.1, 3.2, 10, 1, true), robe, 0, -0.6, 0);
    (body.material as THREE.MeshLambertMaterial).side = THREE.DoubleSide;
    add(new THREE.CylinderGeometry(0.75, 0.9, 0.2, 10), trim, 0, 0.9, 0);
    add(new THREE.BoxGeometry(1.6, 0.5, 0.9), robe, 0, 1.2, 0); // shoulders
    // The skull and its crown.
    add(new THREE.BoxGeometry(0.7, 0.75, 0.75), bone, 0, 1.85, -0.05);
    add(new THREE.BoxGeometry(0.5, 0.25, 0.45), bone, 0, 1.45, -0.18); // the jaw
    for (const sx of [-1, 1]) add(new THREE.SphereGeometry(0.1, 6, 4), glowMat("#b48cff", 4), sx * 0.17, 1.9, -0.44).castShadow = false;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      add(new THREE.ConeGeometry(0.08, 0.45, 4), bone, Math.cos(a) * 0.38, 2.4, Math.sin(a) * 0.38 - 0.05);
    }
    // A collar of floating soul gems.
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      add(new THREE.OctahedronGeometry(0.12), glowMat("#9a7bff", 3), Math.cos(a) * 1.1, 1.4, Math.sin(a) * 1.1).castShadow = false;
    }
    // Arms: bony hands out of wide sleeves; the right holds the staff.
    for (const sx of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(sx * 0.85, 1.2, 0);
      const sleeve = add(new THREE.ConeGeometry(0.3, 1.3, 6, 1, true), robe, 0, -0.6, 0, arm);
      sleeve.rotation.z = sx * 0.2;
      add(new THREE.BoxGeometry(0.2, 0.3, 0.2), bone, 0, -1.3, 0, arm);
      if (sx === 1) {
        add(new THREE.CylinderGeometry(0.06, 0.06, 3.4, 6), lam("#2a2030"), 0, -0.9, -0.2, arm);
        add(new THREE.OctahedronGeometry(0.3), glowMat("#b48cff", 4), 0, 0.95, -0.2, arm).castShadow = false;
      } else {
        add(new THREE.IcosahedronGeometry(0.2, 0), glowMat("#9a7bff", 3), 0, -1.55, -0.1, arm).castShadow = false;
      }
      root.add(arm);
      arms.push(arm);
    }
  } else {
    // The Storm Tyrant: a 6 m giant in storm-dark armor with a gold crown,
    // a glowing core, and a maul in its right hand. Its front is -z.
    const armor = lam("#3d3a52");
    const plate = lam("#5b5876");
    const gold = lam("#d9a72b");
    const cloth = lam("#5a2340");
    // Legs (hips at y -0.6; feet reach the floor at -3).
    for (const s of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(s * 0.75, -0.6, 0);
      add(new THREE.BoxGeometry(0.85, 1.4, 0.9), armor, 0, -0.65, 0, leg);
      add(new THREE.BoxGeometry(0.75, 1.1, 0.8), plate, 0, -1.75, 0, leg);
      add(new THREE.BoxGeometry(0.95, 0.35, 1.25), armor, 0, -2.25, -0.15, leg);
      root.add(leg);
      legs.push(leg);
    }
    // Body: a belted torso, a tattered tabard, broad pauldrons.
    add(new THREE.BoxGeometry(2.4, 0.5, 1.4), gold, 0, -0.45, 0);
    add(new THREE.BoxGeometry(2.6, 2.0, 1.6), armor, 0, 0.75, 0);
    add(new THREE.BoxGeometry(1.4, 1.8, 0.1), cloth, 0, -0.9, -0.78);
    add(new THREE.BoxGeometry(2.0, 1.1, 0.25), plate, 0, 1.1, -0.85);
    add(new THREE.OctahedronGeometry(0.4), glowMat("#8fe3ff", 3.5), 0, 0.85, -1.05).castShadow = false;
    // Head and crown.
    add(new THREE.BoxGeometry(1.1, 1.0, 1.1), plate, 0, 2.3, -0.1);
    add(new THREE.BoxGeometry(0.9, 0.12, 0.05), glowMat("#8fe3ff", 4), 0, 2.32, -0.68).castShadow = false;
    add(new THREE.CylinderGeometry(0.66, 0.62, 0.3, 10, 1, true), gold, 0, 2.95, -0.1);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      add(new THREE.ConeGeometry(0.13, 0.55, 4), gold, Math.cos(a) * 0.62, 3.35, Math.sin(a) * 0.62 - 0.1);
    }
    // Arms: pauldron, arm, gauntlet; the right one holds the maul.
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(1.2, 0.7, 1.4), plate, s * 1.65, 1.75, 0);
      const arm = new THREE.Group();
      arm.position.set(s * 1.7, 1.4, 0);
      add(new THREE.BoxGeometry(0.7, 1.6, 0.75), armor, 0, -0.8, 0, arm);
      add(new THREE.BoxGeometry(0.85, 0.8, 0.9), plate, 0, -1.9, 0, arm);
      if (s === 1) {
        add(new THREE.CylinderGeometry(0.12, 0.12, 3.4, 6), lam("#6b4a30"), 0, -2.1, -1.2, arm).rotation.x = Math.PI / 2;
        add(new THREE.BoxGeometry(1.3, 1.1, 1.1), armor, 0, -2.1, -2.9, arm);
        add(new THREE.BoxGeometry(1.36, 0.25, 1.16), gold, 0, -2.1, -2.9, arm);
      }
      root.add(arm);
      arms.push(arm);
    }
  }
  return { root, mats, arms, legs, wings };
}

type Flying = { shot: BossShot; mesh: THREE.Mesh };
type WaveView = { mesh: THREE.Mesh; start: number };
type StrikeView = { marker: THREE.Mesh; at: number; p: Vec3; r: number; kind: StrikeKind; struck: boolean; effect: THREE.Mesh | null; delay: number };

const STRIKE_COLOR: Record<StrikeKind, string> = { lightning: "#ff4a3d", leap: "#ff8a2a", meteor: "#ffb347" };
const STRIKE_DELAY: Record<StrikeKind, number> = { lightning: STRIKE_DELAY_MS, leap: TYRANT.leapDelayMs, meteor: TYRANT.meteorDelayMs };

export class BossView {
  readonly kind: BossKind;
  private scene: THREE.Scene;
  private clock: ServerClock;
  private model: Model;
  private bar: HTMLElement;
  private fill: HTMLElement;
  private from = new THREE.Vector3();
  private to = new THREE.Vector3();
  private at = 0;
  private ry = 0;
  private state: "sleep" | "fight" | "dead" = "sleep";
  private windup = false;
  private hp = 0;
  private flashUntil = 0;
  private stride = 0;
  private shots = new Map<number, Flying>();
  private waves: WaveView[] = [];
  private strikes: StrikeView[] = [];

  constructor(scene: THREE.Scene, hud: HTMLElement, clock: ServerClock, kind: BossKind, home: Vec3) {
    this.scene = scene;
    this.clock = clock;
    this.kind = kind;
    this.model = bossModel(kind);
    this.model.root.position.set(...home);
    this.from.set(...home);
    this.to.set(...home);
    scene.add(this.model.root);
    this.bar = document.createElement("div");
    this.bar.id = "boss-bar";
    this.bar.hidden = true;
    const name = document.createElement("div");
    name.className = "boss-name";
    name.textContent = BOSSES[kind].name;
    const track = document.createElement("div");
    track.className = "boss-track";
    this.fill = document.createElement("div");
    this.fill.className = "boss-fill";
    track.appendChild(this.fill);
    this.bar.append(name, track);
    hud.appendChild(this.bar);
  }

  get fighting(): boolean {
    return this.state === "fight";
  }

  // Returns true if it was a boss message.
  onMessage(msg: ServerMsg): boolean {
    switch (msg.t) {
      case "boss": {
        this.from.copy(this.model.root.position);
        this.to.set(...msg.p);
        this.at = performance.now();
        // The Lich blinks: a puff where it was and where it is, no sliding.
        if (this.kind === "lich" && this.from.distanceTo(this.to) > 4 && msg.state === "fight") {
          for (const at of [this.from, this.to]) particles.emit({ at: [at.x, at.y, at.z], count: 40, color: "#b48cff", color2: "#1a0830", speed: 4, life: 0.7, size: 0.3 });
          sound.fx("blink", { at: msg.p });
          this.from.copy(this.to);
        }
        this.ry = msg.ry;
        if (msg.hp < this.hp && msg.state === "fight") this.flashUntil = performance.now() + 120;
        if (msg.state === "dead" && this.state !== "dead") {
          particles.emit({ at: msg.p, count: 160, color: BOSSES[msg.kind].color, color2: "#ffffff", speed: 7, up: 2, life: 1.6, size: 0.4, gravity: 4 });
          sound.fx("explosion");
          sound.fx("victory");
        }
        if (msg.state === "fight" && this.state === "sleep") sound.fx("sting", { rate: 0.6 });
        if (msg.windup && !this.windup) sound.fx("charge", { at: msg.p, rate: 0.6 });
        this.state = msg.state;
        this.windup = msg.windup;
        this.hp = msg.hp;
        this.model.root.visible = msg.state !== "dead";
        this.fill.style.width = `${(100 * msg.hp) / Math.max(1, msg.max)}%`;
        return true;
      }
      case "bossShot": {
        const s = msg.shot;
        const mesh = new THREE.Mesh(
          s.kind === "rock" ? new THREE.DodecahedronGeometry(s.radius, 0) : new THREE.IcosahedronGeometry(s.radius, 1),
          s.kind === "rock" ? new THREE.MeshLambertMaterial({ color: "#7d7890", flatShading: true }) : glowMat("#c58fff", 2.8),
        );
        mesh.castShadow = true;
        mesh.position.set(...s.o);
        this.scene.add(mesh);
        this.shots.set(s.id, { shot: s, mesh });
        sound.fx(s.kind === "rock" ? "heavySwing" : "bolt", { at: s.o, rate: s.kind === "rock" ? 0.6 : 0.7 });
        return true;
      }
      case "bossShotEnd": {
        const f = this.shots.get(msg.id);
        if (f) {
          this.scene.remove(f.mesh);
          f.mesh.geometry.dispose();
          this.shots.delete(msg.id);
          particles.emit({ at: msg.p, count: 18, color: f.shot.kind === "rock" ? "#9a96aa" : "#c58fff", speed: 3, life: 0.5, size: 0.2, gravity: f.shot.kind === "rock" ? 8 : 0 });
          sound.play(f.shot.kind === "rock" ? "mining1" : "glass", { at: msg.p, volume: 0.7 });
        }
        return true;
      }
      case "bossWave": {
        const color = { wraith: "#8fe3ff", tyrant: "#ffcf5a", golem: "#ffb347", wyrm: "#bff4ff", lich: "#9a7bff" }[this.kind];
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.18, 6, 48), glowMat(color, 2.5));
        ring.rotation.x = Math.PI / 2;
        ring.position.set(msg.o[0], msg.o[1] + 0.25, msg.o[2]);
        this.scene.add(ring);
        this.waves.push({ mesh: ring, start: msg.time });
        sound.fx("rumble", { at: msg.o });
        sound.play("softHeavy", { at: msg.o });
        if (this.kind === "tyrant") particles.emit({ at: msg.o, count: 40, color: "#9a96aa", color2: "#ffcf5a", speed: 6, up: 3, life: 0.8, size: 0.3, gravity: 9 });
        return true;
      }
      case "bossStrike": {
        const kind = msg.kind ?? "lightning";
        const r = msg.r ?? STRIKE_RADIUS;
        const marker = new THREE.Mesh(
          new THREE.RingGeometry(r - 0.25, r, 40),
          new THREE.MeshBasicMaterial({ color: STRIKE_COLOR[kind], transparent: true, opacity: 0.8, side: THREE.DoubleSide, toneMapped: false }),
        );
        marker.rotation.x = -Math.PI / 2;
        marker.position.set(msg.p[0], msg.p[1] + 0.05, msg.p[2]);
        // A faint fill, so a big circle reads as an area, not just a line.
        const fill = new THREE.Mesh(
          new THREE.CircleGeometry(r - 0.25, 40),
          new THREE.MeshBasicMaterial({ color: STRIKE_COLOR[kind], transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
        );
        marker.add(fill);
        this.scene.add(marker);
        this.strikes.push({ marker, at: msg.at, p: msg.p, r, kind, struck: false, effect: null, delay: STRIKE_DELAY[kind] });
        return true;
      }
      default:
        return false;
    }
  }

  update(time: number): void {
    const now = performance.now();
    const serverNow = this.clock.now();
    const m = this.model;
    if (this.state !== "dead") {
      const k = Math.min(1, (now - this.at) / 110);
      const before = m.root.position.clone();
      m.root.position.lerpVectors(this.from, this.to, k);
      let dr = this.ry - m.root.rotation.y;
      dr = Math.atan2(Math.sin(dr), Math.cos(dr));
      m.root.rotation.y += dr * 0.2;
      const swing = this.windup ? Math.sin(now / 80) * 0.25 - 0.9 : Math.sin(time * 2) * 0.15;
      m.arms.forEach((a, i) => (a.rotation.x = i % 2 ? swing : -swing * (this.windup ? -1 : 1)));
      // Walking: legs swing with the distance covered on the ground.
      const step = Math.hypot(m.root.position.x - before.x, m.root.position.z - before.z);
      this.stride += step * 0.9;
      const airborne = m.root.position.y - this.to.y > 0.5 || this.from.y - this.to.y > 0.5;
      m.legs.forEach((l, i) => (l.rotation.x = airborne ? (i ? -0.5 : 0.4) : Math.sin(this.stride + i * Math.PI) * Math.min(0.6, step * 20)));
      const red = now < this.flashUntil ? "#ff3030" : this.windup ? "#5a1010" : "#000000";
      for (const mat of m.mats) mat.emissive.set(red);
      // Wings flap (faster when it's diving or winding up).
      const flap = Math.sin(time * (this.windup ? 9 : 4)) * 0.45;
      m.wings.forEach((w, i) => (w.rotation.z = i ? -flap : flap));
      if (this.kind === "wyrm" && Math.random() < 0.3) {
        particles.emit({ at: m.root.position, count: 1, color: "#e6fbff", color2: "#8fe3ff", speed: 0.5, spread: 3, life: 1.2, size: 0.2, gravity: 2 });
      }
      if (this.kind === "lich" && Math.random() < 0.35) {
        particles.emit({ at: [m.root.position.x, m.root.position.y - 1.5, m.root.position.z], count: 1, color: "#9a7bff", color2: "#2a1050", speed: 0.4, spread: 1, life: 1, size: 0.3, gravity: -0.5 });
      }
      if (this.kind === "wraith" && Math.random() < 0.4) {
        particles.emit({ at: m.root.position, count: 1, color: "#8fe3ff", color2: "#5a3cff", speed: 0.6, spread: 1.6, life: 1.2, size: 0.3, gravity: 1 });
      }
      if (this.kind === "tyrant" && this.state === "fight" && Math.random() < 0.25) {
        const p = m.root.position;
        particles.emit({ at: [p.x, p.y + 2.9, p.z], count: 1, color: "#8fe3ff", color2: "#ffffff", speed: 0.8, spread: 1.2, life: 0.6, size: 0.18 });
      }
    }
    this.bar.hidden = this.state !== "fight";
    for (const [id, f] of this.shots) {
      const t = (serverNow - f.shot.time) / 1000;
      f.mesh.position.set(...bossShotAt(f.shot, Math.max(0, t)));
      f.mesh.rotation.x += 0.1;
      if (t * f.shot.speed > SHOT_RANGE + 2) {
        this.scene.remove(f.mesh);
        this.shots.delete(id);
      }
      if (f.shot.kind === "orb" && Math.random() < 0.5) particles.emit({ at: f.mesh.position, count: 1, color: "#c58fff", speed: 0.2, life: 0.4, size: 0.2 });
    }
    this.waves = this.waves.filter((w) => {
      const r = ((serverNow - w.start) / 1000) * WAVE_SPEED;
      if (r > WAVE_RANGE) {
        this.scene.remove(w.mesh);
        w.mesh.geometry.dispose();
        return false;
      }
      w.mesh.scale.set(Math.max(0.1, r), Math.max(0.1, r), 1);
      return true;
    });
    this.strikes = this.strikes.filter((s) => this.updateStrike(s, now, serverNow));
  }

  // A marked circle: it pulses and closes in a little, then whatever it
  // marked arrives (a bolt from the sky, a meteor, or the Tyrant itself).
  private updateStrike(s: StrikeView, now: number, serverNow: number): boolean {
    const left = s.at - serverNow;
    (s.marker.material as THREE.MeshBasicMaterial).opacity = 0.4 + 0.5 * Math.abs(Math.sin(now / 90));
    s.marker.scale.setScalar(1 - (Math.max(0, left) / s.delay) * 0.3);
    // A meteor falls into its circle during the last 600 ms.
    if (s.kind === "meteor" && left < 600 && left > 0) {
      if (!s.effect) {
        s.effect = new THREE.Mesh(new THREE.DodecahedronGeometry(0.9, 0), glowMat("#ff8a2a", 3));
        this.scene.add(s.effect);
      }
      const k = left / 600;
      s.effect.position.set(s.p[0] + k * 8, s.p[1] + k * 30, s.p[2] - k * 4);
      if (Math.random() < 0.8) particles.emit({ at: s.effect.position, count: 2, color: "#ffb347", color2: "#ff4a3d", speed: 0.5, life: 0.5, size: 0.4 });
    }
    if (left <= 0 && !s.struck) {
      s.struck = true;
      const at: Vec3 = [s.p[0], s.p[1] + 0.3, s.p[2]];
      if (s.kind === "lightning") {
        s.effect = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.6, 40, 8, 1, true), glowMat("#dff6ff", 4));
        s.effect.position.set(s.p[0], s.p[1] + 20, s.p[2]);
        this.scene.add(s.effect);
        particles.emit({ at, count: 50, color: "#dff6ff", color2: "#8fe3ff", speed: 5, up: 2, life: 0.6, size: 0.25 });
        sound.fx("thunder", { at: s.p });
        sound.fx("explosion", { at: s.p, volume: 0.6 });
      } else {
        if (s.effect) s.effect.visible = false;
        const meteor = s.kind === "meteor";
        particles.emit({ at, count: meteor ? 70 : 90, color: meteor ? "#ff8a2a" : "#9a96aa", color2: meteor ? "#ffe066" : "#ffcf5a", speed: meteor ? 6 : 7, up: 3, life: 0.9, size: 0.35, gravity: 8 });
        sound.fx("explosion", { at: s.p, volume: meteor ? 0.8 : 1 });
        if (!meteor) sound.fx("rumble", { at: s.p });
      }
    }
    if (left < -250) {
      this.scene.remove(s.marker);
      s.marker.geometry.dispose();
      if (s.effect) this.scene.remove(s.effect);
      return false;
    }
    return true;
  }

  dispose(): void {
    this.scene.remove(this.model.root);
    for (const f of this.shots.values()) this.scene.remove(f.mesh);
    for (const w of this.waves) this.scene.remove(w.mesh);
    for (const s of this.strikes) {
      this.scene.remove(s.marker);
      if (s.effect) this.scene.remove(s.effect);
    }
    this.bar.remove();
  }
}
