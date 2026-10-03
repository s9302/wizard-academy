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
import type { Level } from "../../shared/src/levels/types.ts";
import type { ServerMsg, Vec3 } from "../../shared/src/protocol.ts";
import type { Input } from "./Input.ts";
import { buildLevel, type CheckpointMarkers } from "./levels/buildLevel.ts";
import { Net } from "./Net.ts";
import { ParkourHud } from "./ParkourHud.ts";
import { PlayerController } from "./PlayerController.ts";
import { RemotePlayers } from "./RemotePlayers.ts";
import { ServerClock } from "./ServerClock.ts";

const FIXED_DT = 1 / 60;
const MAX_FRAME_DT = 0.1; // after a long pause, don't try to catch up seconds of physics
const RESPAWN_RETRY_MS = 1000;
const FEED_MESSAGE_MS = 6000;
// The sun's shadow camera covers this many meters around the player.
const SHADOW_RANGE = 40;
const SUN_OFFSET = new THREE.Vector3(20, 35, 10);

const round = (n: number) => Math.round(n * 1000) / 1000;
// Yaw keeps growing as you spin; send it as an angle in -PI..PI.
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(75, 1, 0.1, 500);
  private sun = new THREE.DirectionalLight("#fff4d6", 2.2);
  private world: RAPIER.World;
  private player: PlayerController;
  private clock = new ServerClock();
  private remotes: RemotePlayers;
  private markers: CheckpointMarkers;
  private parkour: ParkourHud | null = null;
  private net: Net;
  private input: Input;
  private level: Level;
  private statusEl: HTMLElement;
  private feedEl: HTMLElement;
  private name: string;

  private running = false;
  private lastFrame = 0;
  private accumulator = 0;
  private sendTimer = 0;
  private statusTimer = 0;
  // Server teleports (respawns, snap-backs) are numbered; we echo the latest
  // number in every move so the server can ignore moves sent before it.
  private teleportCount = 0;
  private respawnRequestedAt: number | null = null;

  constructor(container: HTMLElement, input: Input, name: string, level: Level, onDisconnect: (reason: string) => void) {
    this.input = input;
    this.name = name;
    this.level = level;
    const hud = document.getElementById("hud")!;
    this.statusEl = document.getElementById("status")!;
    this.feedEl = document.getElementById("feed")!;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.camera.rotation.order = "YXZ"; // yaw first, then pitch: standard FPS camera
    this.setupScene();

    this.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    this.markers = buildLevel(this.scene, this.world, level);
    this.world.step(); // builds the collision lookup structures before the first move
    this.player = new PlayerController(this.world, level.killY);
    this.remotes = new RemotePlayers(this.scene, this.clock);
    if (level.course) {
      this.parkour = new ParkourHud(hud, this.clock, level.course.checkpoints.length, level.name);
    }

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
    this.net.opened().then(
      () => this.net.send({ t: "hello", name, room: level.id }),
      () => {}, // onClose already reports the failure
    );
  }

  private setupScene(): void {
    const sky = new THREE.Color(this.level.sky);
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, 40, 140);

    this.scene.add(new THREE.HemisphereLight("#dfe9ff", "#4d6b3c", 1.6));

    // The sun follows the player (see frame()), so shadows work anywhere on
    // a long course without needing a huge, blurry shadow map.
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = this.sun.shadow.camera;
    s.left = -SHADOW_RANGE;
    s.right = SHADOW_RANGE;
    s.top = SHADOW_RANGE;
    s.bottom = -SHADOW_RANGE;
    s.far = 120;
    this.scene.add(this.sun, this.sun.target);
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
        this.clock.note(msg.time);
        this.teleportCount = 0;
        this.player.teleport(...msg.spawn);
        for (const info of msg.players) this.remotes.add(info, msg.time);
        this.start();
        break;
      case "join":
        this.clock.note(msg.time);
        this.remotes.add(msg.player, msg.time);
        break;
      case "moved":
        this.clock.note(msg.time);
        this.remotes.push(msg.id, msg.p, msg.ry, msg.time);
        break;
      case "leave":
        this.remotes.remove(msg.id);
        break;
      case "teleport":
        this.teleportCount = msg.tp;
        this.player.teleport(...msg.p);
        this.respawnRequestedAt = null;
        break;
      case "announce":
        this.addFeed(msg.text);
        break;
      case "runStart":
        this.parkour?.runStart(msg.time);
        break;
      case "checkpoint":
        this.parkour?.checkpoint(msg.reached, msg.split);
        this.markers.setReached(msg.reached);
        break;
      case "finish":
        this.parkour?.finish(msg.time, msg.best, msg.newBest);
        break;
      case "runReset":
        this.parkour?.reset();
        this.markers.setReached(0);
        break;
      case "leaderboard":
        this.parkour?.leaderboard(msg.entries, this.name);
        break;
      case "error":
        console.warn("server:", msg.message);
        break;
    }
  }

  // Room-wide messages, bottom right, fading after a few seconds.
  private addFeed(text: string): void {
    const line = document.createElement("div");
    line.textContent = text; // never innerHTML: contains player names
    this.feedEl.appendChild(line);
    while (this.feedEl.childElementCount > 5) this.feedEl.firstElementChild!.remove();
    window.setTimeout(() => line.remove(), FEED_MESSAGE_MS);
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

    if (this.input.consumeRestart() && this.parkour) this.net.send({ t: "restart" });

    // Fell off the level: freeze and ask the server to respawn us (retrying
    // in case the request is lost). The reply is a "teleport" message.
    if (this.player.fellOut) {
      if (this.respawnRequestedAt === null || now - this.respawnRequestedAt > RESPAWN_RETRY_MS) {
        this.net.send({ t: "respawn" });
        this.respawnRequestedAt = now;
      }
    } else {
      // Fixed-step physics.
      this.accumulator += dt;
      while (this.accumulator >= FIXED_DT) {
        this.player.step(FIXED_DT, this.input);
        this.accumulator -= FIXED_DT;
      }
    }

    // Camera follows the interpolated player position.
    const pos = this.player.interpolate(this.accumulator / FIXED_DT);
    this.camera.position.set(pos.x, pos.y + EYE_HEIGHT, pos.z);
    this.camera.rotation.set(this.input.pitch, this.input.yaw, 0);
    this.sun.target.position.copy(pos);
    this.sun.position.copy(pos).add(SUN_OFFSET);

    // Send our position ~20 times a second.
    this.sendTimer += dt * 1000;
    if (this.sendTimer >= NET_INTERVAL_MS) {
      this.sendTimer %= NET_INTERVAL_MS;
      const p = this.player.position;
      const position: Vec3 = [round(p.x), round(p.y), round(p.z)];
      this.net.send({ t: "move", p: position, ry: round(wrapAngle(this.input.yaw)), tp: this.teleportCount });
    }

    this.remotes.update();
    this.markers.update(now / 1000);
    this.parkour?.update();

    this.statusTimer -= dt;
    if (this.statusTimer <= 0) {
      this.statusTimer = 0.5;
      const total = this.remotes.count + 1;
      this.statusEl.textContent = `${this.name} · ${this.level.name} · ${total} wizard${total === 1 ? "" : "s"} here`;
    }

    this.renderer.render(this.scene, this.camera);
  }
}
