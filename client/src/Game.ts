// Ties everything together: rendering, physics, input, and networking.
//
// Game-dev note on the loop: physics runs at a fixed 60 steps per second no
// matter how fast the screen refreshes, so jumps are the same height on a 60 Hz
// laptop and a 144 Hz monitor. Each frame we run however many fixed steps fit
// into the elapsed time (the "accumulator"), then draw the camera part-way
// between the last two steps so motion still looks smooth.

import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { EYE_HEIGHT, GRAVITY, NET_INTERVAL_MS } from "../../shared/src/constants.ts";
import type { ServerMsg, Vec3 } from "../../shared/src/protocol.ts";
import type { Input } from "./Input.ts";
import { buildTestLevel } from "./levels/testLevel.ts";
import { Net } from "./Net.ts";
import { PlayerController } from "./PlayerController.ts";
import { RemotePlayers } from "./RemotePlayers.ts";

const FIXED_DT = 1 / 60;
const MAX_FRAME_DT = 0.1; // after a long pause, don't try to catch up seconds of physics

const round = (n: number) => Math.round(n * 1000) / 1000;

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(75, 1, 0.1, 500);
  private world: RAPIER.World;
  private player: PlayerController;
  private remotes: RemotePlayers;
  private net: Net;
  private input: Input;
  private statusEl: HTMLElement;
  private name: string;

  private running = false;
  private lastFrame = 0;
  private accumulator = 0;
  private sendTimer = 0;
  private statusTimer = 0;

  constructor(container: HTMLElement, input: Input, name: string, onDisconnect: (reason: string) => void) {
    this.input = input;
    this.name = name;
    this.statusEl = document.getElementById("status")!;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.camera.rotation.order = "YXZ"; // yaw first, then pitch: standard FPS camera
    this.setupScene();

    this.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    buildTestLevel(this.scene, this.world);
    this.world.step(); // builds the collision lookup structures before the first move
    this.player = new PlayerController(this.world);
    this.remotes = new RemotePlayers(this.scene);

    this.resize();
    window.addEventListener("resize", () => this.resize());

    this.net = new Net({
      onMessage: (msg) => this.onServerMessage(msg),
      onClose: (reason) => {
        this.running = false;
        this.remotes.clear();
        onDisconnect(reason);
      },
    });
    this.net.opened().then(() => this.net.send({ t: "hello", name }));
  }

  private setupScene(): void {
    const sky = new THREE.Color("#9ec9ff");
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, 40, 120);

    this.scene.add(new THREE.HemisphereLight("#dfe9ff", "#4d6b3c", 1.6));

    const sun = new THREE.DirectionalLight("#fff4d6", 2.2);
    sun.position.set(20, 35, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = sun.shadow.camera;
    s.left = -45;
    s.right = 45;
    s.top = 45;
    s.bottom = -45;
    s.far = 120;
    this.scene.add(sun);
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private onServerMessage(msg: ServerMsg): void {
    switch (msg.t) {
      case "welcome":
        this.remotes.noteServerTime(msg.time);
        this.player.teleport(...msg.spawn);
        for (const info of msg.players) this.remotes.add(info, msg.time);
        this.start();
        break;
      case "join":
        this.remotes.noteServerTime(msg.time);
        this.remotes.add(msg.player, msg.time);
        break;
      case "moved":
        this.remotes.noteServerTime(msg.time);
        this.remotes.push(msg.id, msg.p, msg.ry, msg.time);
        break;
      case "leave":
        this.remotes.remove(msg.id);
        break;
      case "error":
        console.warn("server:", msg.message);
        break;
    }
  }

  private start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  private frame(now: number): void {
    if (!this.running) return;
    requestAnimationFrame((t) => this.frame(t));

    const dt = Math.min((now - this.lastFrame) / 1000, MAX_FRAME_DT);
    this.lastFrame = now;

    // Fixed-step physics.
    this.accumulator += dt;
    while (this.accumulator >= FIXED_DT) {
      this.player.step(FIXED_DT, this.input);
      this.accumulator -= FIXED_DT;
    }

    // Camera follows the interpolated player position.
    const pos = this.player.interpolate(this.accumulator / FIXED_DT);
    this.camera.position.set(pos.x, pos.y + EYE_HEIGHT, pos.z);
    this.camera.rotation.set(this.input.pitch, this.input.yaw, 0);

    // Send our position ~20 times a second.
    this.sendTimer += dt * 1000;
    if (this.sendTimer >= NET_INTERVAL_MS) {
      this.sendTimer %= NET_INTERVAL_MS;
      const p = this.player.position;
      const position: Vec3 = [round(p.x), round(p.y), round(p.z)];
      this.net.send({ t: "move", p: position, ry: round(this.input.yaw) });
    }

    this.remotes.update();

    this.statusTimer -= dt;
    if (this.statusTimer <= 0) {
      this.statusTimer = 0.5;
      const total = this.remotes.count + 1;
      this.statusEl.textContent = `${this.name} · ${total} wizard${total === 1 ? "" : "s"} online`;
    }

    this.renderer.render(this.scene, this.camera);
  }
}
