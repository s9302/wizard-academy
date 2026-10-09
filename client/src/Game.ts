// Ties everything together: rendering, physics, input, and networking.
//
// Game-dev note on the loop: physics runs at a fixed 60 steps per second no
// matter how fast the screen refreshes, so jumps are the same height on a 60 Hz
// laptop and a 144 Hz monitor. Each frame we run however many fixed steps fit
// into the elapsed time (the "accumulator"), then draw the camera part-way
// between the last two steps so motion still looks smooth.

import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { CROUCH_DROP, EYE_HEIGHT, GRAVITY, NET_INTERVAL_MS, TAG_RANGE } from "../../shared/src/constants.ts";
import { LEVELS } from "../../shared/src/levels/index.ts";
import type { Box, Level } from "../../shared/src/levels/types.ts";
import { levelInfo } from "../../shared/src/progression.ts";
import type { MoveMsg, ServerMsg, Vec3 } from "../../shared/src/protocol.ts";
import { HUB_ROOM, type RoomInfo } from "../../shared/src/rooms.ts";
import { ChaseHud } from "./ChaseHud.ts";
import { Ditchquid } from "./ditchquid/Ditchquid.ts";
import { Pickups } from "./royale/Pickups.ts";
import { POWERUPS, type PowerupKind } from "../../shared/src/combat.ts";
import type { Input } from "./Input.ts";
import { buildLevel, type CheckpointMarkers } from "./levels/buildLevel.ts";
import { SPELLS } from "../../shared/src/combat.ts";
import { chapterForTrial } from "../../shared/src/story.ts";
import { unlocksAtLevel, unlocksFor } from "../../shared/src/unlocks.ts";
import { DRAGON, GIANT, GLIDE } from "../../shared/src/abilities.ts";
import { HubPanel, type PanelProfile } from "./hub/HubPanel.ts";
import { Portals } from "./levels/Portals.ts";
import { StoryCard } from "./StoryCard.ts";
import { addDecor, onGrass } from "./levels/Decor.ts";
import { fancy, quality, ultra } from "./quality.ts";
import { PostFX } from "./graphics/PostFX.ts";
import { Particles, particles } from "./graphics/Particles.ts";
import { addProps } from "./levels/Props.ts";
import { addFeatures, type Features } from "./levels/Features.ts";
import { Trial } from "./trials/Trial.ts";
import { Npcs } from "./npcs/Npcs.ts";
import { Sky } from "./Sky.ts";
import { Net } from "./Net.ts";
import { ParkourHud } from "./ParkourHud.ts";
import { PlayerController } from "./PlayerController.ts";
import { RemotePlayers } from "./RemotePlayers.ts";
import { Royale, rockModel } from "./royale/Royale.ts";
import { BOSSES } from "../../shared/src/bosses.ts";
import { BossView } from "./bosses/BossView.ts";
import { CtfView } from "./ctf/CtfView.ts";
import { ServerClock } from "./ServerClock.ts";
import { animateAvatar, createAvatar, setAvatarBroom, dieAvatar, disguiseAvatar, disposeAvatar, reviveAvatar, setAvatarLook, setAvatarWeapon } from "./Avatar.ts";

const DEATH_VIEW_MS = 1800; // how long your own fall takes before spectating
import { lookOf } from "../../shared/src/unlocks.ts";
import { sound } from "./audio/Sound.ts";
import { moodFor } from "./audio/tracks.ts";

const FIXED_DT = 1 / 60;
const MAX_FRAME_DT = 0.1; // after a long pause, don't try to catch up seconds of physics
const RESPAWN_RETRY_MS = 1000;
const FEED_MESSAGE_MS = 6000;
// The sun's shadow camera covers this many meters around the player.
const SHADOW_RANGE = 40;
const SUN_DISTANCE = 45; // the shadow-casting light sits this far toward the sun

// The controls line at the bottom left, per mode.
const MOVE_HELP = "WASD move \u00b7 Shift (or W W) run \u00b7 Space jump \u00b7 C crouch";
const HELP: Record<string, string> = {
  // (V third person is added to every mode in applyPerks)
  hub: "E use",
  parkour: "R restart run",
  tag: "Click tag \u00b7 R respawn",
  infection: "Click curse \u00b7 R respawn",
  royale: "Click attack \u00b7 1/2 swap \u00b7 E/R abilities \u00b7 Right-click Fireball \u00b7 F powerup",
  boss: "Click attack \u00b7 1/2 swap \u00b7 E/R abilities \u00b7 Right-click Fireball \u00b7 F powerup",
  ctf: "Click attack \u00b7 1/2 swap \u00b7 E/R abilities \u00b7 F powerup \u00b7 grab the enemy flag",
  ditchquid: "Look to steer \u00b7 Space up \u00b7 C down \u00b7 Click throw (or jinx without the ball)",
};
const STATION_REACH = 2.2; // meters, to use a hub station
const STEP_EVERY = 2.1; // meters walked per footstep sound
const STEPS = ["stepStone0", "stepStone1", "stepStone2", "stepStone3"] as const;
const GRASS_STEPS = ["stepGrass0", "stepGrass1", "stepGrass2", "stepGrass3"] as const;

export type GameOptions = {
  name: string;
  profile: PanelProfile; // XP, best times and loadout: unlocks, signs, spells
  room: RoomInfo;
  level: Level;
  from?: string; // the room we just came from (the hub puts us at its portal)
  onDisconnect: (reason: string, kicked: boolean) => void;
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
  private sky!: Sky;
  private postfx: PostFX | null = null;
  private particleSystem: Particles;
  private props: { update(time: number, dt: number): void } | null = null;
  private features: Features | null = null;
  private trial: Trial | null = null;
  private bossView: BossView | null = null; // Trial VII
  private ctfView: CtfView | null = null; // capture the flag
  private myTeam: 0 | 1 | null = null;
  private npcs: Npcs | null = null;
  private talkHint: HTMLElement | null = null;
  // Third person (V): your own body, and a camera over your shoulder.
  private thirdPerson = false;
  private selfAvatar: THREE.Group | null = null;
  private invertUntil = 0; // Inversion: the camera rolled upside down until then
  private giantUntil = 0; // your own Giant Form
  private rockOn = false; // your own Rock Disguise
  private spinUntil = 0; // caught in a tornado: the view turns on its own
  private deathAt = -Infinity; // knocked out: the view drops and tilts, then you spectate
  private selfLast = new THREE.Vector3();
  private selfSpeed = 0;
  private camDistance = 3.4;
  private sunOffset = new THREE.Vector3();
  private world!: RAPIER.World;
  // Everything that belongs to the current level (blocks, sky, grass), so
  // the battle royale can swap arenas without rebuilding the whole game.
  private levelRoot = new THREE.Group();
  private hemi = new THREE.HemisphereLight("#dfe9ff", "#4d6b3c", 1.6);
  private player!: PlayerController;
  private clock = new ServerClock();
  private remotes: RemotePlayers;
  private markers!: CheckpointMarkers;
  private parkour: ParkourHud | null = null;
  private chase: ChaseHud | null = null;
  private dq: Ditchquid | null = null;
  // Tag and infection's powerups (the arena's are in Royale).
  private chasePickups: Pickups | null = null;
  private chaseHeld: PowerupKind | null = null;
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
    sound.music(moodFor(room.mode));

    // Ultra anti-aliases in its post-processing chain instead (PostFX.ts).
    this.renderer = new THREE.WebGLRenderer({ antialias: !ultra(), powerPreference: "high-performance" });
    // Low quality draws at 1 pixel per CSS pixel (much less work on high-DPI
    // screens); Ultra caps at 1.5 because its extra passes cost per pixel.
    const dpr = window.devicePixelRatio;
    this.renderer.setPixelRatio(quality() === "high" ? Math.min(dpr, 2) : ultra() ? Math.min(dpr, 1.5) : 1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = ultra() ? THREE.VSMShadowMap : THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);
    this.particleSystem = new Particles(this.scene);
    particles.set(this.particleSystem);

    this.camera.rotation.order = "YXZ"; // yaw first, then pitch: standard FPS camera
    this.setupScene();

    this.loadLevel(level);
    if (level.portals) this.portals = new Portals(this.scene, level.portals, this.profile.bestTimes);
    this.remotes = new RemotePlayers(this.scene, this.clock);
    if (room.mode === "parkour" && level.course) {
      this.parkour = new ParkourHud(hud, this.clock, level.course.checkpoints.length, room.name);
      if (chapterForTrial(room.id)) this.story = new StoryCard(hud);
    } else if (room.mode === "tag" || room.mode === "infection") {
      this.chase = new ChaseHud(hud, this.clock, room.mode, room.name, (action) => this.net.send({ t: "bots", action }), {
        onMap: (map) => this.net.send({ t: "chaseMap", map }),
        onUnstuck: () => this.net.send({ t: "unstuck" }),
        onGrapple: (on) => this.net.send({ t: "chaseSetting", grapple: on }),
        onPowerups: (on) => this.net.send({ t: "chaseSetting", powerups: on }),
      });
      this.chasePickups = new Pickups(this.scene);
    } else if (room.mode === "ditchquid") {
      this.dq = new Ditchquid(this.scene, hud, this.clock, level, room.name, this.remotes, {
        send: (msg) => this.net.send(msg),
        myId: () => this.myId,
        slow: (seconds, factor) => this.player.slow(seconds, factor),
        feed: (text) => this.addFeed(text),
      });
      this.player.setBroom(true); // everyone's on a broom, all match
    } else if (room.mode === "royale" || room.mode === "boss" || room.mode === "ctf" || room.mode === "horde") {
      const send = (msg: Parameters<Net["send"]>[0]) => this.net.send(msg);
      const slowFactor = SPELLS.frost.slowFactor!;
      this.scene.add(this.camera); // the weapon in view is a child of the camera
      this.royale = new Royale(this.scene, this.camera, hud, this.clock, level, room.name, this.remotes, this.profile.loadout.primary, this.profile.loadout.cls, {
        send,
        myId: () => this.myId,
        horde: room.mode === "horde",
        onSlowed: (ms) => this.player.slow(ms / 1000, slowFactor),
        onSpeed: (m) => (this.player.speedMul = m),
        feed: (text) => this.addFeed(text),
        onConjure: (id, box) => this.addConjured(id, box),
        onUnconjure: (id) => this.removeConjured(id),
        onCharge: (dir, speed, seconds) => this.player.burst(dir.x, dir.z, speed, seconds),
        onKnock: (v, seconds) => this.player.knock(v[0], v[1], v[2], seconds),
        onGlide: (seconds) => this.player.glide(seconds, GLIDE.lift, GLIDE.fall, GLIDE.speed),
        onSoar: (seconds) => this.player.soar(seconds, DRAGON.climb, DRAGON.speed),
        onFreeze: (seconds) => this.player.freeze(seconds),
        onInvert: (ms) => (this.invertUntil = performance.now() + ms),
        onGiant: (ms) => (this.giantUntil = performance.now() + ms),
        onSpin: (ms) => (this.spinUntil = performance.now() + ms),
        onMultiJump: (seconds, jumps) => this.player.multiJump(seconds, jumps),
        onRock: (on) => {
          this.rockOn = on;
          if (this.selfAvatar) disguiseAvatar(this.selfAvatar, on ? rockModel() : null);
        },
        onDeath: () => {
          this.deathAt = performance.now();
          if (this.selfAvatar) dieAvatar(this.selfAvatar);
        },
        onRevive: () => {
          this.deathAt = -Infinity;
          if (this.selfAvatar) reviveAvatar(this.selfAvatar);
        },
        selfClone: () => createAvatar(this.myId, this.name, lookOf(this.profile.loadout), this.profile.isAdmin),
        unlocked: () => unlocksFor(this.profile),
        onArena: (id) => {
          const next = LEVELS[id];
          if (next && next !== this.level) this.loadLevel(next);
        },
      });
    }
    // Capture the flag: the arena's combat, plus the flags.
    if (room.mode === "ctf" && level.ctf) {
      this.ctfView = new CtfView(this.scene, hud, level.ctf.flags, {
        positionOf: (id) => (id === this.myId ? this.player.position : this.remotes.positionOf(id) ? new THREE.Vector3(...this.remotes.positionOf(id)!) : null),
        myTeam: () => this.myTeam,
        myId: () => this.myId,
      });
    }
    // Trial VII: the arena's combat, plus the boss.
    if (room.mode === "boss" && level.bossFight) {
      this.bossView = new BossView(this.scene, hud, this.clock, level.bossFight.boss, level.bossFight.home);
      if (this.royale) this.royale.hud.bossHint = BOSSES[level.bossFight.boss].hint ?? this.royale.hud.bossHint;
      if (chapterForTrial(room.id)) this.story = new StoryCard(hud);
    }
    if (room.mode === "parkour" && level.course?.tasks?.length) {
      this.trial = new Trial(this.scene, hud, this.clock, level, { send: (msg) => this.net.send(msg), feed: (text) => this.addFeed(text) });
    }
    if (level.props?.some((p) => p.kind === "npc" || p.kind === "student")) this.npcs = new Npcs(this.scene, level);
    if (level.stations) {
      this.hubPanel = new HubPanel(
        this.profile,
        (loadout) => this.net.send({ t: "loadout", ...loadout }),
        () => this.input.lock(),
        () => this.myId,
        () => this.name,
      );
      this.stationHint = document.createElement("div");
      this.stationHint.id = "station-hint";
      hud.appendChild(this.stationHint);
    }
    this.perkEl = document.createElement("div");
    this.perkEl.id = "perk-hud";
    hud.appendChild(this.perkEl);
    this.applyPerks();

    if (ultra()) this.postfx = new PostFX(this.renderer, this.scene, this.camera);
    this.resize();
    window.addEventListener("resize", this.onResize);

    this.net = new Net({
      onMessage: (msg) => this.onServerMessage(msg),
      onClose: (reason, kicked) => {
        this.running = false;
        this.remotes.clear();
        this.resolveReady(); // nobody is waiting for a welcome that won't come
        onDisconnect(reason, kicked);
      },
    });
    this.net.opened().then(
      () => this.net.send({ t: "hello", room: room.id, from: options.from }),
      () => {}, // onClose already reports the failure
    );
  }

  // Build (or rebuild, for a new arena) the level: blocks and colliders,
  // grass, the sky. The player keeps their place, perks and speed.
  private loadLevel(level: Level): void {
    this.level = level;
    this.levelRoot.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Sprite || obj instanceof THREE.InstancedMesh) {
        obj.geometry.dispose();
        for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) {
          (m as THREE.Material & { map?: THREE.Texture }).map?.dispose();
          m.dispose();
        }
      }
    });
    this.levelRoot.clear();
    this.conjured?.clear(); // they were in the old world
    const old = this.player as PlayerController | undefined;
    this.world?.free();
    this.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    // The player's own world: barriers they've opened are left out.
    this.markers = buildLevel(this.levelRoot, this.world, level, unlocksFor(this.profile));
    if (fancy()) addDecor(this.levelRoot, level);
    const style = level.skyStyle ?? "day";
    this.sky = new Sky(this.levelRoot, this.scene, style, fancy());
    this.sun.color.copy(this.sky.sunColor);
    this.sun.intensity = this.sky.preset.sunIntensity;
    this.sunOffset.copy(this.sky.sunDirection).multiplyScalar(SUN_DISTANCE);
    // Light from the whole sky (blue-ish from above, earthy from below).
    this.hemi.color.set(this.sky.preset.hemiSky);
    this.hemi.groundColor.set(this.sky.preset.hemiGround);
    this.hemi.intensity = this.sky.preset.hemi;
    this.features = addFeatures(this.levelRoot, level);
    this.props = addProps(this.levelRoot, level, {
      sunDir: this.sky.sunDirection,
      sky: this.sky.horizon,
      lightBudget: 16 - (level.lights?.length ?? 0) - (level.portals?.length ?? 0),
    });
    this.world.step(); // builds the collision lookup structures before the first move
    this.player = new PlayerController(this.world, level.killY);
    this.player.ladders = level.ladders ?? [];
    this.player.jumpPads = level.jumpPads ?? [];
    if (old) {
      this.player.perks = old.perks;
      this.player.speedMul = old.speedMul;
      this.player.flying = old.flying;
      this.player.teleport(old.position.x, old.position.y, old.position.z);
    }
    this.royale?.setLevel(level);
  }

  // ---- Conjured walls and pillars (battle royale) ----

  private conjured = new Map<number, { mesh: THREE.Mesh; collider: RAPIER.Collider; box: Box; born: number }>();

  private addConjured(id: number, box: Box): void {
    this.removeConjured(id);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...box.size), new THREE.MeshLambertMaterial({ color: box.color, flatShading: true }));
    mesh.position.set(...box.pos);
    if (box.rot) mesh.rotation.set(...box.rot);
    mesh.castShadow = mesh.receiveShadow = true;
    this.levelRoot.add(mesh);
    const q = mesh.quaternion;
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(box.size[0] / 2, box.size[1] / 2, box.size[2] / 2)
        .setTranslation(...box.pos)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
    );
    this.conjured.set(id, { mesh, collider, box, born: performance.now() });
    sound.fx("rumble", { at: box.pos });
    sound.play(["mining0", "mining1"], { at: box.pos, volume: 0.7, rate: 0.8 });
    this.royale?.setBoxes([...this.level.boxes, ...[...this.conjured.values()].map((c) => c.box)]);
  }

  private removeConjured(id: number): void {
    const c = this.conjured.get(id);
    if (!c) return;
    this.conjured.delete(id);
    this.levelRoot.remove(c.mesh);
    c.mesh.geometry.dispose();
    (c.mesh.material as THREE.Material).dispose();
    this.world.removeCollider(c.collider, false);
    this.royale?.setBoxes([...this.level.boxes, ...[...this.conjured.values()].map((x) => x.box)]);
  }

  // Walls rise out of the ground over a quarter second.
  private animateConjured(): void {
    const now = performance.now();
    for (const c of this.conjured.values()) {
      const k = Math.min(1, (now - c.born) / 250);
      const h = c.box.size[1];
      c.mesh.scale.y = Math.max(0.05, k);
      c.mesh.position.y = c.box.pos[1] - (h * (1 - c.mesh.scale.y)) / 2;
    }
  }

  private setupScene(): void {
    this.scene.add(this.levelRoot, this.hemi);

    // The sun follows the player (see frame()), so shadows work anywhere on
    // a long course without needing a huge, blurry shadow map.
    this.sun.castShadow = true;
    const size = ultra() ? 4096 : quality() === "high" ? 2048 : 1024;
    this.sun.shadow.mapSize.set(size, size);
    if (ultra()) {
      // Soft-edged shadows (variance shadow maps blur well).
      this.sun.shadow.radius = 6;
      this.sun.shadow.blurSamples = 12;
      this.sun.shadow.bias = -0.0004;
    }
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
    this.postfx?.setPixelRatio(this.renderer.getPixelRatio());
    this.postfx?.setSize(w, h);
    this.particleSystem.resize(h * this.renderer.getPixelRatio(), this.camera.fov);
  }

  private onServerMessage(msg: ServerMsg): void {
    if (this.disposed) return; // still in flight when we left
    if (this.bossView?.onMessage(msg)) return;
    if (this.ctfView?.onMessage(msg)) return;
    if (this.dq?.onMessage(msg)) return;
    if (msg.t === "teams") this.myTeam = msg.teams ? (msg.teams[0].includes(this.myId) ? 0 : msg.teams[1].includes(this.myId) ? 1 : null) : null;
    if (msg.t === "round" && msg.state === "playing") this.story?.hideSoon(); // Trial VII's fight begins
    if (this.royale?.onMessage(msg)) return;
    if (this.trial?.onMessage(msg, this.myId)) return;
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
        this.remotes.push(msg.id, msg.p, msg.ry, msg.time, !!msg.c, !!msg.b);
        break;
      case "leave":
        this.remotes.remove(msg.id);
        break;
      case "teleport":
        this.teleportCount = msg.tp;
        this.player.teleport(...msg.p);
        if (msg.yaw !== undefined) this.input.yaw = msg.yaw;
        this.respawnRequestedAt = null;
        break;
      case "warp":
        // A teleporter: a flash where they left and where they arrive.
        for (const at of [msg.from, msg.to]) {
          particles.emit({ at, count: 40, color: "#5ac8ff", color2: "#ffffff", speed: 3, up: 1, spread: 0.6, life: 0.7, size: 0.2 });
          sound.fx("portal", { at: msg.id === this.myId ? null : at, volume: 0.6 });
        }
        break;
      case "announce":
        this.addFeed(msg.text);
        break;
      case "runStart":
        sound.fx("go", { volume: 0.6 });
        this.parkour?.runStart(msg.time);
        this.story?.hideSoon();
        break;
      case "checkpoint":
        if (msg.reached > 0) sound.fx("checkpoint");
        this.parkour?.checkpoint(msg.reached, msg.split);
        this.markers.setReached(msg.reached);
        break;
      case "finish": {
        this.showExitPortal();
        this.parkour?.finish(msg.time, msg.best, msg.newBest);
        sound.fx(msg.newBest ? "victory" : "finish");
        this.profile.bestTimes[this.room.id] = msg.best;
        this.onProfile(this.profile);
        const chapter = chapterForTrial(this.room.id);
        if (msg.firstClear && chapter) this.story?.outro(chapter);
        break;
      }
      case "runReset":
        this.trial?.reset();
        this.parkour?.reset();
        this.markers.setReached(0);
        break;
      case "leaderboard":
        this.parkour?.leaderboard(msg.entries, this.name);
        break;
      case "round":
        if (this.chase && msg.state === "playing") sound.fx("go", { volume: 0.7 });
        if (this.chase && msg.state === "ended") sound.play("bell", { volume: 0.6 });
        this.chase?.round(msg.state, msg.endsAt);
        break;
      case "arena": {
        // Tag and infection switch maps between rounds (the arena's own
        // switches go through Royale).
        const next = LEVELS[msg.levelId];
        if (next && next !== this.level) this.loadLevel(next);
        break;
      }
      case "chaseMaps":
        this.chase?.maps(msg.maps, msg.current, msg.next);
        break;
      case "chaseSettings":
        this.chase?.setGrapple(msg.grapple);
        this.chase?.setPowerups(msg.powerups);
        break;
      case "pickups":
        this.chasePickups?.set(msg.items);
        break;
      case "held":
        if (msg.kind) sound.play("pickup", { volume: 0.7, rate: 1.3 });
        this.chaseHeld = msg.kind;
        this.chase?.powerup(msg.kind);
        break;
      case "knock":
        // Pulled by a grapple (the arena's knocks go through Royale).
        this.player.knock(msg.v[0], msg.v[1], msg.v[2], msg.s);
        break;
      case "effect":
        if (msg.kind === "chain" && msg.from && msg.to) this.drawChain(msg.from, msg.to, msg.ms, msg.id === this.myId);
        else this.chasePowerupEffect(msg.id, msg.kind, msg.ms);
        break;
      case "chasers":
        if (msg.ids.includes(this.myId) && !this.chase?.isChaser) sound.fx("sting");
        this.remotes.setChasers(msg.ids, this.room.mode === "tag" ? "it" : "cursed");
        this.chase?.chasers(msg.ids, this.myId, this.remotes.count + 1);
        break;
      case "tagged": {
        // The "chasers" and "announce" messages that follow carry the news.
        const at = msg.victim === this.myId ? null : this.remotes.positionOf(msg.victim);
        sound.play(["punch0", "punch1", "punch2"], { at, volume: 0.9 });
        break;
      }
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
      case "bounce":
        sound.play("softHeavy");
        sound.play("punchHeavy0", { volume: 0.7 });
        this.player.bounce();
        break;
      case "loadoutSaved":
        {
          const { t: _t, ...saved } = msg;
          this.profile.loadout = saved;
          if (this.selfAvatar) setAvatarLook(this.selfAvatar, this.myId, lookOf(saved));
        }
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
  // A powerup someone used in tag or infection.
  private chaseHasteUntil = 0;
  private chasePowerupEffect(id: number, kind: string, ms: number): void {
    if (!this.chase) return;
    const mine = id === this.myId;
    const at = mine ? null : this.remotes.positionOf(id);
    const color = { haste: "#ffe14a", quadjump: "#dff3ff", stealth: "#9a6cff" }[kind];
    if (!color) return;
    if (kind === "stealth") {
      if (ms > 0) sound.fx("stealth", { at });
      if (mine) {
        this.chase.cloaked(ms > 0);
        if (ms > 0) this.addFeed("You're invisible! Tagging someone gives you away.");
      } else this.remotes.setVisible(id, ms === 0);
      return;
    }
    sound.fx("blink", { at, rate: kind === "haste" ? 1.5 : 1.1 });
    if (at) particles.emit({ at, count: 35, color, color2: "#ffffff", speed: 3, up: 2, life: 0.7, size: 0.18 });
    if (!mine) {
      this.remotes.glow(id, color, ms);
      return;
    }
    if (kind === "haste") {
      this.chaseHasteUntil = performance.now() + ms;
      this.player.speedMul = POWERUPS.haste.speed;
      setTimeout(() => {
        if (this.chase && performance.now() >= this.chaseHasteUntil - 20) this.player.speedMul = 1;
      }, ms + 20);
      this.addFeed("Haste! You run faster for a few seconds.");
    } else if (kind === "quadjump") {
      this.player.multiJump(ms / 1000, POWERUPS.quadjump.jumps);
      this.addFeed("Cloud Boots! Jump four times in a row.");
    }
  }

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
    sound.play("coins", { volume: 0.6 });
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
      sound.fx("levelUp");
      window.clearTimeout(this.levelUpTimer);
      this.levelUpTimer = window.setTimeout(() => el.classList.remove("show"), 3500);
    }
  }

  // Brooms: anywhere in the academy (B gets on and off).
  private get brooms(): boolean {
    return this.room.mode === "hub";
  }

  // Movement perks from unlocks. Not in the trials, so times stay comparable.
  private applyPerks(): void {
    const unlocked = unlocksFor(this.profile);
    const allowed = this.room.mode !== "parkour";
    this.player.perks = { doubleJump: allowed && unlocked.has("perk:doubleJump"), dash: allowed && unlocked.has("perk:dash") };
    const extra = [HELP[this.room.mode], this.brooms ? "B broom" : "", this.player.perks.dash ? "Q dash" : "", this.profile.isAdmin ? "F fly" : ""].filter(Boolean);
    const help = [this.room.mode === "ditchquid" ? "WASD fly \u00b7 Shift fast" : MOVE_HELP, ...extra, "V view", "Esc pause"].join(" \u00b7 ");
    document.getElementById("help")!.textContent = help;
    document.getElementById("pause-help")!.textContent = help;
    if (this.perkEl) {
      const names = [this.player.perks.doubleJump ? "Double Jump" : "", this.player.perks.dash ? "Q Blink Dash" : ""].filter(Boolean);
      this.perkEl.textContent = names.join(" \u00b7 ");
      this.perkEl.hidden = names.length === 0;
    }
  }

  // Did the server welcome us into the room?
  get connected(): boolean {
    return this.myId > 0;
  }

  // Is a station's window open? (main.ts keeps the pause panel hidden then.)
  get panelOpen(): boolean {
    return this.hubPanel?.isOpen ?? false;
  }

  // The pause panel's "Customize your wizard" (hub only).
  openWardrobe(): boolean {
    if (!this.hubPanel) return false;
    this.hubPanel.openWardrobe();
    return true;
  }

  // Esc while a station's window is open closes it.
  closePanel(): void {
    this.hubPanel?.close();
  }

  // Hub stations: show "E: Spellbook" when close enough, open on E.
  private updateStations(): void {
    // People to talk to come first (in the hub, and in the trials).
    if (this.npcs) {
      const who = this.npcs.nearest(this.player.position);
      if (who || this.npcs.isTalking) {
        this.talkHint ??= this.stationHint ?? this.makeHint();
        this.talkHint.textContent = this.npcs.isTalking ? "" : `E \u00b7 Talk to ${who}`;
        this.talkHint.classList.toggle("show", !this.npcs.isTalking);
        if (!this.royale && this.input.consumeInteract()) this.npcs.interact(this.player.position);
        return;
      }
      if (this.talkHint && !this.hubPanel) this.talkHint.classList.remove("show");
    }
    if (!this.hubPanel || !this.stationHint) return;
    const p = this.player.position;
    const near = this.level.stations?.find((s) => Math.hypot(s.pos[0] - p.x, s.pos[2] - p.z) < STATION_REACH && Math.abs(p.y - 0.9 - s.pos[1]) < 1.5);
    this.stationHint.textContent = near && !this.hubPanel.isOpen ? `E \u00b7 ${near.label}` : "";
    this.stationHint.classList.toggle("show", !!near && !this.hubPanel.isOpen);
    if (this.input.consumeInteract() && near && !this.hubPanel.isOpen) {
      this.hubPanel.open(near);
      sound.play("bookOpen");
      document.exitPointerLock(); // free the mouse to click in the window
    }
  }

  private makeHint(): HTMLElement {
    const el = document.createElement("div");
    el.id = "station-hint";
    document.getElementById("hud")!.appendChild(el);
    return el;
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
    this.chase?.dispose();
    this.dq?.dispose();
    this.trial?.dispose();
    this.bossView?.dispose();
    this.ctfView?.dispose();
    this.npcs?.dispose();
    this.story?.dispose();
    this.postfx?.dispose();
    this.particleSystem.dispose();
    particles.set(null);
    this.hubPanel?.close();
    this.remotes.clear();
    if (this.selfAvatar) disposeAvatar(this.selfAvatar);
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
    document.getElementById("pause-help")!.textContent = "";
    this.crosshairEl.classList.remove("target", "hit");
    document.getElementById("levelup")!.classList.remove("show");
    document.getElementById("bot-controls")!.hidden = true;
    document.body.classList.remove("role-it", "role-cursed");
    // Wait for the server to drop us from this room before anyone joins the
    // next one (otherwise it looks like a second tab and kicks this one).
    await closed;
  }

  // A grapple's chain, for a moment (tag and infection; the arena's are Royale's).
  private drawChain(from: Vec3, to: Vec3, ms: number, mine: boolean): void {
    const a = new THREE.Vector3(from[0], from[1] + 0.3, from[2]);
    const b = new THREE.Vector3(to[0], to[1] + 0.3, to[2]);
    const link = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, a.distanceTo(b), 5), new THREE.MeshLambertMaterial({ color: "#8a8a96" }));
    link.position.copy(a).add(b).multiplyScalar(0.5);
    link.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    this.scene.add(link);
    sound.play("chop", { at: mine ? null : to });
    if (mine) this.addFeed("Grappled!");
    window.setTimeout(() => {
      this.scene.remove(link);
      link.geometry.dispose();
    }, Math.max(250, ms));
  }

  // ---- The way home ----

  // Finished a trial (or beat the Tyrant): a portal back to the Academy
  // appears in the middle of the finish (or on the Tyrant's dais), facing
  // the way you came. You're standing in it, so it works once you've stepped
  // out and back in (Portals only arms after you've been outside).
  private showExitPortal(): void {
    if (this.portals) return;
    const course = this.level.course;
    let pos: Vec3;
    let from: Vec3;
    if (course) {
      const f = course.finish;
      pos = [(f.min[0] + f.max[0]) / 2, f.min[1], (f.min[2] + f.max[2]) / 2];
      from = course.checkpoints.at(-1)?.respawn ?? this.level.spawn;
    } else if (this.level.bossFight) {
      const home = this.level.bossFight.home;
      pos = [home[0], home[1] - 3, home[2] + 0.5];
      from = this.level.spawn;
    } else return;
    const dx = from[0] - pos[0];
    const dz = from[2] - pos[2];
    const len = Math.hypot(dx, dz) || 1;
    // A portal's front is (-sin yaw, -cos yaw): point it back toward `from`.
    const yaw = Math.atan2(-dx / len, -dz / len);
    this.portals = new Portals(this.scene, [{ room: HUB_ROOM, pos, yaw, color: "#ffd25a" }], this.profile.bestTimes);
    this.addFeed("A portal home has opened. Walk through it to return to the Academy.");
  }

  // ---- Third person ----

  private setThirdPerson(on: boolean): void {
    this.thirdPerson = on;
    if (on && !this.selfAvatar) {
      this.selfAvatar = createAvatar(this.myId, this.name, lookOf(this.profile.loadout), this.profile.isAdmin, { nameTag: false });
      if (this.rockOn) disguiseAvatar(this.selfAvatar, rockModel());
      this.scene.add(this.selfAvatar);
    }
    if (this.selfAvatar) this.selfAvatar.visible = on;
    this.royale?.setThirdPerson(on);
    this.addFeed(on ? "Third person (V to switch back)" : "First person");
  }

  // Your body follows you; the camera pulls back behind your shoulder,
  // stopping short of any wall in the way.
  private updateSelf(pos: THREE.Vector3, dt: number): void {
    if (!this.thirdPerson || !this.selfAvatar) return;
    const a = this.selfAvatar;
    a.position.copy(pos);
    a.rotation.y = this.input.yaw;
    const moved = Math.hypot(pos.x - this.selfLast.x, pos.z - this.selfLast.z);
    this.selfLast.copy(pos);
    const speed = dt > 0 && moved / dt < 30 ? moved / dt : 0;
    this.selfSpeed += (speed - this.selfSpeed) * Math.min(1, dt * 10);
    setAvatarBroom(a, this.player.broom);
    animateAvatar(a, performance.now(), this.player.broom ? 0 : this.selfSpeed, this.player.crouched ? 1 : 0);
    const scale = performance.now() < this.giantUntil ? GIANT.scale : 1;
    a.scale.setScalar(a.scale.x + (scale - a.scale.x) * 0.15);
    a.position.y += (a.scale.x - 1) * 0.9;
    setAvatarWeapon(a, this.royale ? this.royale.currentWeapon : null);

    const eye = this.camera.position.clone();
    const back = new THREE.Vector3(0, 0, 1).applyEuler(this.camera.rotation); // behind the view
    const right = new THREE.Vector3(1, 0, 0).applyEuler(this.camera.rotation);
    const want = back.multiplyScalar(this.camDistance).add(right.multiplyScalar(0.55)).add(new THREE.Vector3(0, 0.25, 0));
    const len = want.length();
    const dir = want.clone().divideScalar(len);
    const handle = this.player.colliderHandle;
    const hit = this.world.castRay(new RAPIER.Ray(eye, dir), len, true, undefined, undefined, undefined, undefined, (c) => c.handle !== handle);
    const dist = hit ? Math.max(0.3, hit.timeOfImpact - 0.25) : len;
    this.camera.position.addScaledVector(dir, dist);
  }

  // Your eyes above your position (lower while crouching, eased).
  private eyeHeight(): number {
    return EYE_HEIGHT - this.player.crouchBlend * CROUCH_DROP;
  }

  // Where spells and attacks come from (your eyes) and go (where the
  // crosshair points: in third person, toward what the camera's ray hits).
  // Where you're aiming from (your eyes), which way, and the point your
  // crosshair is on: the first wall, floor or person along the camera's line
  // (ground-aimed abilities land under it). In third person the camera is
  // behind your shoulder, so the direction is from your eyes to that point.
  private aim(): { origin: THREE.Vector3; dir: THREE.Vector3; at: THREE.Vector3 } {
    const camDir = this.camera.getWorldDirection(new THREE.Vector3());
    const p = this.player.interpolate(this.accumulator / FIXED_DT);
    const origin = new THREE.Vector3(p.x, p.y + this.eyeHeight(), p.z);
    const handle = this.player.colliderHandle;
    const hit = this.world.castRay(new RAPIER.Ray(this.camera.position, camDir), 120, true, undefined, undefined, undefined, undefined, (c) => c.handle !== handle);
    // Up to the first wall, or the first person in the way if that's nearer.
    const wall = hit ? hit.timeOfImpact : 120;
    const at = this.camera.position.clone().addScaledVector(camDir, Math.min(wall, this.remotes.firstAlong(this.camera.position, camDir, wall) ?? wall));
    if (!this.thirdPerson) return { origin, dir: camDir, at };
    const dir = at.clone().sub(origin);
    // Something between you and the camera: aim straight ahead instead.
    if (dir.dot(camDir) <= 0.1) return { origin, dir: camDir, at };
    return { origin, dir: dir.normalize(), at };
  }

  // Footsteps, jumps and landings: only your own (others' would be noise).
  private stepDistance = 0;
  private movementSounds(dt: number): void {
    const e = this.player.events;
    const dir = this.camera.getWorldDirection(this.tmpDir);
    const p = this.camera.position;
    sound.listen(p.x, p.y, p.z, dir.x, dir.y, dir.z);
    if (e.jumped) sound.fx("jump", { volume: 0.6 });
    if (e.dashed) sound.fx("blink", { volume: 0.6 });
    if (e.landed > 6) sound.play("softHeavy", { volume: Math.min(1, e.landed / 18) });
    else if (e.landed > 3) sound.play([...STEPS], { volume: 0.5 });
    this.stepDistance += e.walked;
    if (this.stepDistance > STEP_EVERY) {
      this.stepDistance = 0;
      const f = this.player.position;
      const grassy = onGrass(this.level, f.x, f.y - 0.9, f.z);
      sound.play([...(grassy ? GRASS_STEPS : STEPS)], { volume: 0.35 });
    }
    if (e.padded) {
      sound.fx("charge", { volume: 0.6, rate: 1.4 });
      const p = this.player.position;
      particles.emit({ at: [p.x, p.y - 0.8, p.z], count: 30, color: "#7dffb0", color2: "#ffffff", speed: 3, up: 2, life: 0.6, size: 0.18 });
    }
    if (e.climbing && Math.random() < dt * 3) sound.play("wood0", { volume: 0.25, rate: 1.3 });
    this.player.events = { jumped: false, dashed: false, landed: 0, walked: 0, padded: false, climbing: false };
  }
  private tmpDir = new THREE.Vector3();

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

    // R: restart a trial run; in the battle royale, E and R are abilities.
    const r = this.input.consumeRestart();
    if (r && this.parkour) this.net.send({ t: "restart" });
    if (r && this.chase) this.net.send({ t: "unstuck" }); // R: respawn (tag and infection)
    // E: the Knight's grapple, when the room has it on (tag and infection).
    if (this.chase && this.input.consumeInteract() && this.chase.grappleOn) {
      const { dir } = this.aim();
      this.net.send({ t: "grapple", d: [dir.x, dir.y, dir.z] });
    }
    if (this.royale) {
      const e = this.input.consumeInteract();
      if (e || r) {
        const { origin, dir, at } = this.aim();
        this.royale.ability(e ? 0 : 1, origin, dir, at);
      }
    }
    if (this.input.consumeBroom() && this.brooms && !this.player.flying) {
      this.player.setBroom(!this.player.broom);
      sound.fx("blink", { rate: this.player.broom ? 1.3 : 0.8, volume: 0.6 });
      this.addFeed(this.player.broom ? "On your broom: look where you want to go, Space climbs, C dives, Shift for speed. B to get off." : "Off your broom.");
    }
    // F uses the powerup you're carrying. Admins with empty pockets: F
    // toggles flying (Space up, C down, passes through walls).
    const f = this.input.consumeFly();
    if (f && this.royale?.heldPowerup) this.royale.usePowerup();
    else if (f && this.chaseHeld && this.chase?.playing) this.net.send({ t: "usePowerup" });
    else if (f && this.profile.isAdmin) {
      this.player.flying = !this.player.flying;
      this.addFeed(this.player.flying ? "Flying (F to land)" : "Flying off");
    }

    // Tagging: the crosshair turns red when someone is in reach; click to tag.
    const target = this.tagTarget();
    this.crosshairEl.classList.toggle("target", target !== null);
    const clicked = this.input.consumeClick();
    if (clicked && target !== null) this.net.send({ t: "tag", target });
    // Battle royale: click casts a bolt, right-click a fireball, from your eyes
    // along where you're looking.
    const rightClicked = this.input.consumeRightClick();
    if (this.trial && clicked) {
      const { origin, dir } = this.aim();
      this.trial.attack(origin, dir, this.player.position);
    }
    if (this.dq && clicked) {
      const { origin, dir } = this.aim();
      this.dq.click(origin, dir);
    }
    if (this.royale && (clicked || rightClicked)) {
      const { origin, dir } = this.aim();
      this.royale.attack(clicked ? "primary" : "fireball", origin, dir);
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
    this.camera.position.set(pos.x, pos.y + this.eyeHeight(), pos.z);
    if (performance.now() < this.spinUntil) this.input.yaw += 9 * dt;
    this.camera.rotation.set(this.input.pitch, this.input.yaw, performance.now() < this.invertUntil ? Math.PI : 0);
    if (performance.now() < this.giantUntil) this.camera.position.y += 1.1; // see over things
    // Just knocked out: for a moment the view sinks toward the ground and
    // rolls, like falling over; then it's back for spectating.
    const sinceDeath = performance.now() - this.deathAt;
    if (sinceDeath < DEATH_VIEW_MS) {
      const k = sinceDeath / DEATH_VIEW_MS;
      const fall = Math.min(1, k * 3) * (1 - Math.max(0, (k - 0.75) * 4)); // down fast, back up at the end
      this.camera.position.y -= fall * 1.3;
      this.camera.rotation.z += fall * 0.7;
      this.camera.rotation.x += fall * 0.35;
    }
    if (this.input.consumeView()) this.setThirdPerson(!this.thirdPerson);
    this.updateSelf(pos, dt);
    this.sun.target.position.copy(pos);
    this.sun.position.copy(pos).add(this.sunOffset);
    this.sky.update(this.camera, dt);
    this.movementSounds(dt);

    // Send our position ~20 times a second.
    this.sendTimer += dt * 1000;
    if (this.sendTimer >= NET_INTERVAL_MS) {
      this.sendTimer %= NET_INTERVAL_MS;
      const p = this.player.position;
      const position: Vec3 = [round(p.x), round(p.y), round(p.z)];
      const move: MoveMsg = { t: "move", p: position, ry: round(wrapAngle(this.input.yaw)), tp: this.teleportCount };
      if (this.player.crouched) move.c = true;
      if (this.player.broom) move.b = true;
      this.net.send(move);
    }

    this.remotes.update();
    this.markers.update(now / 1000);
    this.portals?.update(now / 1000);
    this.royale?.update(now / 1000, this.player.position, this.clock.now(), this.input.forward !== 0 || this.input.strafe !== 0);
    this.animateConjured();
    // 1 / 2 / mouse wheel: switch hands (battle royale).
    const hand = this.input.consumeHand();
    if (hand && this.royale) this.royale.switchHand(hand);
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

    this.props?.update(now / 1000, dt);
    this.trial?.update(now / 1000);
    this.bossView?.update(now / 1000);
    this.ctfView?.update(now / 1000);
    this.npcs?.update(now / 1000, dt, this.player.position);
    this.chasePickups?.update(now / 1000);
    this.dq?.update(now, this.camera);
    this.features?.update(now / 1000, dt);
    this.particleSystem.update(dt);
    if (this.postfx) this.postfx.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }
}
