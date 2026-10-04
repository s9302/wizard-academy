// The hub's portals: a glowing, swirling doorway in each arch, a sign above
// it (room name, who's playing, your best time), and the check for walking
// into one. Decoration only; the arches themselves are level boxes.

import * as THREE from "three";
import { particles } from "../graphics/Particles.ts";
import { PORTAL_HEIGHT, PORTAL_STEP, PORTAL_WIDTH, inPortal, portalPoint, type Portal } from "../../../shared/src/levels/types.ts";
import type { Vec3 } from "../../../shared/src/protocol.ts";
import { findRoom } from "../../../shared/src/rooms.ts";
import { formatTime } from "../ParkourHud.ts";
import { Sign } from "./Sign.ts";

const RING_COUNT = 3;

type PortalView = {
  portal: Portal;
  sheet: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  rings: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>[];
  sign: Sign;
};

export class Portals {
  private views: PortalView[] = [];
  private bestTimes: Record<string, number>;
  private counts: Record<string, number> = {};
  // Walking into a portal only counts after you've been outside all of them,
  // so arriving next to one (or standing in it while the room loads) can't
  // bounce you straight back out.
  private armed = false;

  constructor(scene: THREE.Scene, portals: Portal[], bestTimes: Record<string, number>) {
    this.bestTimes = bestTimes;
    for (const portal of portals) this.views.push(this.build(scene, portal));
  }

  private build(scene: THREE.Scene, portal: Portal): PortalView {
    const color = new THREE.Color(portal.color);
    const center = portalPoint(portal, 0, PORTAL_STEP + PORTAL_HEIGHT / 2, -0.3);

    // The doorway itself: a translucent sheet, with spinning hexagonal rings in front.
    const sheet = new THREE.Mesh(
      new THREE.PlaneGeometry(PORTAL_WIDTH, PORTAL_HEIGHT + 0.4),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
    );
    sheet.position.set(...center);
    sheet.rotation.y = portal.yaw;
    scene.add(sheet);

    const rings: PortalView["rings"] = [];
    for (let i = 0; i < RING_COUNT; i++) {
      const outer = 1.65 - i * 0.45;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(outer - 0.18, outer, 6),
        new THREE.MeshBasicMaterial({
          color: color.clone().lerp(new THREE.Color("#ffffff"), 0.35 + i * 0.2),
          transparent: true,
          opacity: 0.8,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      ring.position.set(...portalPoint(portal, 0, PORTAL_STEP + PORTAL_HEIGHT / 2, -0.2 + i * 0.05));
      ring.rotation.order = "YXZ";
      ring.rotation.y = portal.yaw;
      ring.scale.y = 1.3; // taller than wide, like the opening
      scene.add(ring);
      rings.push(ring);
    }

    const light = new THREE.PointLight(color, 6, 9);
    light.position.set(...portalPoint(portal, 0, PORTAL_STEP + 2, 1.2));
    scene.add(light);

    // The sign, redrawn when the counts change.
    const sign = new Sign({ title: "", color: portal.color });
    sign.sprite.position.set(...portalPoint(portal, 0, PORTAL_STEP + PORTAL_HEIGHT + 3.6, 0.6));
    scene.add(sign.sprite);

    const view: PortalView = { portal, sheet, rings, sign };
    this.drawSign(view);
    return view;
  }

  private drawSign(view: PortalView): void {
    const room = findRoom(view.portal.room);
    // "Trial I: The Floating Steps" -> a title and a subtitle.
    const [title, subtitle] = (room?.name ?? view.portal.room).split(": ");
    const count = this.counts[view.portal.room] ?? 0;
    const lines = [count === 1 ? "1 wizard playing" : `${count} wizards playing`];
    if (room?.mode === "parkour") {
      const best = this.bestTimes[room.id];
      lines.push(best ? `Your best: ${formatTime(best)}` : "Not cleared yet");
    }
    view.sign.draw({ title, subtitle, lines, color: view.portal.color });
  }

  setCounts(counts: Record<string, number>): void {
    this.counts = counts;
    for (const view of this.views) this.drawSign(view);
  }

  // The room whose portal the player just walked into, or null.
  enteredPortal(p: Vec3): string | null {
    const inside = this.views.find((view) => inPortal(p, view.portal));
    if (!inside) {
      this.armed = true;
      return null;
    }
    if (!this.armed) return null;
    this.armed = false;
    return inside.portal.room;
  }

  // Swirl and shimmer, and sparks drifting up out of the opening.
  private lastSpark = 0;
  update(time: number): void {
    const spark = time - this.lastSpark > 1 / 20;
    if (spark) this.lastSpark = time;
    this.views.forEach((view, i) => {
      if (spark) {
        const p = portalPoint(view.portal, (Math.random() - 0.5) * PORTAL_WIDTH * 0.8, PORTAL_STEP + Math.random() * PORTAL_HEIGHT * 0.6, 0.1);
        particles.emit({ at: p, count: 1, color: view.portal.color, color2: "#ffffff", speed: 0.3, up: 0.9, life: 1.4, size: 0.14 });
      }
      view.rings.forEach((ring, j) => {
        ring.rotation.z = time * (j % 2 ? -0.9 : 0.6) + i;
        ring.material.opacity = 0.55 + 0.3 * Math.sin(time * 2.4 + j * 1.3 + i);
      });
      view.sheet.material.opacity = 0.5 + 0.1 * Math.sin(time * 1.7 + i);
    });
  }
}
