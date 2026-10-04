// What players (and bots, and academy students) look like: a low-poly
// person with jointed arms and legs, a face drawn on a small canvas, a
// hairstyle, an outfit in their robe color, a wizard hat, and a floating
// name tag. All of it comes from their Wardrobe choices (Look).
//
// The group's origin is the capsule center, matching the networked
// position; the feet are 0.9 m below it.
//
// Game-dev note on the skeleton: each limb is a chain of groups ("joints").
// A leg is a hip joint holding the thigh and a knee joint, which holds the
// shin and foot. Rotating the hip swings the whole leg; rotating the knee
// bends only the lower part. Walking is just sine waves on these joints,
// with the phase advanced by how far the avatar actually moved, so feet
// keep pace with the ground at any speed.

import * as THREE from "three";
import { PLAYER_HALF_HEIGHT, PLAYER_RADIUS } from "../../shared/src/constants.ts";
import type { WeaponId } from "../../shared/src/classes.ts";
import { type Face, HAIR_COLOR_VALUES, type Hair, type Outfit, SKIN_COLORS } from "../../shared/src/appearance.ts";
import { DEFAULT_LOOK, type Hat, type Look, ROBE_COLORS } from "../../shared/src/unlocks.ts";
import { disposeWeapon, makeWeapon } from "./royale/WeaponModels.ts";

const TOP = PLAYER_HALF_HEIGHT + PLAYER_RADIUS; // top of the capsule (0.9)
const FEET = -TOP;
const HEAD_Y = 0.71;
const HEAD_R = 0.15;
const HIP_Y = -0.02;
const SHOULDER_Y = 0.46;

// Spread hues out using the golden angle so neighbouring ids look different.
export function playerColor(id: number): THREE.Color {
  return new THREE.Color().setHSL(((id * 137.508) % 360) / 360, 0.55, 0.55);
}

function flat(color: THREE.ColorRepresentation): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0, shadow = false): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  return m;
}

// Admins get a gold tag with a star, so everyone knows who they are.
function makeNameTag(rawName: string, admin = false, color?: string): THREE.Sprite {
  const name = admin ? `★ ${rawName}` : rawName;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const font = "bold 40px system-ui, sans-serif";
  ctx.font = font;
  const width = Math.ceil(ctx.measureText(name).width) + 32;
  canvas.width = width;
  canvas.height = 64;
  ctx.font = font; // resizing the canvas resets the context
  ctx.fillStyle = admin ? "rgba(120, 90, 10, 0.85)" : color ? "rgba(40, 24, 70, 0.8)" : "rgba(0, 0, 0, 0.45)";
  ctx.beginPath();
  ctx.roundRect(0, 0, width, 64, 16);
  ctx.fill();
  ctx.fillStyle = admin ? "#ffe58a" : (color ?? "#ffffff");
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // fillText draws plain text, so a name can never inject HTML.
  ctx.fillText(name, width / 2, 34);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false, toneMapped: false }));
  sprite.scale.set((width / 64) * 0.35, 0.35, 1);
  sprite.position.y = TOP + 0.95;
  return sprite;
}

// ---- The face: drawn on a canvas wrapped around the head ----

// A sphere's texture wraps around it; u = 0.75 is its -Z side, the front.
const FACE_X = 192;
const FACE_Y = 62;

function faceTexture(skin: string, face: Face, hair: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = skin;
  g.fillRect(0, 0, 256, 128);
  const x = FACE_X;
  const y = FACE_Y;
  // Cheeks.
  g.fillStyle = "rgba(230, 110, 110, 0.22)";
  for (const s of [-1, 1]) {
    g.beginPath();
    g.ellipse(x + s * 22, y + 14, 8, 5, 0, 0, Math.PI * 2);
    g.fill();
  }
  // Eyes.
  const eye = (ex: number, closed: boolean, wide: boolean) => {
    if (closed) {
      g.strokeStyle = "#2a1c18";
      g.lineWidth = 2.5;
      g.beginPath();
      g.arc(ex, y + 1, 5, Math.PI * 1.1, Math.PI * 1.9);
      g.stroke();
      return;
    }
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.ellipse(ex, y, 5.5, wide ? 6.5 : 5, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#3a2a20";
    g.beginPath();
    g.arc(ex, y + 0.5, 3.4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#ffffff";
    g.fillRect(ex + 0.5, y - 2, 1.6, 1.6);
  };
  eye(x - 15, false, face === "surprised");
  eye(x + 15, face === "wink", face === "surprised");
  // Brows (in hair color): angled for fierce, raised for surprised.
  g.strokeStyle = hair;
  g.lineWidth = 3;
  for (const s of [-1, 1]) {
    const bx = x + s * 15;
    const by = y - (face === "surprised" ? 13 : 9);
    const tilt = face === "fierce" ? 4 : face === "calm" ? 0 : -1;
    g.beginPath();
    g.moveTo(bx - 6 * s, by - tilt * 0.3);
    g.lineTo(bx + 6 * s, by + (s > 0 ? -tilt : -tilt) * -0.6 + (face === "fierce" ? -3 : 0));
    g.stroke();
  }
  // Nose: a soft shadow.
  g.fillStyle = "rgba(120, 60, 40, 0.25)";
  g.beginPath();
  g.ellipse(x, y + 12, 3, 2, 0, 0, Math.PI * 2);
  g.fill();
  // Mouth.
  g.strokeStyle = "#7a2f2a";
  g.fillStyle = "#7a2f2a";
  g.lineWidth = 2.5;
  const my = y + 24;
  g.beginPath();
  switch (face) {
    case "grin":
      g.moveTo(x - 11, my - 2);
      g.quadraticCurveTo(x, my + 12, x + 11, my - 2);
      g.closePath();
      g.fill();
      g.fillStyle = "#ffffff";
      g.fillRect(x - 8, my - 2, 16, 3);
      break;
    case "surprised":
      g.ellipse(x, my + 2, 4, 5.5, 0, 0, Math.PI * 2);
      g.fill();
      break;
    case "calm":
    case "fierce":
      g.moveTo(x - 7, my + 1);
      g.lineTo(x + 7, my + (face === "fierce" ? 2 : 1));
      g.stroke();
      break;
    default:
      g.arc(x, my - 4, 9, Math.PI * 0.2, Math.PI * 0.8);
      g.stroke();
  }
  if (face === "freckled") {
    g.fillStyle = "rgba(140, 70, 40, 0.55)";
    for (let i = 0; i < 14; i++) {
      const s = i % 2 ? 1 : -1;
      g.beginPath();
      g.arc(x + s * (16 + ((i * 7) % 11)), y + 9 + ((i * 5) % 9), 1.1, 0, Math.PI * 2);
      g.fill();
    }
  }
  if (face === "spectacled") {
    g.strokeStyle = "#c9a227";
    g.lineWidth = 2;
    for (const s of [-1, 1]) {
      g.beginPath();
      g.arc(x + s * 15, y, 9, 0, Math.PI * 2);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(x - 6, y - 1);
    g.lineTo(x + 6, y - 1);
    g.stroke();
  }
  if (face === "bearded") {
    g.fillStyle = hair;
    g.beginPath();
    g.moveTo(x - 30, y + 6);
    g.quadraticCurveTo(x - 26, y + 50, x, y + 54);
    g.quadraticCurveTo(x + 26, y + 50, x + 30, y + 6);
    g.quadraticCurveTo(x + 18, y + 18, x + 10, y + 18);
    g.lineTo(x - 10, y + 18);
    g.quadraticCurveTo(x - 18, y + 18, x - 30, y + 6);
    g.fill();
    // The mouth shows through.
    g.fillStyle = "#7a2f2a";
    g.fillRect(x - 6, my - 1, 12, 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---- Hair ----

function addHair(head: THREE.Group, style: Hair, color: string): void {
  if (style === "bald") return;
  const m = flat(color);
  const cap = (back = 0.25, extent = 0.55) => {
    const g = new THREE.SphereGeometry(HEAD_R + 0.014, 14, 8, 0, Math.PI * 2, 0, Math.PI * extent);
    const capMesh = mesh(g, m, 0, 0.005, 0.01, true);
    capMesh.rotation.x = back; // further down the back than the front
    head.add(capMesh);
  };
  switch (style) {
    case "short":
      cap(0.35, 0.5);
      break;
    case "long": {
      cap(0.35, 0.55);
      const back = mesh(new THREE.BoxGeometry(0.3, 0.42, 0.08), m, 0, -0.16, 0.11, true);
      head.add(back);
      for (const s of [-1, 1]) head.add(mesh(new THREE.BoxGeometry(0.06, 0.3, 0.12), m, s * 0.14, -0.1, 0.02));
      break;
    }
    case "ponytail": {
      cap(0.35, 0.52);
      head.add(mesh(new THREE.SphereGeometry(0.04, 6, 4), m, 0, 0.02, 0.16));
      const tail = mesh(new THREE.CylinderGeometry(0.045, 0.02, 0.32, 6), m, 0, -0.12, 0.2, true);
      tail.rotation.x = 0.35;
      head.add(tail);
      break;
    }
    case "bun":
      cap(0.35, 0.52);
      head.add(mesh(new THREE.SphereGeometry(0.075, 8, 6), m, 0, 0.13, 0.1, true));
      break;
    case "spiky":
      cap(0.3, 0.45);
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const spike = mesh(new THREE.ConeGeometry(0.04, 0.14, 4), m, Math.cos(a) * 0.08, 0.14, Math.sin(a) * 0.08 + 0.02, true);
        spike.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6);
        head.add(spike);
      }
      break;
    case "curly":
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const up = i % 2 ? 0.1 : 0.04;
        const r = i % 2 ? 0.1 : 0.14;
        head.add(mesh(new THREE.IcosahedronGeometry(0.055, 0), m, Math.cos(a) * r, up + 0.03, Math.sin(a) * r + 0.03, true));
      }
      head.add(mesh(new THREE.IcosahedronGeometry(0.08, 0), m, 0, 0.14, 0.02, true));
      break;
    case "braids":
      cap(0.35, 0.52);
      for (const s of [-1, 1]) {
        for (let i = 0; i < 4; i++) head.add(mesh(new THREE.SphereGeometry(0.035, 6, 4), m, s * 0.12, -0.08 - i * 0.07, -0.02 + i * 0.01));
      }
      break;
    case "mohawk":
      for (let i = 0; i < 6; i++) {
        head.add(mesh(new THREE.BoxGeometry(0.04, 0.09 + (i % 2) * 0.02, 0.05), m, 0, 0.14 - Math.abs(i - 2.5) * 0.015, -0.11 + i * 0.045, true));
      }
      break;
  }
}

// ---- Outfits ----

type Clothes = { main: THREE.MeshLambertMaterial; trim: THREE.MeshLambertMaterial; pants: THREE.MeshLambertMaterial; boots: THREE.MeshLambertMaterial; sleeve: THREE.MeshLambertMaterial; skin: THREE.MeshLambertMaterial };

// Long or short skirt from the waist (robe hem).
function skirt(body: THREE.Group, mat: THREE.Material, length: number, flare: number): void {
  const g = new THREE.CylinderGeometry(0.19, 0.19 + flare, length, 10, 1, true);
  const m = mesh(g, mat, 0, HIP_Y + 0.04 - length / 2, 0, true);
  (m.material as THREE.MeshLambertMaterial).side = THREE.DoubleSide;
  m.scale.z = 0.85;
  body.add(m);
}

function addOutfit(body: THREE.Group, rig: Rig, outfit: Outfit, c: Clothes): void {
  const torsoMat = outfit === "scholar" ? flat("#e9e2d2") : outfit === "cloak" ? flat("#6d6577") : c.main;
  const torso = mesh(new THREE.CylinderGeometry(0.21, 0.17, 0.52, 8), torsoMat, 0, 0.22, 0, true);
  torso.scale.z = 0.72;
  body.add(torso);
  // Belt.
  body.add(mesh(new THREE.CylinderGeometry(0.178, 0.178, 0.05, 8).scale(1, 1, 0.75), outfit === "robe" || outfit === "archmage" ? c.trim : flat("#5a3e28"), 0, 0.0, 0));
  switch (outfit) {
    case "robe":
      skirt(body, c.main, 0.8, 0.14);
      break;
    case "archmage": {
      skirt(body, c.main, 0.86, 0.2);
      const collar = mesh(new THREE.CylinderGeometry(0.15, 0.1, 0.16, 8, 1, true), c.trim, 0, 0.56, 0.02);
      (collar.material as THREE.MeshLambertMaterial).side = THREE.DoubleSide;
      body.add(collar);
      const mantle = mesh(new THREE.BoxGeometry(0.56, 1.25, 0.03), c.main, 0, -0.12, 0.17, true);
      mantle.rotation.x = 0.06;
      body.add(mantle);
      body.add(mesh(new THREE.OctahedronGeometry(0.04), new THREE.MeshBasicMaterial({ color: "#8fe3ff", toneMapped: false }), 0, 0.36, -0.16));
      break;
    }
    case "tunic":
      skirt(body, c.main, 0.26, 0.05);
      break;
    case "cloak": {
      skirt(body, torsoMat, 0.24, 0.04);
      const cape = mesh(new THREE.BoxGeometry(0.5, 1.12, 0.03), c.main, 0, -0.08, 0.16, true);
      cape.rotation.x = 0.08;
      body.add(cape);
      // The hood, folded down around the neck and shoulders.
      const hood = mesh(new THREE.CylinderGeometry(0.15, 0.24, 0.14, 12, 1, true), c.main, 0, 0.53, 0.03, true);
      (hood.material as THREE.MeshLambertMaterial).side = THREE.DoubleSide;
      hood.scale.z = 0.85;
      body.add(hood);
      break;
    }
    case "scholar": {
      const vest = mesh(new THREE.CylinderGeometry(0.215, 0.18, 0.44, 8), c.main, 0, 0.2, 0, true);
      vest.scale.z = 0.76;
      body.add(vest);
      const strap = mesh(new THREE.BoxGeometry(0.05, 0.62, 0.02), flat("#6b4a30"), 0, 0.2, -0.17);
      strap.rotation.z = 0.75;
      body.add(strap);
      body.add(mesh(new THREE.BoxGeometry(0.2, 0.18, 0.08), flat("#6b4a30"), -0.2, -0.02, 0.0, true)); // satchel
      break;
    }
    case "battlemage": {
      skirt(body, c.main, 0.34, 0.08);
      const steel = flat("#b9bfcc");
      body.add(mesh(new THREE.BoxGeometry(0.3, 0.3, 0.06), steel, 0, 0.27, -0.13, true)); // breastplate
      for (const s of [-1, 1]) {
        const pad = mesh(new THREE.SphereGeometry(0.1, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), steel, s * 0.26, SHOULDER_Y + 0.02, 0, true);
        pad.scale.set(1.1, 0.8, 1);
        body.add(pad);
      }
      c.boots = steel;
      break;
    }
  }
  // Arms: sleeves in the outfit color (rolled up for a tunic).
  for (const arm of [rig.armL, rig.armR]) {
    arm.shoulder.add(mesh(new THREE.BoxGeometry(0.1, 0.3, 0.1), outfit === "scholar" ? torsoMat : c.sleeve, 0, -0.15, 0, true));
    const forearm = outfit === "tunic" || outfit === "scholar" ? c.skin : c.sleeve;
    arm.elbow.add(mesh(new THREE.BoxGeometry(0.09, 0.27, 0.09), forearm, 0, -0.13, 0, true));
    if (outfit === "robe" || outfit === "archmage") {
      const cuff = mesh(new THREE.CylinderGeometry(0.075, 0.05, 0.12, 6, 1, true), c.trim, 0, -0.24, 0);
      (cuff.material as THREE.MeshLambertMaterial).side = THREE.DoubleSide;
      arm.elbow.add(cuff);
    }
    arm.elbow.add(mesh(new THREE.SphereGeometry(0.055, 8, 6), c.skin, 0, -0.31, 0));
  }
  // Legs: trousers and boots.
  for (const leg of [rig.legL, rig.legR]) {
    leg.hip.add(mesh(new THREE.BoxGeometry(0.13, 0.43, 0.14), c.pants, 0, -0.21, 0, true));
    leg.knee.add(mesh(new THREE.BoxGeometry(0.12, 0.4, 0.13), outfit === "tunic" || outfit === "battlemage" ? c.boots : c.pants, 0, -0.2, 0, true));
    leg.knee.add(mesh(new THREE.BoxGeometry(0.13, 0.08, 0.25), c.boots, 0, -0.43, -0.04, true));
  }
}

// ---- The skeleton ----

type Arm = { shoulder: THREE.Group; elbow: THREE.Group };
type Leg = { hip: THREE.Group; knee: THREE.Group };
type Rig = { body: THREE.Group; head: THREE.Group; armL: Arm; armR: Arm; legL: Leg; legR: Leg; hand: THREE.Group };

function makeRig(): Rig {
  const body = new THREE.Group();
  const head = new THREE.Group();
  head.position.y = HEAD_Y;
  body.add(head);
  const arm = (side: number): Arm => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.27, SHOULDER_Y, 0);
    shoulder.rotation.z = side * 0.08;
    const elbow = new THREE.Group();
    elbow.position.y = -0.3;
    shoulder.add(elbow);
    body.add(shoulder);
    return { shoulder, elbow };
  };
  const leg = (side: number): Leg => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.1, HIP_Y, 0);
    const knee = new THREE.Group();
    knee.position.y = -0.43;
    hip.add(knee);
    body.add(hip);
    return { hip, knee };
  };
  const armR = arm(1);
  // The weapon goes in the right hand, pointing forward.
  const hand = new THREE.Group();
  hand.position.set(0, -0.31, -0.02);
  hand.rotation.x = -Math.PI / 2;
  armR.elbow.add(hand);
  return { body, head, armL: arm(-1), armR, legL: leg(-1), legR: leg(1), hand };
}

// ---- Status (tag / infection) ----

export type AvatarStatus = "runner" | "it" | "cursed";

const STATUS_LOOK = {
  it: { aura: new THREE.Color("#ff4a3d"), hat: new THREE.Color("#d8332a") },
  cursed: { aura: new THREE.Color("#8cff5a"), hat: new THREE.Color("#24361c") },
};
const CURSED_BODY = new THREE.Color("#3c5a2e");

// The parts other functions change, kept on the group's userData.
type AvatarParts = {
  rig: Rig;
  bodyMat: THREE.MeshLambertMaterial; // the outfit's main color
  allMats: THREE.MeshLambertMaterial[]; // flashed red when hit
  hatMats: THREE.MeshLambertMaterial[]; // recolored for "It" and the cursed
  hatColor: THREE.Color; // the hat's own color
  hat: THREE.Group;
  status: AvatarStatus;
  aura: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  baseColor: THREE.Color;
  walk: number; // walk cycle phase, radians
  last: number; // performance.now() of the last animation frame
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

// ---- Hats (positions are relative to the capsule center; see addHat) ----

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
        const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.05), flat("#ffe066"));
        const r = 0.26 - y * 0.28;
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
      const tip = new THREE.Mesh(new THREE.OctahedronGeometry(0.08), new THREE.MeshBasicMaterial({ color: "#8fe3ff", toneMapped: false }));
      tip.position.set(0, TOP + 0.85, 0.12);
      g.add(tip);
      return mats;
    },
  },
  // A gold crown: a band and five points.
  crown: { color: "#e8c547", build: (mat, g) => crown(mat, g, 5, 0.12, "#ff5a8a", false) },
  // The Storm Tyrant's: darker gold, seven tall points, a glowing storm gem.
  tyrant: { color: "#b8862a", build: (mat, g) => crown(mat, g, 7, 0.2, "#8fe3ff", true) },
};

function crown(mat: THREE.MeshLambertMaterial, g: THREE.Group, points: number, height: number, gemColor: string, glow: boolean): THREE.MeshLambertMaterial[] {
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.12, 10, 1, true), mat);
  band.material.side = THREE.DoubleSide;
  band.position.y = TOP - 0.02;
  g.add(band);
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const point = new THREE.Mesh(new THREE.ConeGeometry(0.04, height, 4), mat);
    point.position.set(Math.cos(a) * 0.17, TOP + 0.04 + height / 2, Math.sin(a) * 0.17);
    g.add(point);
  }
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(glow ? 0.05 : 0.035), glow ? new THREE.MeshBasicMaterial({ color: gemColor, toneMapped: false }) : flat(gemColor));
  gem.position.set(0, TOP - 0.02, -0.175);
  g.add(gem);
  return [mat];
}

function cone(mat: THREE.MeshLambertMaterial, g: THREE.Group, height: number): THREE.MeshLambertMaterial[] {
  const brimMat = mat.clone();
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.42, 0.035, 14), brimMat);
  brim.position.y = TOP - 0.06;
  brim.castShadow = true;
  g.add(brim);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.2, height, 9), mat);
  tip.position.y = TOP - 0.06 + height / 2;
  tip.rotation.x = 0.15; // a little floppy tilt, backward
  tip.castShadow = true;
  g.add(tip);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.21, 0.06, 9), flat("#e8c547"));
  band.position.y = TOP - 0.02;
  g.add(band);
  return [brimMat, mat];
}

function robeColor(id: number, look: Look): THREE.Color {
  return look.robe === "auto" ? playerColor(id) : new THREE.Color(ROBE_COLORS[look.robe]);
}

export type AvatarOptions = { nameTag?: boolean; tagColor?: string };

export function createAvatar(id: number, name: string, look: Look, admin = false, opts: AvatarOptions = {}): THREE.Group {
  const group = new THREE.Group();

  // A glowing shell around the body, shown for "It" and the cursed.
  const aura = new THREE.Mesh(
    new THREE.SphereGeometry(0.75, 12, 8),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.28, depthWrite: false }),
  );
  aura.scale.y = 1.55;
  aura.visible = false;
  group.add(aura);

  if (opts.nameTag !== false) group.add(makeNameTag(name, admin, opts.tagColor));
  const parts: AvatarParts = {
    rig: makeRig(),
    bodyMat: flat("#888888"),
    allMats: [],
    hatMats: [],
    hatColor: new THREE.Color(),
    hat: new THREE.Group(),
    aura,
    baseColor: new THREE.Color(),
    status: "runner",
    walk: 0,
    last: performance.now(),
  };
  group.userData.parts = parts;
  setAvatarLook(group, id, look);
  return group;
}

// (Re)build the body for a look: someone used the Wardrobe. Keeps any role
// colors and the weapon in hand.
export function setAvatarLook(group: THREE.Group, id: number, rawLook: Look): void {
  const look = { ...DEFAULT_LOOK, ...rawLook };
  const parts = group.userData.parts as AvatarParts;
  const oldWeapon = group.userData.weapon as WeaponId | null | undefined;
  // Throw away the old body (the hand group goes with it).
  group.remove(parts.rig.body);
  disposeTree(parts.rig.body);
  group.userData.weapon = undefined;
  const rig = makeRig();
  parts.rig = rig;
  group.add(rig.body);

  const skinColor = SKIN_COLORS[look.skin];
  const hairColor = HAIR_COLOR_VALUES[look.hairColor];
  parts.baseColor = robeColor(id, look);
  const main = flat(parts.baseColor);
  const darker = parts.baseColor.clone().multiplyScalar(0.7);
  const clothes: Clothes = {
    main,
    trim: flat("#e8c547"),
    pants: flat(look.outfit === "robe" || look.outfit === "archmage" ? darker : "#4a4252"),
    boots: flat("#4a3226"),
    sleeve: main,
    skin: flat(skinColor),
  };
  parts.bodyMat = main;

  // Head and neck.
  const head = mesh(new THREE.SphereGeometry(HEAD_R, 18, 12), new THREE.MeshLambertMaterial({ map: faceTexture(skinColor, look.face, hairColor) }), 0, 0, 0, true);
  head.scale.set(1, 1.08, 1);
  rig.head.add(head);
  for (const s of [-1, 1]) rig.head.add(mesh(new THREE.SphereGeometry(0.03, 6, 4), clothes.skin, s * HEAD_R, -0.01, 0)); // ears
  rig.body.add(mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 6), clothes.skin, 0, 0.53, 0));
  if (look.face === "bearded") {
    const beard = mesh(new THREE.ConeGeometry(0.09, 0.16, 6), flat(hairColor), 0, -0.13, -0.08, true);
    beard.rotation.x = Math.PI - 0.3;
    rig.head.add(beard);
  }
  addHair(rig.head, look.hair, hairColor);
  addOutfit(rig.body, rig, look.outfit, clothes);

  // The hat sits on the head (its parts are placed relative to the capsule).
  parts.hat = new THREE.Group();
  parts.hat.position.y = -HEAD_Y;
  rig.head.add(parts.hat);
  const style = HATS[look.hat] ?? HATS.classic;
  parts.hatColor = new THREE.Color(style.color);
  parts.hatMats = style.build(flat(style.color), parts.hat);

  parts.allMats = [];
  rig.body.traverse((o) => {
    if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshLambertMaterial && !parts.allMats.includes(o.material)) parts.allMats.push(o.material);
  });
  setAvatarStatus(group, parts.status);
  if (oldWeapon) setAvatarWeapon(group, oldWeapon);
}

// ---- Battle royale: the weapon in hand ----

const SWING_MS = 260;

export function setAvatarWeapon(group: THREE.Group, weapon: WeaponId | null): void {
  const parts = group.userData.parts as AvatarParts;
  const hand = parts.rig.hand;
  if (group.userData.weapon === weapon) return;
  group.userData.weapon = weapon;
  for (const child of [...hand.children]) {
    hand.remove(child);
    disposeWeapon(child);
  }
  if (!weapon) return;
  const model = makeWeapon(weapon);
  model.scale.setScalar(0.8);
  if (weapon === "shield") {
    // Held up in front of the body, on the left arm.
    model.position.set(-0.3, 0.1, -0.12);
    model.rotation.set(Math.PI / 2, 0, 0);
  } else if (weapon === "bow") {
    model.rotation.set(Math.PI / 2, 0, 0);
  } else if (weapon === "staff") {
    model.position.set(0, -0.35, 0);
  }
  hand.add(model);
}

export function swingAvatar(group: THREE.Group): void {
  group.userData.swingAt = performance.now();
}

// Called every frame. speed: how fast it's moving over the ground (m/s).
export function animateAvatar(group: THREE.Group, now: number, speed = 0): void {
  const parts = group.userData.parts as AvatarParts | undefined;
  if (!parts) return;
  const dt = Math.min(0.1, Math.max(0, (now - parts.last) / 1000));
  parts.last = now;
  const rig = parts.rig;
  // Stride: about one full step cycle per 1.6 m walked.
  parts.walk += speed * dt * ((Math.PI * 2) / 1.6);
  const amp = Math.min(1, speed / 4.5) * 0.75;
  const s = Math.sin(parts.walk);
  rig.legL.hip.rotation.x = s * amp;
  rig.legR.hip.rotation.x = -s * amp;
  rig.legL.knee.rotation.x = -Math.max(0, -s) * amp * 1.3;
  rig.legR.knee.rotation.x = -Math.max(0, s) * amp * 1.3;
  rig.body.position.y = Math.abs(Math.cos(parts.walk)) * 0.035 * amp * 2;
  // Idle: a slow breath.
  const breathe = Math.sin(now / 900) * 0.02;
  rig.head.rotation.x = breathe;
  const armed = !!group.userData.weapon;
  rig.armL.shoulder.rotation.x = -s * amp * 0.8 + (group.userData.weapon === "shield" ? -0.9 : 0);
  rig.armL.elbow.rotation.x = group.userData.weapon === "shield" ? -0.8 : -0.15 - breathe;
  if (armed) {
    // Weapon ready: forearm forward, the weapon pointing ahead.
    rig.armR.shoulder.rotation.x = -0.35 + s * amp * 0.2;
    rig.armR.elbow.rotation.x = -1.0;
  } else {
    rig.armR.shoulder.rotation.x = s * amp * 0.8;
    rig.armR.elbow.rotation.x = -0.15 - breathe;
  }
  const k = (now - (group.userData.swingAt ?? -Infinity)) / SWING_MS;
  if (k >= 0 && k < 1) {
    // Raise and strike.
    rig.armR.shoulder.rotation.x = -0.35 - Math.sin(k * Math.PI) * 1.6 + k * 0.8;
    rig.armR.elbow.rotation.x = -1.0 + Math.sin(k * Math.PI) * 0.6;
  }
}

// A colored glow for a while (a Knight fortifying).
export function glowAvatar(group: THREE.Group, color: string, ms: number): void {
  const parts = group.userData.parts as AvatarParts;
  setEmissive(parts, color);
  window.clearTimeout(group.userData.glowTimer);
  group.userData.glowTimer = window.setTimeout(() => setEmissive(parts, "#000000"), ms);
}

// Frosted (hit by Frost Shard): a pale blue tint for a moment.
export function chillAvatar(group: THREE.Group, ms: number): void {
  const parts = group.userData.parts as AvatarParts;
  setEmissive(parts, "#3a8fb0");
  window.clearTimeout(group.userData.chillTimer);
  group.userData.chillTimer = window.setTimeout(() => setEmissive(parts, "#000000"), ms);
}

function setEmissive(parts: AvatarParts, color: string): void {
  for (const m of parts.allMats) m.emissive.set(color);
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
    bar = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false, toneMapped: false }));
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
  setEmissive(parts, "#ff3030");
  window.clearTimeout(group.userData.flashTimer);
  group.userData.flashTimer = window.setTimeout(() => setEmissive(parts, "#000000"), 140);
}

export function disposeAvatar(group: THREE.Group): void {
  window.clearTimeout(group.userData.flashTimer);
  window.clearTimeout(group.userData.chillTimer);
  window.clearTimeout(group.userData.glowTimer);
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

// Feet height below the group's origin (for things standing on the ground).
export const AVATAR_FEET = FEET;
