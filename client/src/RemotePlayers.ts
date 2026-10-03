// Other players, drawn smoothly from 20-per-second network updates.
//
// Game-dev note: updates arrive every ~50 ms but we draw 60+ frames a second.
// Snapping avatars to each update would look jerky, so we deliberately draw
// everyone INTERP_DELAY_MS in the past. That way we almost always have one
// update just before and one just after the moment we're drawing, and can
// slide smoothly between them ("entity interpolation").

import * as THREE from "three";
import type { PlayerInfo, Vec3 } from "../../shared/src/protocol.ts";
import { createAvatar, disposeAvatar } from "./Avatar.ts";

const INTERP_DELAY_MS = 120;
const BUFFER_KEEP_MS = 1000;

type Snapshot = { time: number; p: Vec3; ry: number };

type Remote = {
  name: string;
  avatar: THREE.Group;
  snapshots: Snapshot[]; // oldest first
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
  // Estimate of (server clock - our clock), so we can compare server timestamps
  // against "now". See noteServerTime().
  private clockOffset: number | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  get count(): number {
    return this.remotes.size;
  }

  // Every server timestamp nudges our clock estimate. A message that arrives
  // quickly gives a higher (better) estimate, so jump up to those right away,
  // and only drift down slowly if the network gets slower.
  noteServerTime(serverTime: number): void {
    const sample = serverTime - performance.now();
    if (this.clockOffset === null || sample > this.clockOffset) {
      this.clockOffset = sample;
    } else {
      this.clockOffset += (sample - this.clockOffset) * 0.02;
    }
  }

  add(info: PlayerInfo, serverTime: number): void {
    this.remove(info.id);
    const avatar = createAvatar(info.id, info.name);
    this.scene.add(avatar);
    const remote: Remote = { name: info.name, avatar, snapshots: [] };
    this.remotes.set(info.id, remote);
    this.push(info.id, info.p, info.ry, serverTime);
  }

  remove(id: number): void {
    const remote = this.remotes.get(id);
    if (!remote) return;
    this.scene.remove(remote.avatar);
    disposeAvatar(remote.avatar);
    this.remotes.delete(id);
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

  update(): void {
    if (this.clockOffset === null) return;
    const renderTime = performance.now() + this.clockOffset - INTERP_DELAY_MS;

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
    }
  }
}
