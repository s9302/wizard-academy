// Other players, drawn smoothly from 20-per-second network updates.
//
// Game-dev note: updates arrive every ~50 ms but we draw 60+ frames a second.
// Snapping avatars to each update would look jerky, so we deliberately draw
// everyone INTERP_DELAY_MS in the past. That way we almost always have one
// update just before and one just after the moment we're drawing, and can
// slide smoothly between them ("entity interpolation").

import * as THREE from "three";
import type { PlayerInfo, Vec3 } from "../../shared/src/protocol.ts";
import type { Look } from "../../shared/src/unlocks.ts";
import type { WeaponId } from "../../shared/src/classes.ts";
import {
  animateAvatar,
  type AvatarStatus,
  chillAvatar,
  glowAvatar,
  createAvatar,
  dieAvatar,
  reviveAvatar,
  disposeAvatar,
  flashAvatar,
  setAvatarHealth,
  setAvatarLook,
  setAvatarStatus,
  setAvatarWeapon,
  swingAvatar,
} from "./Avatar.ts";
import type { ServerClock } from "./ServerClock.ts";

const INTERP_DELAY_MS = 120;
const BUFFER_KEEP_MS = 1000;

type Snapshot = { time: number; p: Vec3; ry: number };

type Remote = {
  name: string;
  info: PlayerInfo; // for copies of them (a Rogue's Mirror Images)
  scale: number; // a Knight's Giant Form
  scaleUntil: number;
  avatar: THREE.Group;
  snapshots: Snapshot[]; // oldest first
  speed: number; // smoothed ground speed, m/s (for the walk animation)
  lastX: number;
  lastZ: number;
};

function lerpAngle(a: number, b: number, t: number): number {
  // Turn the short way around (e.g. 350 deg -> 10 deg goes through 0).
  let diff = (b - a) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

export class RemotePlayers {
  private scene: THREE.Scene;
  private remotes = new Map<number, Remote>();
  private clock: ServerClock;
  // Tag / infection roles, kept even for players we haven't seen yet.
  private statuses = new Map<number, AvatarStatus>();

  constructor(scene: THREE.Scene, clock: ServerClock) {
    this.scene = scene;
    this.clock = clock;
  }

  get count(): number {
    return this.remotes.size;
  }

  add(info: PlayerInfo, serverTime: number): void {
    this.remove(info.id);
    const avatar = createAvatar(info.id, info.name, info.look, info.admin);
    this.scene.add(avatar);
    const remote: Remote = { name: info.name, info, scale: 1, scaleUntil: 0, avatar, snapshots: [], speed: 0, lastX: info.p[0], lastZ: info.p[2] };
    this.remotes.set(info.id, remote);
    setAvatarStatus(avatar, this.statuses.get(info.id) ?? "runner");
    this.push(info.id, info.p, info.ry, serverTime);
  }

  remove(id: number): void {
    const remote = this.remotes.get(id);
    if (!remote) return;
    this.scene.remove(remote.avatar);
    disposeAvatar(remote.avatar);
    this.remotes.delete(id);
  }

  // Set everyone's role at once: chasers get `chaserStatus`, others are runners.
  setChasers(ids: number[], chaserStatus: AvatarStatus): void {
    this.statuses.clear();
    for (const id of ids) this.statuses.set(id, chaserStatus);
    for (const [id, remote] of this.remotes) setAvatarStatus(remote.avatar, this.statuses.get(id) ?? "runner");
  }

  // ---- Battle royale ----

  // Eliminated: the fall (see dieAvatar). revive() stands them back up.
  die(id: number): void {
    const remote = this.remotes.get(id);
    if (remote) dieAvatar(remote.avatar);
  }

  revive(id: number): void {
    const remote = this.remotes.get(id);
    if (remote) reviveAvatar(remote.avatar);
  }

  // A copy of someone's avatar (name tag and all), for Mirror Images.
  cloneOf(id: number): THREE.Group | null {
    const remote = this.remotes.get(id);
    return remote ? createAvatar(id, remote.info.name, remote.info.look, remote.info.admin) : null;
  }

  // A team round: a colored ring at their feet (null: none).
  setTeam(id: number, color: string | null): void {
    const remote = this.remotes.get(id);
    if (!remote) return;
    let ring = remote.avatar.getObjectByName("team-ring") as THREE.Mesh | undefined;
    if (!color) {
      if (ring) ring.visible = false;
      return;
    }
    if (!ring) {
      ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.05, 6, 24), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
      ring.name = "team-ring";
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -0.86;
      remote.avatar.add(ring);
    }
    (ring.material as THREE.MeshBasicMaterial).color.set(color);
    ring.visible = true;
  }

  // Giant Form: drawn `scale` times bigger for `ms` (the feet stay on the floor).
  setScale(id: number, scale: number, ms: number): void {
    const remote = this.remotes.get(id);
    if (!remote) return;
    remote.scale = scale;
    remote.scaleUntil = performance.now() + ms;
  }

  // Hide players who are out of the round (they're spectating).
  setVisible(id: number, visible: boolean): void {
    const remote = this.remotes.get(id);
    if (remote) remote.avatar.visible = visible;
  }

  forEachId(fn: (id: number) => void): void {
    for (const id of this.remotes.keys()) fn(id);
  }

  setHealth(id: number, hp: number, shield: number): void {
    const remote = this.remotes.get(id);
    if (remote) setAvatarHealth(remote.avatar, hp, shield);
  }

  setWeapon(id: number, weapon: WeaponId | null): void {
    const remote = this.remotes.get(id);
    if (remote) setAvatarWeapon(remote.avatar, weapon);
  }

  swing(id: number): void {
    const remote = this.remotes.get(id);
    if (remote) swingAvatar(remote.avatar);
  }

  glow(id: number, color: string, ms: number): void {
    const remote = this.remotes.get(id);
    if (remote) glowAvatar(remote.avatar, color, ms);
  }

  chill(id: number, ms: number): void {
    const remote = this.remotes.get(id);
    if (remote) chillAvatar(remote.avatar, ms);
  }

  // Someone changed hat or robe.
  setLook(id: number, look: Look): void {
    const remote = this.remotes.get(id);
    if (remote) {
      setAvatarLook(remote.avatar, id, look);
      remote.info = { ...remote.info, look };
    }
  }

  flash(id: number): void {
    const remote = this.remotes.get(id);
    if (remote) flashAvatar(remote.avatar);
  }

  // Tagging: the nearest player within `range` that you're roughly facing
  // (within 45 degrees), using where you see them (interpolated). Skips
  // players with the given status (you can't tag a fellow chaser).
  findTarget(from: THREE.Vector3, yaw: number, range: number, skip: AvatarStatus): number | null {
    const facingX = -Math.sin(yaw);
    const facingZ = -Math.cos(yaw);
    let best: number | null = null;
    let bestDist = Infinity;
    for (const [id, remote] of this.remotes) {
      if ((this.statuses.get(id) ?? "runner") === skip) continue;
      const p = remote.avatar.position;
      const dist = p.distanceTo(from);
      if (dist > range || dist >= bestDist) continue;
      const dx = p.x - from.x;
      const dz = p.z - from.z;
      const flat = Math.hypot(dx, dz);
      // Very close counts regardless of angle: you're bumping into them.
      if (flat > 0.9 && (dx * facingX + dz * facingZ) / flat < Math.cos(Math.PI / 4)) continue;
      best = id;
      bestDist = dist;
    }
    return best;
  }

  // Where a player is drawn right now (for positional sound), or null.
  positionOf(id: number): Vec3 | null {
    const a = this.remotes.get(id)?.avatar;
    return a ? [a.position.x, a.position.y + 1, a.position.z] : null;
  }

  clear(): void {
    for (const id of [...this.remotes.keys()]) this.remove(id);
  }

  push(id: number, p: Vec3, ry: number, serverTime: number): void {
    const remote = this.remotes.get(id);
    if (!remote) return;
    remote.snapshots.push({ time: serverTime, p, ry });
    const cutoff = serverTime - BUFFER_KEEP_MS;
    while (remote.snapshots.length > 2 && remote.snapshots[0].time < cutoff) {
      remote.snapshots.shift();
    }
  }

  private lastUpdate = performance.now();

  update(): void {
    if (!this.clock.ready) return;
    const frameStart = performance.now();
    const renderTime = this.clock.now() - INTERP_DELAY_MS;

    for (const remote of this.remotes.values()) {
      const snaps = remote.snapshots;
      if (snaps.length === 0) continue;

      // Find the two snapshots either side of renderTime.
      let from = snaps[0];
      let to = snaps[0];
      for (let i = snaps.length - 1; i >= 0; i--) {
        if (snaps[i].time <= renderTime) {
          from = snaps[i];
          to = snaps[i + 1] ?? snaps[i]; // no newer one yet: hold still
          break;
        }
      }

      const span = to.time - from.time;
      const t = span > 0 ? Math.min(1, Math.max(0, (renderTime - from.time) / span)) : 1;
      remote.avatar.position.set(
        from.p[0] + (to.p[0] - from.p[0]) * t,
        from.p[1] + (to.p[1] - from.p[1]) * t,
        from.p[2] + (to.p[2] - from.p[2]) * t,
      );
      remote.avatar.rotation.y = lerpAngle(from.ry, to.ry, t);
      // Giant Form: grow and shrink smoothly; the avatar's origin is its middle, so lift it.
      const want = performance.now() < remote.scaleUntil ? remote.scale : 1;
      const s = remote.avatar.scale.x + (want - remote.avatar.scale.x) * 0.15;
      remote.avatar.scale.setScalar(s);
      remote.avatar.position.y += (s - 1) * 0.9;
      const now = performance.now();
      const dt = Math.max(1e-3, (now - this.lastUpdate) / 1000);
      const moved = Math.hypot(remote.avatar.position.x - remote.lastX, remote.avatar.position.z - remote.lastZ);
      remote.lastX = remote.avatar.position.x;
      remote.lastZ = remote.avatar.position.z;
      // Teleports (respawns) aren't walking.
      const speed = moved / dt < 30 ? moved / dt : 0;
      remote.speed += (speed - remote.speed) * Math.min(1, dt * 10);
      animateAvatar(remote.avatar, now, remote.speed);
    }
    this.lastUpdate = frameStart;
  }
}
