// Ties everything together: rendering, physics, input, and networking.
//
// Game-dev note on the loop: physics runs at a fixed 60 steps per second no
// matter how fast the screen refreshes, so jumps are the same height on a 60 Hz
// laptop and a 144 Hz monitor. Each frame we run however many fixed steps fit
// into the elapsed time (the "accumulator"), then draw the camera part-way
// between the last two steps so motion still looks smooth.

import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { EYE_HEIGHT, GRAVITY, NET_INTERVAL_MS, TAG_RANGE } from "../../shared/src/constants.ts";
import type { Level } from "../../shared/src/levels/types.ts";
import { levelInfo } from "../../shared/src/progression.ts";
import type { ServerMsg, Vec3 } from "../../shared/src/protocol.ts";
import type { RoomInfo } from "../../shared/src/rooms.ts";
import { ChaseHud } from "./ChaseHud.ts";
import type { Input } from "./Input.ts";
import { buildLevel, type CheckpointMarkers } from "./levels/buildLevel.ts";
import { SPELLS } from "../../shared/src/combat.ts";
import { chapterForTrial } from "../../shared/src/story.ts";
import { unlockedSet, unlocksAtLevel } from "../../shared/src/unlocks.ts";
import { HubPanel, type PanelProfile } from "./hub/HubPanel.ts";
import { Portals } from "./levels/Portals.ts";
import { StoryCard } from "./StoryCard.ts";
import { Net } from "./Net.ts";
import { ParkourHud } from "./ParkourHud.ts";
import { PlayerController } from "./PlayerController.ts";
import { RemotePlayers } from "./RemotePlayers.ts";
import { Royale } from "./royale/Royale.ts";
import { ServerClock } from "./ServerClock.ts";

const FIXED_DT = 1 / 60;
const MAX_FRAME_DT = 0.1; // after a long pause, don't try to catch up seconds of physics
const RESPAWN_RETRY_MS = 1000;
const FEED_MESSAGE_MS = 6000;
// The sun's shadow camera covers this many meters around the player.
const SHADOW_RANGE = 40;
const SUN_OFFSET = new THREE.Vector3(20, 35, 10);

// The controls line at the bottom left, per mode.
const MOVE_HELP = "WASD move \u00b7 Shift run \u00b7 Space jump";
const HELP: Record<string, string> = {
  hub: "E use",
  parkour: "R restart run",
  tag: "Click tag",
  infection: "Click curse",
  royale: "Click spell \u00b7 Right-click Fireball",
};
const STATION_REACH = 2.2; // meters, to use a hub station

export type GameOptions = {
  name: string;
  profile: PanelProfile; // XP, best times and loadout: unlocks, signs, spells
  room: RoomInfo;
  level: Level;
  from?: string; // the room we just came from (the hub puts us at its portal)
  onDisconnect: (reason: string) => void;
  onPortal: (roomId: string) => void; // walked into a portal in the hub
  onProfile: (profile: PanelProfile) => void; // XP, a best time or the loadout changed
};

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
  private chase: ChaseHud | null = null;
  private portals: Portals | null = null;
  private royale: Royale | null = null;
  private profile: PanelProfile;
  private onProfile: (profile: PanelProfile) => void;
  private hubPanel: HubPanel | null = null;
  private stationHint: HTMLElement | null = null;
  private story: StoryCard | null = null;
  private perkEl: HTMLElement | null = null;
  private onPortal: (roomId: string) => void;
  private resolveReady!: () => void;
  // Resolves once the server has welcomed us into the room (or hung up).
  readonly ready = new Promise<void>((resolve) => (this.resolveReady = resolve));
  private net: Net;
  private input: Input;
  private level: Level;
  private room: RoomInfo;
  private myId = -1;
  private statusEl: HTMLElement;
  private crosshairEl: HTMLElement;
  private feedEl: HTMLElement;
  private name: string;
  private xp: number;
  private levelUpTimer: number | undefined;
  private onResize = () => this.resize();
  // Elements a mode HUD added to #hud; removed again in dispose().
  private hudBaseline: Set<Element>;

  private running = false;
  private disposed = false;
  private lastFrame = 0;
  private accumulator = 0;
  private sendTimer = 0;
  private statusTimer = 0;
  // Server teleports (respawns, snap-backs) are numbered; we echo the latest
  // number in every move so the server can ignore moves sent before it.
  private teleportCount = 0;
  private respawnRequestedAt: number | null = null;

  constructor(container: HTMLElement, input: Input, options: GameOptions) {
    const { room, level, onDisconnect } = options;
    this.input = input;
    this.name = options.name;
    this.profile = { ...options.profile, bestTimes: { ...options.profile.bestTimes } };
    this.onProfile = options.onProfile;
    this.xp = this.profile.xp;
    this.room = room;
    this.level = level;
    this.onPortal = options.onPortal;
    const hud = document.getElementById("hud")!;
    this.hudBaseline = new Set(hud.children);
    this.statusEl = document.getElementById("status")!;
    this.feedEl = document.getElementById("feed")!;
    this.crosshairEl = document.getElementById("crosshair")!;
    this.showXp();

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.camera.rotation.order = "YXZ"; // yaw first, then pitch: standard FPS camera
    this.setupScene();

    this.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    // The player's own world: barriers they've opened are left out.
    this.markers = buildLevel(this.scene, this.world, level, unlockedSet(this.profile.xp, this.profile.bestTimes));
    if (level.portals) this.portals = new Portals(this.scene, level.portals, this.profile.bestTimes);
    this.world.step(); // builds the collision lookup structures before the first move
    this.player = new PlayerController(this.world, level.killY);
    this.remotes = new RemotePlayers(this.scene, this.clock);
    if (room.mode === "parkour" && level.course) {
      this.parkour = new ParkourHud(hud, this.clock, level.course.checkpoints.length, room.name);
      if (chapterForTrial(room.id)) this.story = new StoryCard(hud);
    } else if (room.mode === "tag" || room.mode === "infection") {
      this.chase = new ChaseHud(hud, this.clock, room.mode, room.name, (action) => this.net.send({ t: "bots", action }));
    } else if (room.mode === "royale") {
      const send = (msg: Parameters<Net["send"]>[0]) => this.net.send(msg);
      const slowFactor = SPELLS.frost.slowFactor!;
      this.royale = new Royale(this.scene, hud, this.clock, level, room.name, this.remotes, send, () => this.myId, this.profile.loadout.primary, (ms) =>
        this.player.slow(ms / 1000, slowFactor),
      );
    }
    if (level.stations) {
      this.hubPanel = new HubPanel(
        this.profile,
        (loadout) => this.net.send({ t: "loadout", ...loadout }),
        () => this.input.lock(),
      );
      this.stationHint = document.createElement("div");
      this.stationHint.id = "station-hint";
      hud.appendChild(this.stationHint);
    }
    this.perkEl = document.createElement("div");
    this.perkEl.id = "perk-hud";
    hud.appendChild(this.perkEl);
    this.applyPerks();

    this.resize();
    window.addEventListener("resize", this.onResize);

    this.net = new Net({
      onMessage: (msg) => this.onServerMessage(msg),
      onClose: (reason) => {
        this.running = false;
        this.remotes.clear();
        this.resolveReady(); // nobody is waiting for a welcome that won't come
        onDisconnect(reason);
      },
    });
    this.net.opened().then(
      () => this.net.send({ t: "hello", room: room.id, from: options.from }),
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
    if (this.disposed) return; // still in flight when we left
    if (this.royale?.onMessage(msg)) return;
    switch (msg.t) {
      case "welcome":
        this.myId = msg.id;
        this.clock.note(msg.time);
        this.teleportCount = 0;
        this.player.teleport(...msg.spawn);
        this.input.yaw = msg.yaw ?? this.level.spawnYaw ?? 0;
        this.input.pitch = 0;
        if (this.story) this.story.intro(chapterForTrial(this.room.id)!);
        for (const info of msg.players) {
          this.remotes.add(info, msg.time);
          this.royale?.onRemoteAdded(info.id);
        }
        this.start();
        this.resolveReady();
        break;
      case "join":
        this.clock.note(msg.time);
        this.remotes.add(msg.player, msg.time);
        this.royale?.onRemoteAdded(msg.player.id);
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
        this.story?.hideSoon();
        break;
      case "checkpoint":
        this.parkour?.checkpoint(msg.reached, msg.split);
        this.markers.setReached(msg.reached);
        break;
      case "finish": {
        this.parkour?.finish(msg.time, msg.best, msg.newBest);
        this.profile.bestTimes[this.room.id] = msg.best;
        this.onProfile(this.profile);
        const chapter = chapterForTrial(this.room.id);
        if (msg.firstClear && chapter) this.story?.outro(chapter);
        break;
      }
      case "runReset":
        this.parkour?.reset();
        this.markers.setReached(0);
        break;
      case "leaderboard":
        this.parkour?.leaderboard(msg.entries, this.name);
        break;
      case "round":
        this.chase?.round(msg.state, msg.endsAt);
        break;
      case "chasers":
        this.remotes.setChasers(msg.ids, this.room.mode === "tag" ? "it" : "cursed");
        this.chase?.chasers(msg.ids, this.myId, this.remotes.count + 1);
        break;
      case "tagged":
        break; // the "chasers" and "announce" messages that follow carry the news
      case "xp":
        this.onXp(msg.amount, msg.reason, msg.total);
        break;
      case "botCount":
        this.chase?.botCount(msg.count, msg.max);
        break;
      case "roundResult":
        this.chase?.result(msg.title, msg.lines);
        break;
      case "roomCounts":
        this.portals?.setCounts(msg.counts);
        break;
      case "look":
        this.remotes.setLook(msg.id, msg.look);
        break;
      case "loadoutSaved":
        this.profile.loadout = { primary: msg.primary, hat: msg.hat, robe: msg.robe };
        this.hubPanel?.update(this.profile);
        this.onProfile(this.profile);
        break;
      case "error":
        console.warn("server:", msg.message);
        break;
    }
  }

  // Tag / infection: who would a click tag right now? (null if nobody, or if
  // you're not a chaser in a live round.)
  private tagTarget(): number | null {
    if (!this.chase?.playing || !this.chase.isChaser) return null;
    const skip = this.room.mode === "tag" ? "it" : "cursed";
    return this.remotes.findTarget(this.player.position, this.input.yaw, TAG_RANGE, skip);
  }

  // ---- XP and levels ----

  private showXp(): void {
    const info = levelInfo(this.xp);
    document.getElementById("xp-level")!.textContent = `Lv ${info.level}`;
    document.getElementById("xp-fill")!.style.width = `${(100 * info.intoLevel) / info.forNext}%`;
  }

  private onXp(amount: number, reason: string, total: number): void {
    const before = levelInfo(this.xp).level;
    this.xp = total;
    this.profile.xp = total;
    this.onProfile(this.profile);
    this.showXp();
    this.addFeed(`+${amount} XP \u00b7 ${reason}`);
    const after = levelInfo(total).level;
    if (after > before) {
      const unlocked: string[] = [];
      for (let level = before + 1; level <= after; level++) unlocked.push(...unlocksAtLevel(level).map((u) => u.name));
      for (const name of unlocked) this.addFeed(`Unlocked: ${name}!`);
      this.applyPerks();
      this.hubPanel?.update(this.profile);
      const el = document.getElementById("levelup")!;
      el.textContent = `Level up! You're level ${after}${unlocked.length ? ` \u00b7 ${unlocked.join(", ")}` : ""}`;
      el.classList.add("show");
      window.clearTimeout(this.levelUpTimer);
      this.levelUpTimer = window.setTimeout(() => el.classList.remove("show"), 3500);
    }
  }

  // Movement perks from unlocks. Not in the trials, so times stay comparable.
  private applyPerks(): void {
    const unlocked = unlockedSet(this.profile.xp, this.profile.bestTimes);
    const allowed = this.room.mode !== "parkour";
    this.player.perks = { doubleJump: allowed && unlocked.has("perk:doubleJump"), dash: allowed && unlocked.has("perk:dash") };
    const extra = [HELP[this.room.mode], this.player.perks.dash ? "Q dash" : ""].filter(Boolean);
    document.getElementById("help")!.textContent = [MOVE_HELP, ...extra, "Esc pause"].join(" \u00b7 ");
    if (this.perkEl) {
      const names = [this.player.perks.doubleJump ? "Double Jump" : "", this.player.perks.dash ? "Q Blink Dash" : ""].filter(Boolean);
      this.perkEl.textContent = names.join(" \u00b7 ");
      this.perkEl.hidden = names.length === 0;
    }
  }

  // Is a station's window open? (main.ts keeps the pause panel hidden then.)
  get panelOpen(): boolean {
    return this.hubPanel?.isOpen ?? false;
  }

  // Esc while a station's window is open closes it.
  closePanel(): void {
    this.hubPanel?.close();
  }

  // Hub stations: show "E: Spellbook" when close enough, open on E.
  private updateStations(): void {
    if (!this.hubPanel || !this.stationHint) return;
    const p = this.player.position;
    const near = this.level.stations?.find((s) => Math.hypot(s.pos[0] - p.x, s.pos[2] - p.z) < STATION_REACH && Math.abs(p.y - 0.9 - s.pos[1]) < 1.5);
    this.stationHint.textContent = near && !this.hubPanel.isOpen ? `E \u00b7 ${near.label}` : "";
    this.stationHint.classList.toggle("show", !!near && !this.hubPanel.isOpen);
    if (this.input.consumeInteract() && near && !this.hubPanel.isOpen) {
      this.hubPanel.open(near);
      document.exitPointerLock(); // free the mouse to click in the window
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

  // Leave the room (Exit) and free everything this game created: the socket,
  // the WebGL context, the physics world, and the mode's HUD elements. The
  // page can then start a new Game in another room.
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    const closed = this.net.close();
    window.removeEventListener("resize", this.onResize);
    window.clearTimeout(this.levelUpTimer);

    this.royale?.dispose();
    this.story?.dispose();
    this.hubPanel?.close();
    this.remotes.clear();
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) m.dispose();
      }
    });
    this.renderer.dispose();
    // Browsers cap live WebGL contexts (~16); release ours now, not at GC.
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.world.free();

    const hud = document.getElementById("hud")!;
    for (const child of [...hud.children]) if (!this.hudBaseline.has(child)) child.remove();
    this.feedEl.replaceChildren();
    this.crosshairEl.classList.remove("target", "hit");
    document.getElementById("levelup")!.classList.remove("show");
    document.getElementById("bot-controls")!.hidden = true;
    document.body.classList.remove("role-it", "role-cursed");
    // Wait for the server to drop us from this room before anyone joins the
    // next one (otherwise it looks like a second tab and kicks this one).
    await closed;
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

    // Tagging: the crosshair turns red when someone is in reach; click to tag.
    const target = this.tagTarget();
    this.crosshairEl.classList.toggle("target", target !== null);
    const clicked = this.input.consumeClick();
    if (clicked && target !== null) this.net.send({ t: "tag", target });
    // Battle royale: click casts a bolt, right-click a fireball, from your eyes
    // along where you're looking.
    const rightClicked = this.input.consumeRightClick();
    if (this.royale && (clicked || rightClicked)) {
      const dir = this.camera.getWorldDirection(new THREE.Vector3());
      this.royale.cast(clicked ? "primary" : "fireball", this.camera.position, dir);
    }

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
    this.portals?.update(now / 1000);
    this.royale?.update(now / 1000, this.player.position, this.clock.now());
    this.updateStations();
    if (this.perkEl) this.perkEl.classList.toggle("cooling", this.player.dashCooldown > 0);
    if (this.portals) {
      const p = this.player.position;
      const target = this.portals.enteredPortal([p.x, p.y, p.z]);
      if (target) {
        this.running = false; // stop sending moves; main.ts switches rooms
        this.onPortal(target);
        return;
      }
    }
    this.parkour?.update();
    this.chase?.update();

    this.statusTimer -= dt;
    if (this.statusTimer <= 0) {
      this.statusTimer = 0.5;
      const total = this.remotes.count + 1;
      // Modes with a center panel already show the room name there.
      const where = this.parkour || this.chase || this.royale ? "" : ` \u00b7 ${this.room.name}`;
      this.statusEl.textContent = `${this.name}${where} \u00b7 ${total} wizard${total === 1 ? "" : "s"} here`;
    }

    this.renderer.render(this.scene, this.camera);
  }
}
