// Capture the flag on screen: the two flags (at their stands, carried
// above a player's head, or lying where they were dropped) and the score.

import * as THREE from "three";
import type { CtfFlag, ServerMsg, Vec3 } from "../../../shared/src/protocol.ts";
import { sound } from "../audio/Sound.ts";
import { particles } from "../graphics/Particles.ts";

const COLORS = ["#ff4a4a", "#4a8cff"];
const NAMES = ["Red", "Blue"];

type FlagView = { root: THREE.Group; cloth: THREE.Mesh; state: CtfFlag };

export class CtfView {
  private scene: THREE.Scene;
  private flags: FlagView[];
  private scoreEl: HTMLElement;
  private positionOf: (id: number) => THREE.Vector3 | null;
  private myTeam: () => 0 | 1 | null;
  private myId: () => number;

  constructor(scene: THREE.Scene, hud: HTMLElement, stands: [Vec3, Vec3], hooks: { positionOf: (id: number) => THREE.Vector3 | null; myTeam: () => 0 | 1 | null; myId: () => number }) {
    this.scene = scene;
    this.positionOf = hooks.positionOf;
    this.myTeam = hooks.myTeam;
    this.myId = hooks.myId;
    this.flags = stands.map((p, team) => {
      const root = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.4, 6), new THREE.MeshLambertMaterial({ color: "#d9d4c8" }));
      pole.position.y = 1.2;
      const cloth = new THREE.Mesh(
        new THREE.PlaneGeometry(1.1, 0.7, 6, 2),
        new THREE.MeshLambertMaterial({ color: COLORS[team], side: THREE.DoubleSide, emissive: COLORS[team], emissiveIntensity: 0.35 }),
      );
      cloth.position.set(0.56, 2.0, 0);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshLambertMaterial({ color: "#e8c547" }));
      knob.position.y = 2.45;
      root.add(pole, cloth, knob);
      root.position.set(...p);
      scene.add(root);
      return { root, cloth, state: { state: "home", p, carrier: null } as CtfFlag };
    });
    this.scoreEl = document.createElement("div");
    this.scoreEl.id = "ctf-score";
    hud.appendChild(this.scoreEl);
    this.show([0, 0], 3);
  }

  onMessage(msg: ServerMsg): boolean {
    if (msg.t !== "ctf") return false;
    msg.flags.forEach((f, team) => {
      const v = this.flags[team];
      if (f.state === "carried" && v.state.state !== "carried") sound.fx("sting", { rate: 1.3, volume: 0.6 });
      if (f.state === "home" && v.state.state !== "home") particles.emit({ at: f.p, count: 40, color: COLORS[team], color2: "#ffffff", speed: 3, up: 2, life: 0.9, size: 0.2 });
      v.state = f;
    });
    this.show(msg.score, msg.toWin);
    return true;
  }

  private show(score: [number, number], toWin: number): void {
    const status = (team: 0 | 1) => {
      const f = this.flags[team].state;
      if (f.state === "home") return "at home";
      if (f.state === "dropped") return "dropped!";
      return f.carrier === this.myId() ? "YOU have it!" : "taken!";
    };
    const mine = this.myTeam();
    this.scoreEl.replaceChildren();
    const line = document.createElement("div");
    line.className = "ctf-line";
    line.innerHTML = "";
    for (const team of [0, 1] as const) {
      const span = document.createElement("span");
      span.style.color = COLORS[team];
      span.textContent = `${NAMES[team]}${mine === team ? " (you)" : ""} ${score[team]}`;
      line.appendChild(span);
      if (team === 0) line.appendChild(document.createTextNode(` — `));
    }
    const flags = document.createElement("div");
    flags.className = "ctf-flags";
    flags.textContent = `First to ${toWin} · Red flag ${status(0)} · Blue flag ${status(1)}`;
    this.scoreEl.append(line, flags);
  }

  update(time: number): void {
    for (const v of this.flags) {
      const f = v.state;
      if (f.state === "carried" && f.carrier !== null) {
        const at = this.positionOf(f.carrier);
        if (at) v.root.position.set(at.x - 0.3, at.y + 0.2, at.z);
      } else {
        v.root.position.set(...f.p);
      }
      v.root.rotation.z = f.state === "dropped" ? 1.2 : 0; // lying on the ground
      // The cloth ripples.
      const pos = v.cloth.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i) + 0.55;
        pos.setZ(i, Math.sin(time * 6 + x * 5) * 0.08 * x);
      }
      pos.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const v of this.flags) this.scene.remove(v.root);
    this.scoreEl.remove();
  }
}
