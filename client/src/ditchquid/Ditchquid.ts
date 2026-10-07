// Ditchquid in your browser: the scoreboard and round clock, the ball (where
// the server says it is, smoothed), jinx bolts, team rings, goal banners,
// and what a click does (throw the ball if you have it, else cast a jinx).
// Everything that counts is decided on the server (DitchquidRoom).

import * as THREE from "three";
import { DQ, DQ_TEAMS } from "../../../shared/src/ditchquid.ts";
import type { Level } from "../../../shared/src/levels/types.ts";
import type { RoundState, ServerMsg, Vec3 } from "../../../shared/src/protocol.ts";
import { sound } from "../audio/Sound.ts";
import { BotControls } from "../BotControls.ts";
import { particles } from "../graphics/Particles.ts";
import type { RemotePlayers } from "../RemotePlayers.ts";
import type { ServerClock } from "../ServerClock.ts";

type Hooks = {
  send: (msg: { t: "dqThrow"; d: Vec3 } | { t: "dqJinx"; o: Vec3; d: Vec3 } | { t: "bots"; action: "add" | "remove" }) => void;
  myId: () => number;
  slow: (seconds: number, factor: number) => void;
  feed: (text: string) => void;
};

const BALL_DELAY_MS = 100; // draw the ball this far in the past, between updates
const clockText = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function el(tag: string, id: string, parent: HTMLElement, className = ""): HTMLElement {
  const node = document.createElement(tag);
  if (id) node.id = id;
  if (className) node.className = className;
  parent.appendChild(node);
  return node;
}

export class Ditchquid {
  private scene: THREE.Scene;
  private clock: ServerClock;
  private remotes: RemotePlayers;
  private hooks: Hooks;
  private level: Level;
  private bots: BotControls;
  private ball: THREE.Mesh;
  private ballGlow: THREE.Mesh;
  private snaps: { time: number; p: Vec3 }[] = [];
  carrier: number | null = null;
  private teams = new Map<number, 0 | 1>();
  private score: [number, number] = [0, 0];
  private state: RoundState = "waiting";
  private endsAt: number | null = null;
  private jinxes = new Map<number, { mesh: THREE.Mesh; o: Vec3; d: Vec3; time: number }>();
  private jinxReadyAt = 0;
  private scoreEl: HTMLElement;
  private timerEl: HTMLElement;
  private roleEl: HTMLElement;
  private bannerEl: HTMLElement;
  private resultsEl: HTMLElement;
  private holdEl: HTMLElement;
  private bannerTimer: number | undefined;
  private hud: HTMLElement[] = [];

  constructor(scene: THREE.Scene, hud: HTMLElement, clock: ServerClock, level: Level, roomName: string, remotes: RemotePlayers, hooks: Hooks) {
    this.scene = scene;
    this.clock = clock;
    this.remotes = remotes;
    this.hooks = hooks;
    this.level = level;
    this.bots = new BotControls((action) => hooks.send({ t: "bots", action }));

    const panel = el("div", "run", hud);
    el("div", "run-name", panel).textContent = roomName;
    this.scoreEl = el("div", "dq-score", panel);
    this.timerEl = el("div", "run-timer", panel);
    this.roleEl = el("div", "run-progress", panel);
    this.bannerEl = el("div", "banner", hud);
    this.resultsEl = el("div", "results", hud);
    this.resultsEl.hidden = true;
    this.holdEl = el("div", "dq-hold", hud);
    this.holdEl.textContent = "You have the ball! Click to throw it through their hoops";
    this.holdEl.hidden = true;
    this.hud.push(panel, this.bannerEl, this.resultsEl, this.holdEl);
    this.showScore();

    // The ball: a glowing red-gold sphere with a soft halo.
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(DQ.ball.radius, 16, 12), new THREE.MeshStandardMaterial({ color: "#c0392b", emissive: "#ff6a3a", emissiveIntensity: 0.6, roughness: 0.5 }));
    this.ball.castShadow = true;
    this.ballGlow = new THREE.Mesh(new THREE.SphereGeometry(DQ.ball.radius * 1.9, 12, 8), new THREE.MeshBasicMaterial({ color: "#ffb84a", transparent: true, opacity: 0.25, depthWrite: false }));
    this.ball.add(this.ballGlow);
    this.ball.position.set(...(level.ditchquid?.ball ?? [0, 10, 0]));
    scene.add(this.ball);
  }

  get myTeam(): 0 | 1 | null {
    return this.teams.get(this.hooks.myId()) ?? null;
  }

  get playing(): boolean {
    return this.state === "playing";
  }

  // Handles the messages that are Ditchquid's; returns false for the rest.
  onMessage(msg: ServerMsg): boolean {
    const me = this.hooks.myId();
    switch (msg.t) {
      case "round":
        this.state = msg.state;
        this.endsAt = msg.endsAt;
        if (msg.state !== "ended") this.resultsEl.hidden = true;
        if (msg.state === "countdown") this.banner("Get ready! Mount up...", 1800);
        if (msg.state === "playing") {
          sound.fx("go", { volume: 0.7 });
          this.banner("Go! Grab the ball", 2200);
        }
        if (msg.state === "ended") sound.play("bell", { volume: 0.6 });
        this.updateRole();
        return true;
      case "roundResult":
        this.resultsEl.replaceChildren();
        el("h2", "", this.resultsEl).textContent = msg.title;
        for (const line of msg.lines) el("div", "", this.resultsEl).textContent = line;
        this.resultsEl.hidden = false;
        return true;
      case "botCount":
        this.bots.update(msg.count, msg.max);
        return true;
      case "dqTeams":
        this.teams.clear();
        msg.teams.forEach((ids, team) => ids.forEach((id) => this.teams.set(id, team as 0 | 1)));
        this.remotes.forEachId((id) => {
          const t = this.teams.get(id);
          this.remotes.setTeam(id, t === undefined ? null : DQ_TEAMS[t].color);
        });
        this.updateRole();
        return true;
      case "dqScore":
        this.score = msg.score;
        this.showScore();
        return true;
      case "dqBall": {
        this.clock.note(msg.time);
        const had = this.carrier;
        this.carrier = msg.carrier;
        if (had !== msg.carrier) {
          this.snaps = [];
          if (msg.carrier === me) {
            sound.play("pickup", { volume: 0.8 });
            this.hooks.feed("You have the ball!");
          }
        }
        this.snaps.push({ time: msg.time, p: msg.p });
        while (this.snaps.length > 8) this.snaps.shift();
        this.holdEl.hidden = this.carrier !== me;
        this.updateRole();
        return true;
      }
      case "dqGoal": {
        const team = DQ_TEAMS[msg.team];
        const mine = msg.team === this.myTeam;
        this.banner(`GOAL! ${team.name} +${DQ.goalPoints}`, 2500);
        this.bannerEl.style.color = team.color;
        sound.fx(mine ? "levelUp" : "sting", { volume: 0.8 });
        const hoop = this.level.ditchquid?.hoops[msg.hoop];
        if (hoop) particles.emit({ at: hoop.pos, count: 80, color: team.color, color2: "#ffe58a", speed: 7, up: 3, life: 1.4, size: 0.3 });
        return true;
      }
      case "dqJinxCast": {
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshBasicMaterial({ color: "#c58fff", toneMapped: false }));
        mesh.position.set(...msg.o);
        this.scene.add(mesh);
        this.jinxes.set(msg.id, { mesh, o: msg.o, d: msg.d, time: msg.time });
        sound.fx("blink", { at: msg.by === me ? null : msg.o, rate: 1.6, volume: 0.5 });
        return true;
      }
      case "dqJinxEnd": {
        const j = this.jinxes.get(msg.id);
        if (j) {
          this.scene.remove(j.mesh);
          j.mesh.geometry.dispose();
          this.jinxes.delete(msg.id);
        }
        particles.emit({ at: msg.p, count: msg.hit ? 30 : 10, color: "#c58fff", color2: "#ffffff", speed: 3, life: 0.6, size: 0.2 });
        if (msg.hit === me) {
          this.hooks.slow(DQ.jinx.slowMs / 1000, DQ.jinx.slowFactor);
          this.banner("Jinxed! Slowed for a moment", 1500);
          sound.fx("sting", { volume: 0.6 });
        } else if (msg.hit !== null) {
          this.remotes.glow(msg.hit, "#c58fff", DQ.jinx.slowMs);
        }
        return true;
      }
      default:
        return false;
    }
  }

  // A click: throw the ball if you're holding it, else cast a jinx.
  click(origin: THREE.Vector3, dir: THREE.Vector3): void {
    if (this.state !== "playing") return;
    const d: Vec3 = [dir.x, dir.y, dir.z];
    if (this.carrier === this.hooks.myId()) {
      this.hooks.send({ t: "dqThrow", d });
      sound.fx("blink", { rate: 0.8, volume: 0.6 });
      return;
    }
    const now = performance.now();
    if (now < this.jinxReadyAt) return;
    this.jinxReadyAt = now + DQ.jinx.cooldownMs;
    this.hooks.send({ t: "dqJinx", o: [origin.x, origin.y, origin.z], d });
  }

  update(now: number, camera: THREE.Camera): void {
    // The clock.
    const left = this.endsAt === null ? 0 : this.endsAt - this.clock.now();
    this.timerEl.textContent =
      this.state === "playing" ? clockText(left) : this.state === "countdown" ? `Starting in ${Math.max(1, Math.ceil(left / 1000))}` : this.state === "ended" ? `Next match in ${Math.max(1, Math.ceil(left / 1000))}` : "—";
    // The ball: in your hands, in someone else's, or flying (smoothed).
    const me = this.hooks.myId();
    if (this.carrier === me) {
      const ahead = new THREE.Vector3(0, -0.45, -0.9).applyQuaternion(camera.quaternion);
      this.ball.position.copy(camera.position).add(ahead);
    } else if (this.carrier !== null) {
      const p = this.remotes.positionOf(this.carrier);
      if (p) this.ball.position.set(p[0], p[1] + 0.2, p[2]);
    } else if (this.snaps.length) {
      const t = this.clock.now() - BALL_DELAY_MS;
      let a = this.snaps[0];
      let b = a;
      for (let i = this.snaps.length - 1; i >= 0; i--) {
        if (this.snaps[i].time <= t) {
          a = this.snaps[i];
          b = this.snaps[i + 1] ?? a;
          break;
        }
      }
      const k = b.time > a.time ? Math.min(1, Math.max(0, (t - a.time) / (b.time - a.time))) : 1;
      this.ball.position.set(a.p[0] + (b.p[0] - a.p[0]) * k, a.p[1] + (b.p[1] - a.p[1]) * k, a.p[2] + (b.p[2] - a.p[2]) * k);
    }
    this.ball.rotation.y = now / 300;
    (this.ballGlow.material as THREE.MeshBasicMaterial).opacity = 0.2 + Math.sin(now / 200) * 0.08;
    if (this.carrier === null && Math.random() < 0.3) particles.emit({ at: [this.ball.position.x, this.ball.position.y, this.ball.position.z], count: 1, color: "#ffb84a", speed: 0.3, life: 0.6, size: 0.12 });
    // Jinx bolts fly straight.
    for (const j of this.jinxes.values()) {
      const t = Math.max(0, (this.clock.now() - j.time) / 1000);
      const m = Math.min(DQ.jinx.range, t * DQ.jinx.speed);
      j.mesh.position.set(j.o[0] + j.d[0] * m, j.o[1] + j.d[1] * m, j.o[2] + j.d[2] * m);
    }
  }

  private showScore(): void {
    this.scoreEl.replaceChildren();
    for (const team of [0, 1] as const) {
      const span = el("span", "", this.scoreEl, "dq-team");
      span.style.color = DQ_TEAMS[team].color;
      span.textContent = `${DQ_TEAMS[team].name} ${this.score[team]}`;
      if (team === 0) el("span", "", this.scoreEl, "dq-sep").textContent = " · ";
    }
  }

  private updateRole(): void {
    const team = this.myTeam;
    if (this.state === "waiting") this.roleEl.textContent = "Waiting for 2+ players · Esc to add bots";
    else if (team === null) this.roleEl.textContent = "Joining a team...";
    else {
      const t = DQ_TEAMS[team];
      this.roleEl.textContent = this.carrier === this.hooks.myId() ? "You have the ball: throw it!" : `You fly for the ${t.name}`;
      this.roleEl.style.color = t.color;
    }
  }

  private banner(text: string, ms: number): void {
    this.bannerEl.textContent = text;
    this.bannerEl.style.color = "";
    this.bannerEl.classList.add("show");
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.bannerEl.classList.remove("show"), ms);
  }

  dispose(): void {
    this.scene.remove(this.ball);
    for (const j of this.jinxes.values()) this.scene.remove(j.mesh);
    this.jinxes.clear();
    for (const node of this.hud) node.remove();
  }
}
