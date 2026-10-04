// What other players look like: a capsule body (the robe), a wizard hat, a
// pale face patch so you can tell which way they're facing, and a floating
// name tag. Hat and robe come from the player's Wardrobe choices.
// The group's origin is the capsule center, matching the networked position.

import * as THREE from "three";
import { PLAYER_HALF_HEIGHT, PLAYER_RADIUS } from "../../shared/src/constants.ts";
import type { WeaponId } from "../../shared/src/classes.ts";
import { type Hat, type Look, ROBE_COLORS } from "../../shared/src/unlocks.ts";
import { disposeWeapon, makeWeapon } from "./royale/WeaponModels.ts";

const TOP = PLAYER_HALF_HEIGHT + PLAYER_RADIUS; // top of the capsule

// Spread hues out using the golden angle so neighbouring ids look different.
export function playerColor(id: number): THREE.Color {
  return new THREE.Color().setHSL(((id * 137.508) % 360) / 360, 0.55, 0.55);
}

function flat(color: THREE.ColorRepresentation): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

// Admins get a gold tag with a star, so everyone knows who they are.
function makeNameTag(rawName: string, admin = false): THREE.Sprite {
  const name = admin ? `\u2605 ${rawName}` : rawName;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const font = "bold 40px system-ui, sans-serif";
  ctx.font = font;
  const width = Math.ceil(ctx.measureText(name).width) + 32;
  canvas.width = width;
  canvas.height = 64;
  ctx.font = font; // resizing the canvas resets the context
  ctx.fillStyle = admin ? "rgba(120, 90, 10, 0.85)" : "rgba(0, 0, 0, 0.45)";
  ctx.beginPath();
  ctx.roundRect(0, 0, width, 64, 16);
  ctx.fill();
  ctx.fillStyle = admin ? "#ffe58a" : "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // fillText draws plain text, so a name can never inject HTML.
  ctx.fillText(name, width / 2, 34);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false }));
  sprite.scale.set((width / 64) * 0.35, 0.35, 1);
  sprite.position.y = TOP + 0.95;
  return sprite;
}

// Tag / infection roles change how an avatar looks.
export type AvatarStatus = "runner" | "it" | "cursed";

const STATUS_LOOK = {
  it: { aura: new THREE.Color("#ff4a3d"), hat: new THREE.Color("#d8332a") },
  cursed: { aura: new THREE.Color("#8cff5a"), hat: new THREE.Color("#24361c") },
};
const CURSED_BODY = new THREE.Color("#3c5a2e");

// The parts setAvatarStatus changes, kept on the group's userData.
type AvatarParts = {
  bodyMat: THREE.MeshLambertMaterial;
  hatMats: THREE.MeshLambertMaterial[]; // recolored for "It" and the cursed
  hatColor: THREE.Color; // the hat's own color
  hat: THREE.Group;
  status: AvatarStatus;
  aura: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  baseColor: THREE.Color;
};

export function setAvatarStatus(group: THREE.Group, status: AvatarStatus): void {
  const parts = group.userData.parts as AvatarParts;
  parts.status = status;
  if (status === "runner") {
    parts.aura.visible = false;
    parts.bodyMat.color.copy(parts.baseColor);
    for (const m of parts.hatMats) m.color.copy(parts.hatColor);
    return;
  }
  const look = STATUS_LOOK[status];
  parts.aura.visible = true;
  parts.aura.material.color.copy(look.aura);
  for (const m of parts.hatMats) m.color.copy(look.hat);
  if (status === "cursed") parts.bodyMat.color.copy(parts.baseColor).lerp(CURSED_BODY, 0.65);
  else parts.bodyMat.color.copy(parts.baseColor);
}

const HATS: Record<Hat, { color: string; build: (mat: THREE.MeshLambertMaterial, group: THREE.Group) => THREE.MeshLambertMaterial[] }> = {
  // Brim and a floppy cone.
  classic: { color: "#3b2a6b", build: (mat, g) => cone(mat, g, 0.75) },
  tall: { color: "#3b2a6b", build: (mat, g) => cone(mat, g, 1.15) },
  // Midnight blue with little gold stars.
  starry: {
    color: "#1f2a6b",
    build: (mat, g) => {
      const mats = cone(mat, g, 0.85);
      for (const [y, a] of [
        [0.15, 0.4],
        [0.38, 2.3],
        [0.6, 4.1],
      ]) {
        const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.06), flat("#ffe066"));
        const r = 0.3 - y * 0.32;
        star.position.set(Math.cos(a) * r, TOP + y, Math.sin(a) * r);
        g.add(star);
      }
      return mats;
    },
  },
  // Storm-violet, with a crackling tip.
  storm: {
    color: "#3a2f6b",
    build: (mat, g) => {
      const mats = cone(mat, g, 1.0);
      const tip = new THREE.Mesh(new THREE.OctahedronGeometry(0.09), new THREE.MeshLambertMaterial({ color: "#8fe3ff", emissive: "#8fe3ff", emissiveIntensity: 0.9, flatShading: true }));
      tip.position.set(0, TOP + 0.9, 0.12);
      g.add(tip);
      return mats;
    },
  },
  // A gold crown: a band and five points.
  crown: {
    color: "#e8c547",
    build: (mat, g) => {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.16, 10, 1, true), mat);
      band.material.side = THREE.DoubleSide;
      band.position.y = TOP + 0.05;
      g.add(band);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const point = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 4), mat);
        point.position.set(Math.cos(a) * 0.3, TOP + 0.21, Math.sin(a) * 0.3);
        g.add(point);
      }
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.05), flat("#ff5a8a"));
      gem.position.set(0, TOP + 0.06, -0.31);
      g.add(gem);
      return [mat];
    },
  },
};

function cone(mat: THREE.MeshLambertMaterial, g: THREE.Group, height: number): THREE.MeshLambertMaterial[] {
  const brimMat = mat.clone();
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.05, 12), brimMat);
  brim.position.y = TOP - 0.05;
  brim.castShadow = true;
  g.add(brim);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.32, height, 8), mat);
  tip.position.y = TOP - 0.05 + height / 2;
  tip.rotation.x = -0.15; // a little floppy tilt
  tip.castShadow = true;
  g.add(tip);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.35, 0.08, 8), flat("#e8c547"));
  band.position.y = TOP + 0.02;
  g.add(band);
  return [brimMat, mat];
}

function robeColor(id: number, look: Look): THREE.Color {
  return look.robe === "auto" ? playerColor(id) : new THREE.Color(ROBE_COLORS[look.robe]);
}

export function createAvatar(id: number, name: string, look: Look, admin = false): THREE.Group {
  const group = new THREE.Group();

  const baseColor = robeColor(id, look);
  const bodyMat = flat(baseColor);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(PLAYER_RADIUS, PLAYER_HALF_HEIGHT * 2, 3, 10), bodyMat);
  body.castShadow = true;
  group.add(body);

  // Face patch on the -Z side, which is "forward" in three.js.
  const face = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.22, 0.1), flat("#f3dcc4"));
  face.position.set(0, TOP - 0.38, -PLAYER_RADIUS + 0.02);
  group.add(face);

  // A glowing shell around the body, shown for "It" and the cursed.
  const aura = new THREE.Mesh(
    new THREE.SphereGeometry(0.75, 12, 8),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.28, depthWrite: false }),
  );
  aura.scale.y = 1.55;
  aura.visible = false;
  group.add(aura);

  group.add(makeNameTag(name, admin));
  const hat = new THREE.Group();
  group.add(hat);
  const parts: AvatarParts = { bodyMat, hatMats: [], hatColor: new THREE.Color(), hat, aura, baseColor, status: "runner" };
  group.userData.parts = parts;
  setAvatarLook(group, id, look);
  return group;
}

// Change hat and robe (someone used the Wardrobe), keeping any role colors.
export function setAvatarLook(group: THREE.Group, id: number, look: Look): void {
  const parts = group.userData.parts as AvatarParts;
  disposeTree(parts.hat);
  parts.hat.clear();
  const style = HATS[look.hat] ?? HATS.classic;
  parts.hatColor = new THREE.Color(style.color);
  parts.hatMats = style.build(flat(style.color), parts.hat);
  parts.baseColor = robeColor(id, look);
  setAvatarStatus(group, parts.status);
}

// ---- Battle royale: the weapon in hand ----

const SWING_MS = 260;

export function setAvatarWeapon(group: THREE.Group, weapon: WeaponId | null): void {
  let hand = group.userData.hand as THREE.Group | undefined;
  if (!hand) {
    hand = new THREE.Group();
    hand.position.set(0.42, -0.1, -0.12); // right side, a little forward
    group.add(hand);
    group.userData.hand = hand;
  }
  if (group.userData.weapon === weapon) return;
  group.userData.weapon = weapon;
  for (const child of [...hand.children]) {
    hand.remove(child);
    disposeWeapon(child);
  }
  if (!weapon) return;
  const model = makeWeapon(weapon);
  model.scale.setScalar(0.75);
  if (weapon === "shield") model.position.set(-0.75, 0.05, -0.25); // held in front, on the left
  model.rotation.x = weapon === "shield" ? 0 : -0.35;
  hand.add(model);
}

export function swingAvatar(group: THREE.Group): void {
  group.userData.swingAt = performance.now();
}

// Called every frame: play any swing.
export function animateAvatar(group: THREE.Group, now: number): void {
  const hand = group.userData.hand as THREE.Group | undefined;
  if (!hand) return;
  const k = (now - (group.userData.swingAt ?? -Infinity)) / SWING_MS;
  hand.rotation.x = k >= 0 && k < 1 ? -Math.sin(k * Math.PI) * 1.4 : 0;
}

// A colored glow for a while (a Knight fortifying).
export function glowAvatar(group: THREE.Group, color: string, ms: number): void {
  const parts = group.userData.parts as AvatarParts;
  parts.bodyMat.emissive.set(color);
  window.clearTimeout(group.userData.glowTimer);
  group.userData.glowTimer = window.setTimeout(() => parts.bodyMat.emissive.set("#000000"), ms);
}

// Frosted (hit by Frost Shard): a pale blue tint for a moment.
export function chillAvatar(group: THREE.Group, ms: number): void {
  const parts = group.userData.parts as AvatarParts;
  parts.bodyMat.emissive.set("#3a8fb0");
  window.clearTimeout(group.userData.chillTimer);
  group.userData.chillTimer = window.setTimeout(() => parts.bodyMat.emissive.set("#000000"), ms);
}

// ---- Battle royale: a health bar over the head, and a flash when hit ----

const BAR_W = 128;
const BAR_H = 20;

// hp and shield are 0..1 of their maximums. Drawn on a small canvas (it only
// changes when someone is hit, so redrawing is cheap).
export function setAvatarHealth(group: THREE.Group, hp: number, shield: number): void {
  let bar = group.userData.healthBar as THREE.Sprite | undefined;
  if (!bar) {
    const canvas = document.createElement("canvas");
    canvas.width = BAR_W;
    canvas.height = BAR_H;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    bar = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false }));
    bar.scale.set(0.9, (0.9 * BAR_H) / BAR_W, 1);
    bar.position.y = TOP + 1.28;
    group.add(bar);
    group.userData.healthBar = bar;
  }
  const texture = bar.material.map as THREE.CanvasTexture;
  const ctx = (texture.image as HTMLCanvasElement).getContext("2d")!;
  ctx.clearRect(0, 0, BAR_W, BAR_H);
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.fillRect(0, 0, BAR_W, BAR_H);
  ctx.fillStyle = hp > 0.5 ? "#6ee36e" : hp > 0.25 ? "#ffd04a" : "#ff5a4a";
  ctx.fillRect(3, 3, (BAR_W - 6) * hp, BAR_H - 6);
  if (shield > 0) {
    ctx.fillStyle = "#5ac8ff";
    ctx.fillRect(3, BAR_H - 7, (BAR_W - 6) * shield, 4);
  }
  texture.needsUpdate = true;
  bar.visible = true;
}

export function hideAvatarHealth(group: THREE.Group): void {
  const bar = group.userData.healthBar as THREE.Sprite | undefined;
  if (bar) bar.visible = false;
}

// Glow red for a moment (hit by a spell).
export function flashAvatar(group: THREE.Group): void {
  const parts = group.userData.parts as AvatarParts;
  parts.bodyMat.emissive.set("#ff3030");
  window.clearTimeout(group.userData.flashTimer);
  group.userData.flashTimer = window.setTimeout(() => parts.bodyMat.emissive.set("#000000"), 140);
}

export function disposeAvatar(group: THREE.Group): void {
  window.clearTimeout(group.userData.flashTimer);
  window.clearTimeout(group.userData.chillTimer);
  disposeTree(group);
}

function disposeTree(group: THREE.Object3D): void {
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.Sprite) {
      obj.geometry.dispose();
      const material = obj.material as THREE.Material & { map?: THREE.Texture };
      material.map?.dispose();
      material.dispose();
    }
  });
}
