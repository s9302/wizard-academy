// What a trial adds beyond jumping (Phase 16): star orbs to collect, rune
// plates to step on in order, a sealed finish that opens when they're done,
// and boss fights with hearts, a health bar, and attacks to dodge.
//
// As everywhere else, the server decides; this draws what it says. The one
// exception is your own bolts at a boss, drawn the moment you click (like
// spells in the arena) and matched up with the server's copy.

import * as THREE from "three";
import { BOSSES, type BossKind, type BossShot, bossShotAt, SHOT_RANGE, STRIKE_DELAY_MS, STRIKE_RADIUS, WAVE_RANGE, WAVE_SPEED } from "../../../shared/src/bosses.ts";
import { SPELLS } from "../../../shared/src/combat.ts";
import type { Level, Task } from "../../../shared/src/levels/types.ts";
import type { ClientMsg, ServerMsg, Vec3 } from "../../../shared/src/protocol.ts";
import { sound } from "../audio/Sound.ts";
import { particles } from "../graphics/Particles.ts";
import { Spells } from "../royale/Spells.ts";
import type { ServerClock } from "../ServerClock.ts";
import { quality } from "../quality.ts";

const glowMat = (color: string, k = 2.2) => {
  const m = new THREE.MeshBasicMaterial({ color, toneMapped: false });
  if (quality() === "ultra") m.color.multiplyScalar(k);
  return m;
};

// ---- Rune symbols, drawn on canvases ----

function runeTexture(symbol: string, color: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#2a2240";
  g.beginPath();
  g.arc(64, 64, 62, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = 6;
  g.beginPath();
  g.arc(64, 64, 56, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  if (symbol === "sun") {
    g.arc(64, 64, 18, 0, Math.PI * 2);
    g.fill();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.moveTo(64 + Math.cos(a) * 26, 64 + Math.sin(a) * 26);
      g.lineTo(64 + Math.cos(a) * 40, 64 + Math.sin(a) * 40);
    }
    g.stroke();
  } else if (symbol === "moon") {
    g.arc(64, 64, 30, 0, Math.PI * 2);
    g.fill();
    g.globalCompositeOperation = "destination-out";
    g.beginPath();
    g.arc(78, 56, 26, 0, Math.PI * 2);
    g.fill();
    g.globalCompositeOperation = "source-over";
  } else if (symbol === "star") {
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 14 : 34;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
  } else {
    // A flame.
    g.moveTo(64, 26);
    g.bezierCurveTo(90, 56, 92, 74, 64, 98);
    g.bezierCurveTo(36, 74, 38, 56, 64, 26);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---- Boss models ----

function bossModel(kind: BossKind): { root: THREE.Group; mats: THREE.MeshLambertMaterial[]; arms: THREE.Object3D[] } {
  const root = new THREE.Group();
  const mats: THREE.MeshLambertMaterial[] = [];
  const arms: THREE.Object3D[] = [];
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
  } else {
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
  }
  return { root, mats, arms };
}

type Flying = { shot: BossShot; mesh: THREE.Mesh };
type WaveView = { mesh: THREE.Mesh; start: number };
type StrikeView = { marker: THREE.Mesh; at: number; p: Vec3; struck: boolean; bolt: THREE.Mesh | null };

export type TrialHooks = { send: (msg: ClientMsg) => void; feed: (text: string) => void };

export class Trial {
  private scene: THREE.Scene;
  private clock: ServerClock;
  private level: Level;
  private hooks: TrialHooks;
  private tasks: Task[];
  private done = new Set<string>();
  private orbMeshes = new Map<string, THREE.Mesh[]>();
  private runeMeshes = new Map<string, THREE.Mesh[]>();
  private wrongUntil = 0;
  private seal: THREE.Mesh | null = null;
  private taskEl: HTMLElement;
  private heartsEl: HTMLElement;
  private bossBar: HTMLElement;
  private bossFill: HTMLElement;
  private bossName: HTMLElement;
  // The boss.
  private bossKind: BossKind | null = null;
  private boss: ReturnType<typeof bossModel> | null = null;
  private bossFrom = new THREE.Vector3();
  private bossTo = new THREE.Vector3();
  private bossAt = 0;
  private bossRy = 0;
  private bossState: "sleep" | "fight" | "dead" = "sleep";
  private bossWindup = false;
  private bossHp = 0;
  private flashUntil = 0;
  private shots = new Map<number, Flying>();
  private waves: WaveView[] = [];
  private strikes: StrikeView[] = [];
  private spells: Spells;
  private seq = 0;
  private readyAt = 0;
  private hearts = 3;

  constructor(scene: THREE.Scene, hud: HTMLElement, clock: ServerClock, level: Level, hooks: TrialHooks) {
    this.scene = scene;
    this.clock = clock;
    this.level = level;
    this.hooks = hooks;
    this.tasks = level.course?.tasks ?? [];
    this.spells = new Spells(scene, clock, level.boxes);
    this.taskEl = document.createElement("div");
    this.taskEl.id = "trial-tasks";
    hud.appendChild(this.taskEl);
    this.heartsEl = document.createElement("div");
    this.heartsEl.id = "trial-hearts";
    this.heartsEl.hidden = true;
    hud.appendChild(this.heartsEl);
    this.bossBar = document.createElement("div");
    this.bossBar.id = "boss-bar";
    this.bossBar.hidden = true;
    this.bossName = document.createElement("div");
    this.bossName.className = "boss-name";
    const track = document.createElement("div");
    track.className = "boss-track";
    this.bossFill = document.createElement("div");
    this.bossFill.className = "boss-fill";
    track.appendChild(this.bossFill);
    this.bossBar.append(this.bossName, track);
    hud.appendChild(this.bossBar);

    for (const task of this.tasks) {
      if (task.kind === "orbs") {
        this.orbMeshes.set(
          task.id,
          task.points.map((p) => {
            const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), glowMat(task.color ?? "#ffe58a", 2.6));
            m.position.set(...p);
            scene.add(m);
            return m;
          }),
        );
      } else if (task.kind === "runes") {
        this.runeMeshes.set(
          task.id,
          task.points.map((p, i) => {
            const m = new THREE.Mesh(new THREE.CircleGeometry(0.85, 28), new THREE.MeshBasicMaterial({ map: runeTexture(task.symbols[i], "#b48cff"), toneMapped: false }));
            m.rotation.x = -Math.PI / 2;
            m.position.set(p[0], p[1] + 0.03, p[2]);
            scene.add(m);
            return m;
          }),
        );
      } else {
        this.bossKind = task.boss;
        this.boss = bossModel(task.boss);
        this.boss.root.position.set(...task.home);
        this.bossFrom.set(...task.home);
        this.bossTo.set(...task.home);
        scene.add(this.boss.root);
        this.bossName.textContent = BOSSES[task.boss].name;
      }
    }
    if (this.tasks.length && level.course) {
      const f = level.course.finish;
      const size = [f.max[0] - f.min[0], 3.4, f.max[2] - f.min[2]];
      this.seal = new THREE.Mesh(
        new THREE.BoxGeometry(size[0], size[1], size[2]),
        new THREE.MeshBasicMaterial({ color: "#b48cff", transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
      );
      this.seal.position.set((f.min[0] + f.max[0]) / 2, f.min[1] + size[1] / 2, (f.min[2] + f.max[2]) / 2);
      scene.add(this.seal);
    }
    this.renderTasks();
  }

  get hasBoss(): boolean {
    return this.bossKind !== null;
  }

  // Inside the boss arena? (Clicks cast bolts there.)
  inArena(p: THREE.Vector3): boolean {
    const t = this.tasks.find((x) => x.kind === "boss");
    if (!t || t.kind !== "boss") return false;
    const z = t.arena;
    return p.x >= z.min[0] && p.x <= z.max[0] && p.y >= z.min[1] && p.y <= z.max[1] && p.z >= z.min[2] && p.z <= z.max[2];
  }

  // Left click in the arena: a bolt at the boss.
  attack(origin: THREE.Vector3, dir: THREE.Vector3, playerPos: THREE.Vector3): void {
    if (!this.hasBoss || this.bossState !== "fight" || !this.inArena(playerPos)) return;
    const now = performance.now();
    if (now < this.readyAt) return;
    this.readyAt = now + 450;
    this.seq += 1;
    const o: Vec3 = [round3(origin.x), round3(origin.y), round3(origin.z)];
    const d: Vec3 = [dir.x, dir.y, dir.z];
    this.spells.castLocal(this.seq, "bolt", o, [d]);
    this.hooks.send({ t: "cast", spell: "bolt", o, d, seq: this.seq });
    sound.fx("bolt");
  }

  private renderTasks(): void {
    this.taskEl.replaceChildren();
    this.taskEl.hidden = this.tasks.length === 0;
    for (const t of this.tasks) {
      const row = document.createElement("div");
      const done = this.done.has(t.id);
      row.className = done ? "done" : "";
      let text = t.label;
      if (t.kind === "orbs") {
        const got = this.orbMeshes.get(t.id)!.filter((m) => !m.visible).length;
        text += ` (${got}/${t.points.length})`;
      } else if (t.kind === "runes") {
        const got = this.runeMeshes.get(t.id)!.filter((m) => m.userData.lit).length;
        text += ` (${got}/${t.points.length})`;
      }
      row.textContent = `${done ? "✓" : "○"} ${text}`;
      this.taskEl.appendChild(row);
    }
    if (this.seal) this.seal.visible = this.tasks.some((t) => !this.done.has(t.id));
  }

  // Back to the start: everything comes back.
  reset(): void {
    this.done.clear();
    for (const list of this.orbMeshes.values()) for (const m of list) m.visible = true;
    for (const list of this.runeMeshes.values()) for (const m of list) this.lightRune(m, false);
    this.hearts = 3;
    this.renderHearts();
    this.renderTasks();
  }

  private lightRune(m: THREE.Mesh, on: boolean): void {
    m.userData.lit = on;
    (m.material as THREE.MeshBasicMaterial).color.set(on ? "#ffffff" : "#8a80a8").multiplyScalar(on && quality() === "ultra" ? 2.2 : 1);
  }

  private renderHearts(): void {
    this.heartsEl.textContent = "♥".repeat(this.hearts) + "♡".repeat(Math.max(0, 3 - this.hearts));
  }

  // Returns true if it was a trial message.
  onMessage(msg: ServerMsg, myId: number): boolean {
    switch (msg.t) {
      case "task": {
        const task = this.tasks.find((t) => t.id === msg.id);
        if (!task) return true;
        const got = new Set(msg.got);
        if (task.kind === "orbs") {
          this.orbMeshes.get(task.id)!.forEach((m, i) => {
            const take = got.has(i) && m.visible;
            if (take) {
              particles.emit({ at: m.position, count: 40, color: task.color ?? "#ffe58a", color2: "#ffffff", speed: 4, life: 0.8, size: 0.2 });
              sound.fx("ward");
            }
            m.visible = !got.has(i);
          });
        } else if (task.kind === "runes") {
          const meshes = this.runeMeshes.get(task.id)!;
          meshes.forEach((m, i) => {
            if (got.has(i) && !m.userData.lit) {
              sound.fx("checkpoint");
              particles.emit({ at: m.position, count: 20, color: "#b48cff", color2: "#ffffff", up: 2, speed: 1, life: 0.8, size: 0.15 });
            }
            this.lightRune(m, got.has(i));
          });
          if (msg.wrong) {
            this.wrongUntil = performance.now() + 600;
            sound.play("error");
          }
        }
        if (msg.done && !this.done.has(task.id)) {
          this.done.add(task.id);
          sound.fx("levelUp");
          if (this.tasks.every((t) => this.done.has(t.id)) && this.seal) {
            particles.emit({ at: this.seal.position, count: 80, color: "#b48cff", color2: "#ffffff", speed: 5, life: 1.2, size: 0.25 });
            sound.fx("portal");
          }
        }
        if (!msg.done) this.done.delete(task.id);
        this.renderTasks();
        return true;
      }
      case "hearts": {
        const lost = msg.hearts < this.hearts;
        this.hearts = msg.hearts;
        this.renderHearts();
        if (lost) sound.play(["punchHeavy0", "punchHeavy1"]);
        return true;
      }
      case "boss": {
        if (!this.boss) return true;
        this.bossFrom.copy(this.boss.root.position);
        this.bossTo.set(...msg.p);
        this.bossAt = performance.now();
        this.bossRy = msg.ry;
        if (msg.hp < this.bossHp && msg.state === "fight") this.flashUntil = performance.now() + 120;
        if (msg.state === "dead" && this.bossState !== "dead") {
          particles.emit({ at: msg.p, count: 160, color: BOSSES[msg.kind].color, color2: "#ffffff", speed: 7, up: 2, life: 1.6, size: 0.4, gravity: 4 });
          sound.fx("explosion");
          sound.fx("victory");
        }
        if (msg.state === "fight" && this.bossState === "sleep") sound.fx("sting", { rate: 0.6 });
        if (msg.windup && !this.bossWindup) sound.fx("charge", { at: msg.p, rate: 0.6 });
        this.bossState = msg.state;
        this.bossWindup = msg.windup;
        this.bossHp = msg.hp;
        this.boss.root.visible = msg.state !== "dead";
        this.bossFill.style.width = `${(100 * msg.hp) / Math.max(1, msg.max)}%`;
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
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.18, 6, 48), glowMat(this.bossKind === "wraith" ? "#8fe3ff" : "#ffb347", 2.5));
        ring.rotation.x = Math.PI / 2;
        ring.position.set(msg.o[0], msg.o[1] + 0.25, msg.o[2]);
        this.scene.add(ring);
        this.waves.push({ mesh: ring, start: msg.time });
        sound.fx("rumble", { at: msg.o });
        sound.play("softHeavy", { at: msg.o });
        return true;
      }
      case "bossStrike": {
        const marker = new THREE.Mesh(
          new THREE.RingGeometry(STRIKE_RADIUS - 0.2, STRIKE_RADIUS, 32),
          new THREE.MeshBasicMaterial({ color: "#ff4a3d", transparent: true, opacity: 0.8, side: THREE.DoubleSide, toneMapped: false }),
        );
        marker.rotation.x = -Math.PI / 2;
        marker.position.set(msg.p[0], msg.p[1] + 0.05, msg.p[2]);
        this.scene.add(marker);
        this.strikes.push({ marker, at: msg.at, p: msg.p, struck: false, bolt: null });
        return true;
      }
      case "spell":
        if (msg.spell !== "bolt") return false;
        this.spells.started(msg.id, msg.spell, msg.o, msg.d, msg.time, msg.caster === myId ? `${msg.seq}:${msg.k}` : null);
        if (msg.caster !== myId) sound.fx("bolt", { at: msg.o, volume: 0.6 });
        return true;
      case "spellEnd":
        this.spells.ended(msg.id, msg.p);
        sound.play(msg.hit === -1 ? ["punch0", "punch1"] : "glass", { at: msg.p, volume: 0.6 });
        return true;
      default:
        return false;
    }
  }

  update(time: number): void {
    const now = performance.now();
    const serverNow = this.clock.now();
    for (const list of this.orbMeshes.values()) {
      list.forEach((m, i) => {
        m.rotation.y = time * 1.5 + i;
        m.position.y += Math.sin(time * 2 + i) * 0.003;
      });
    }
    const wrong = now < this.wrongUntil;
    for (const list of this.runeMeshes.values()) {
      for (const m of list) if (!m.userData.lit) (m.material as THREE.MeshBasicMaterial).color.set(wrong ? "#ff4a3d" : "#8a80a8");
    }
    if (this.seal?.visible) (this.seal.material as THREE.MeshBasicMaterial).opacity = 0.08 + 0.05 * Math.sin(time * 2.5);
    if (this.boss && this.bossState !== "dead") {
      const k = Math.min(1, (now - this.bossAt) / 110);
      this.boss.root.position.lerpVectors(this.bossFrom, this.bossTo, k);
      let dr = this.bossRy - this.boss.root.rotation.y;
      dr = Math.atan2(Math.sin(dr), Math.cos(dr));
      this.boss.root.rotation.y += dr * 0.2;
      const swing = this.bossWindup ? Math.sin(now / 80) * 0.25 - 0.9 : Math.sin(time * 2) * 0.15;
      this.boss.arms.forEach((a, i) => (a.rotation.x = i % 2 ? swing : -swing * (this.bossWindup ? -1 : 1)));
      const red = now < this.flashUntil ? "#ff3030" : this.bossWindup ? "#5a1010" : "#000000";
      for (const m of this.boss.mats) m.emissive.set(red);
      if (this.bossKind === "wraith" && Math.random() < 0.4) {
        particles.emit({ at: this.boss.root.position, count: 1, color: "#8fe3ff", color2: "#5a3cff", speed: 0.6, spread: 1.6, life: 1.2, size: 0.3, gravity: 1 });
      }
    }
    this.bossBar.hidden = !this.boss || this.bossState !== "fight";
    this.heartsEl.hidden = !this.boss || this.bossState !== "fight";
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
    this.strikes = this.strikes.filter((s) => {
      const left = s.at - serverNow;
      (s.marker.material as THREE.MeshBasicMaterial).opacity = 0.4 + 0.5 * Math.abs(Math.sin(now / 90));
      s.marker.scale.setScalar(1 - Math.max(0, left) / STRIKE_DELAY_MS * 0.3);
      if (left <= 0 && !s.struck) {
        s.struck = true;
        s.bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.6, 40, 8, 1, true), glowMat("#dff6ff", 4));
        s.bolt.position.set(s.p[0], s.p[1] + 20, s.p[2]);
        this.scene.add(s.bolt);
        particles.emit({ at: [s.p[0], s.p[1] + 0.3, s.p[2]], count: 50, color: "#dff6ff", color2: "#8fe3ff", speed: 5, up: 2, life: 0.6, size: 0.25 });
        sound.fx("thunder", { at: s.p });
        sound.fx("explosion", { at: s.p, volume: 0.6 });
      }
      if (left < -250) {
        this.scene.remove(s.marker);
        if (s.bolt) this.scene.remove(s.bolt);
        return false;
      }
      return true;
    });
    this.spells.update();
  }

  dispose(): void {
    this.spells.clear();
    this.taskEl.remove();
    this.heartsEl.remove();
    this.bossBar.remove();
  }
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
void SPELLS;
