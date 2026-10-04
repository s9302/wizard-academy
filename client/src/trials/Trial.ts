// What a trial adds beyond jumping (Phase 16): star orbs to collect, rune
// plates to step on in order, a sealed finish that opens when they're done,
// and boss fights with hearts, a health bar, and attacks to dodge.
//
// As everywhere else, the server decides; this draws what it says. The one
// exception is your own bolts at a boss, drawn the moment you click (like
// spells in the arena) and matched up with the server's copy.

import * as THREE from "three";
import { SPELLS } from "../../../shared/src/combat.ts";
import type { Level, Task } from "../../../shared/src/levels/types.ts";
import type { ClientMsg, ServerMsg, Vec3 } from "../../../shared/src/protocol.ts";
import { sound } from "../audio/Sound.ts";
import { BossView, glowMat } from "../bosses/BossView.ts";
import { particles } from "../graphics/Particles.ts";
import { Spells } from "../royale/Spells.ts";
import type { ServerClock } from "../ServerClock.ts";
import { quality } from "../quality.ts";

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
  private boss: BossView | null = null;
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
        this.boss = new BossView(scene, hud, clock, task.boss, task.home);
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
    return this.boss !== null;
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
    if (!this.boss?.fighting || !this.inArena(playerPos)) return;
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
    if (this.boss?.onMessage(msg)) return true;
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
    this.heartsEl.hidden = !this.boss?.fighting;
    this.boss?.update(time);
    this.spells.update();
  }

  dispose(): void {
    this.spells.clear();
    this.taskEl.remove();
    this.heartsEl.remove();
    this.boss?.dispose();
  }
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
void SPELLS;
