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
import { type Accessory, type Face, type Feature, HAIR_COLOR_VALUES, type Hair, type Outfit, SKIN_COLORS } from "../../shared/src/appearance.ts";
import { DEFAULT_LOOK, type Hat, type Look, ROBE_COLORS } from "../../shared/src/unlocks.ts";
import { disposeWeapon, makeWeapon, setBowDraw } from "./royale/WeaponModels.ts";

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

function faceTexture(skin: string, face: Face, features: Feature[], acc: Accessory, hair: string): THREE.CanvasTexture {
  const has = (f: Feature) => features.includes(f);
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = skin;
  g.fillRect(0, 0, 256, 128);
  const x = FACE_X;
  const y = FACE_Y;
  // Cheeks.
  g.fillStyle = has("blush") ? "rgba(235, 90, 100, 0.5)" : "rgba(230, 110, 110, 0.22)";
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
    g.ellipse(ex, y, 5.5, wide ? 6.5 : face === "fierce" ? 3.8 : 5, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#3a2a20";
    g.beginPath();
    g.arc(ex, y + 0.5, 3.4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#ffffff";
    g.fillRect(ex + 0.5, y - 2, 1.6, 1.6);
  };
  eye(x - 15, face === "sleepy", face === "surprised");
  eye(x + 15, face === "wink" || face === "sleepy", face === "surprised");
  // Brows (in hair color). Fierce: thick, slanting hard down toward the
  // nose, with heavy lids under them; surprised: raised high.
  g.strokeStyle = hair;
  for (const s of [-1, 1]) {
    const bx = x + s * 15;
    const inner = bx - s * 7; // the end toward the nose
    const outer = bx + s * 7;
    g.lineWidth = face === "fierce" ? 4.5 : 3;
    g.beginPath();
    if (face === "fierce") {
      g.moveTo(outer, y - 13);
      g.lineTo(inner, y - 5);
    } else {
      const by = y - (face === "surprised" ? 14 : face === "sleepy" ? 7 : 9);
      g.moveTo(outer, by + (face === "calm" || face === "sleepy" ? 0 : 1));
      g.quadraticCurveTo(bx, by - (face === "surprised" ? 3 : 1.5), inner, by);
    }
    g.stroke();
    if (face === "fierce") {
      // A lid line along the top of the eye, following the brow's slant.
      g.strokeStyle = "#2a1c18";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(bx + s * 6, y - 3.5);
      g.lineTo(bx - s * 6, y - 1);
      g.stroke();
      g.strokeStyle = hair;
    }
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
    case "fierce": {
      // Gritted teeth, corners pulled down.
      g.beginPath();
      g.moveTo(x - 10, my + 3);
      g.lineTo(x - 7, my - 1);
      g.lineTo(x + 7, my - 1);
      g.lineTo(x + 10, my + 3);
      g.lineTo(x + 7, my + 4);
      g.lineTo(x - 7, my + 4);
      g.closePath();
      g.fill();
      g.fillStyle = "#f4f0e6";
      g.fillRect(x - 6.5, my, 13, 3);
      g.strokeStyle = "#7a2f2a";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x - 6.5, my + 1.5);
      g.lineTo(x + 6.5, my + 1.5);
      for (const tx of [-3, 0, 3]) {
        g.moveTo(x + tx, my);
        g.lineTo(x + tx, my + 3);
      }
      g.stroke();
      break;
    }
    case "smirk":
      g.moveTo(x - 7, my + 1);
      g.quadraticCurveTo(x + 3, my + 3, x + 9, my - 4);
      g.stroke();
      break;
    case "calm":
    case "sleepy":
      g.moveTo(x - 7, my + 1);
      g.lineTo(x + 7, my + 1);
      g.stroke();
      break;
    default:
      g.arc(x, my - 4, 9, Math.PI * 0.2, Math.PI * 0.8);
      g.stroke();
  }
  // ---- Features (any number) ----
  if (has("freckles")) {
    g.fillStyle = "rgba(140, 70, 40, 0.55)";
    for (let i = 0; i < 14; i++) {
      const s = i % 2 ? 1 : -1;
      g.beginPath();
      g.arc(x + s * (16 + ((i * 7) % 11)), y + 9 + ((i * 5) % 9), 1.1, 0, Math.PI * 2);
      g.fill();
    }
  }
  if (has("mole")) {
    g.fillStyle = "#3a2216";
    g.beginPath();
    g.arc(x + 13, my - 4, 1.6, 0, Math.PI * 2);
    g.fill();
  }
  if (has("scar")) {
    // Down through the left eyebrow.
    g.strokeStyle = "rgba(150, 60, 60, 0.75)";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x - 20, y - 16);
    g.lineTo(x - 11, y + 10);
    g.stroke();
    for (let k = 0; k < 3; k++) {
      g.beginPath();
      g.moveTo(x - 19 + k * 3.5, y - 9 + k * 7);
      g.lineTo(x - 13 + k * 3.5, y - 11 + k * 7);
      g.stroke();
    }
  }
  if (has("stubble") && !has("beard")) {
    g.fillStyle = hair;
    g.globalAlpha = 0.45;
    for (let i = 0; i < 70; i++) {
      const a = Math.PI * (0.1 + 0.8 * ((i * 37) % 70) / 70);
      const r = 22 + ((i * 13) % 9);
      g.fillRect(x + Math.cos(a) * r - 0.6, y + 8 + Math.sin(a) * r * 0.9 - 0.6, 1.3, 1.3);
    }
    g.globalAlpha = 1;
  }
  if (has("beard")) {
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
  if (has("mustache")) {
    g.fillStyle = hair;
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(x, my - 6);
      g.quadraticCurveTo(x + s * 8, my - 10, x + s * 15, my - 2);
      g.quadraticCurveTo(x + s * 8, my - 4, x, my - 2);
      g.fill();
    }
  }

  // ---- The accessory (one) ----
  const frames = (color: string, width: number, shape: "rect" | "round", fill?: string) => {
    g.strokeStyle = color;
    g.lineWidth = width;
    for (const s of [-1, 1]) {
      g.beginPath();
      if (shape === "round") g.arc(x + s * 15, y, 9, 0, Math.PI * 2);
      else g.roundRect(x + s * 15 - 10, y - 7, 20, 14, 3);
      if (fill) {
        g.fillStyle = fill;
        g.fill();
      }
      g.stroke();
    }
    g.beginPath();
    g.moveTo(x - 5, y - 1);
    g.lineTo(x + 5, y - 1);
    g.stroke();
    // Arms back to the ears.
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(x + s * 25, y - 1);
      g.lineTo(x + s * 46, y - 3);
      g.stroke();
    }
  };
  switch (acc) {
    case "spectacles":
      frames("#2a2a30", 2, "rect");
      break;
    case "round":
      frames("#c9a227", 2, "round");
      break;
    case "sunglasses":
      frames("#111114", 2.5, "rect", "rgba(15, 15, 22, 0.92)");
      break;
    case "goggles":
      frames("#6b4a30", 4, "round", "rgba(120, 200, 230, 0.45)");
      break;
    case "monocle":
      g.strokeStyle = "#c9a227";
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x + 15, y, 9, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.moveTo(x + 22, y + 6);
      g.quadraticCurveTo(x + 26, y + 30, x + 18, y + 50);
      g.stroke();
      break;
    case "eyepatch":
      g.fillStyle = "#141216";
      g.beginPath();
      g.ellipse(x - 15, y + 1, 9, 8, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "#141216";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x - 60, y - 14);
      g.lineTo(x + 50, y - 20);
      g.stroke();
      break;
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
      // The cape wraps around the back and sides (a half cylinder, wider at
      // the hem), outside the shirt and skirt so nothing pokes through it.
      // In a cylinder, angle 0 is +z (the back); this spans the back half.
      const capeMat = c.main.clone();
      capeMat.side = THREE.DoubleSide;
      const cape = mesh(new THREE.CylinderGeometry(0.235, 0.33, 1.14, 14, 1, true, -Math.PI / 2, Math.PI), capeMat, 0, -0.08, 0.01, true);
      cape.scale.z = 1.05;
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
    shoulder.rotation.order = "YXZ"; // raise (x), then sweep sideways (y): a sword's slash
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
  none: { color: "#000000", build: () => [] },
  // The classic: a brim and a straight point.
  classic: { color: "#3b2a6b", build: (mat, g) => cone(mat, g, 0.75) },
  // Towering and crooked: a stack of cones, each leaning further back.
  tall: {
    color: "#1f3a6b",
    build: (mat, g) => {
      const brimMat = mat.clone();
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.38, 0.035, 14), brimMat);
      brim.position.y = TOP - 0.06;
      g.add(brim);
      let y = TOP - 0.06;
      let z = 0;
      let r = 0.19;
      for (let i = 0; i < 4; i++) {
        const h = 0.34 - i * 0.04;
        const seg = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.7, r, h, 9), mat);
        const lean = 0.25 + i * 0.3;
        seg.position.set(0, y + (h / 2) * Math.cos(lean), z + (h / 2) * Math.sin(lean));
        seg.rotation.x = lean;
        seg.castShadow = true;
        g.add(seg);
        y += h * Math.cos(lean);
        z += h * Math.sin(lean);
        r *= 0.7;
      }
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.21, 0.06, 9), flat("#c0c8d8"));
      band.position.y = TOP - 0.02;
      g.add(band);
      return [brimMat, mat];
    },
  },
  // A witch's hat: a huge floppy brim, a short point, little gold stars.
  starry: {
    color: "#1f2a6b",
    build: (mat, g) => {
      const brimMat = mat.clone();
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.6, 0.03, 18), brimMat);
      brim.position.y = TOP - 0.07;
      brim.rotation.x = 0.12; // drooping at the back
      brim.castShadow = true;
      g.add(brim);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.21, 0.55, 9), mat);
      tip.position.set(0, TOP + 0.2, 0.03);
      tip.rotation.x = -0.25;
      tip.castShadow = true;
      g.add(tip);
      for (const [y, a] of [
        [0.05, 0.4],
        [0.2, 2.3],
        [0.32, 4.1],
        [0.0, 5.3],
      ]) {
        const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.045), flat("#ffe066"));
        const rr = 0.19 - y * 0.4;
        star.position.set(Math.cos(a) * rr, TOP + y, Math.sin(a) * rr);
        g.add(star);
      }
      return [brimMat, mat];
    },
  },
  // Storm-violet with a lightning bolt badge and a crackling, bent tip.
  storm: {
    color: "#3a2f6b",
    build: (mat, g) => {
      const mats = cone(mat, g, 0.6);
      const bend = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.32, 8), mat);
      bend.position.set(0, TOP + 0.6, 0.12);
      bend.rotation.x = 1.3;
      g.add(bend);
      const glow = new THREE.MeshBasicMaterial({ color: "#8fe3ff", toneMapped: false });
      const tip = new THREE.Mesh(new THREE.OctahedronGeometry(0.06), glow);
      tip.position.set(0, TOP + 0.62, 0.3);
      g.add(tip);
      // A zigzag bolt on the front.
      const bolt = new THREE.Shape();
      bolt.moveTo(0.02, 0.12);
      bolt.lineTo(-0.04, 0.0);
      bolt.lineTo(0.005, 0.0);
      bolt.lineTo(-0.025, -0.12);
      bolt.lineTo(0.05, 0.03);
      bolt.lineTo(0.0, 0.03);
      bolt.closePath();
      const badge = new THREE.Mesh(new THREE.ShapeGeometry(bolt), glow);
      badge.position.set(0, TOP + 0.12, -0.165);
      badge.rotation.set(-0.27, Math.PI, 0);
      g.add(badge);
      return mats;
    },
  },
  // A tall black top hat with a purple band.
  tophat: {
    color: "#1c1820",
    build: (mat, g) => {
      const brimMat = mat.clone();
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.03, 16), brimMat);
      brim.position.y = TOP - 0.05;
      g.add(brim);
      const crownPart = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.15, 0.34, 14), mat);
      crownPart.position.y = TOP + 0.12;
      crownPart.castShadow = true;
      g.add(crownPart);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.152, 0.152, 0.06, 14), flat("#7a4fd0"));
      band.position.y = TOP - 0.0;
      g.add(band);
      return [brimMat, mat];
    },
  },
  // A soft beret, pulled to one side.
  beret: {
    color: "#8c2a3c",
    build: (mat, g) => {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 8), mat);
      b.scale.set(1, 0.35, 1);
      b.position.set(0.03, TOP - 0.02, 0.01);
      b.rotation.z = -0.25;
      b.castShadow = true;
      g.add(b);
      const nub = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.04, 5), mat);
      nub.position.set(0.02, TOP + 0.05, 0.01);
      g.add(nub);
      return [mat];
    },
  },
  // A hood up over the head, open at the face, with a point at the back.
  hood: {
    color: "#5a4636",
    build: (mat, g) => {
      const hoodMat = mat.clone();
      hoodMat.side = THREE.DoubleSide;
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 10, Math.PI * 1.82, Math.PI * 1.36, 0, Math.PI * 0.66), hoodMat);
      h.position.y = HEAD_Y + 0.01;
      h.scale.set(1, 1.1, 1.05);
      h.castShadow = true;
      g.add(h);
      const point = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 6), hoodMat);
      point.position.set(0, HEAD_Y + 0.14, 0.17);
      point.rotation.x = 1.1;
      g.add(point);
      return [hoodMat];
    },
  },
  // A cavalier's cap: a wide brim turned up on one side, and a long feather.
  feathered: {
    color: "#2f6b4a",
    build: (mat, g) => {
      const brimMat = mat.clone();
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.33, 0.025, 16), brimMat);
      brim.position.y = TOP - 0.05;
      brim.rotation.z = 0.28; // turned up on the left
      g.add(brim);
      const crownPart = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat);
      crownPart.position.y = TOP - 0.05;
      crownPart.scale.y = 0.9;
      crownPart.castShadow = true;
      g.add(crownPart);
      const feather = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.55, 5), flat("#f2e6c8"));
      feather.position.set(-0.17, TOP + 0.14, 0.12);
      feather.rotation.set(0.6, 0, 0.55);
      g.add(feather);
      return [brimMat, mat];
    },
  },
  // A steel helm with two curved horns.
  horned: {
    color: "#9aa0ae",
    build: (mat, g) => {
      const helm = new THREE.Mesh(new THREE.SphereGeometry(0.18, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), mat);
      helm.position.y = HEAD_Y + 0.0;
      helm.castShadow = true;
      g.add(helm);
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.185, 0.185, 0.04, 14), flat("#6e6a5a"));
      rim.position.y = HEAD_Y + 0.03;
      g.add(rim);
      const horn = flat("#efe6d2");
      for (const s of [-1, 1]) {
        const base = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.16, 7), horn);
        base.position.set(s * 0.2, HEAD_Y + 0.12, 0);
        base.rotation.z = -s * 1.0;
        g.add(base);
        const tipPart = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.14, 6), horn);
        tipPart.position.set(s * 0.26, HEAD_Y + 0.23, 0);
        tipPart.rotation.z = -s * 0.25;
        g.add(tipPart);
      }
      return [mat];
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
  const head = mesh(new THREE.SphereGeometry(HEAD_R, 18, 12), new THREE.MeshLambertMaterial({ map: faceTexture(skinColor, look.face, look.features ?? [], look.acc ?? "none", hairColor) }), 0, 0, 0, true);
  head.scale.set(1, 1.08, 1);
  rig.head.add(head);
  for (const s of [-1, 1]) rig.head.add(mesh(new THREE.SphereGeometry(0.03, 6, 4), clothes.skin, s * HEAD_R, -0.01, 0)); // ears
  rig.body.add(mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 6), clothes.skin, 0, 0.53, 0));
  if (look.features?.includes("beard")) {
    const beard = mesh(new THREE.ConeGeometry(0.09, 0.16, 6), flat(hairColor), 0, -0.13, -0.08, true);
    beard.rotation.x = Math.PI - 0.3;
    rig.head.add(beard);
  }
  if (look.acc === "earrings") {
    for (const s of [-1, 1]) rig.head.add(mesh(new THREE.SphereGeometry(0.018, 6, 4), new THREE.MeshBasicMaterial({ color: "#ffd25a" }), s * (HEAD_R + 0.01), -0.05, 0));
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

const SWING_MS: Partial<Record<WeaponId, number>> = { sword: 340, mace: 420, staff: 300, daggers: 200, shield: 300, bow: 900 };
const ease = (t: number) => t * t * (3 - 2 * t);
const span = (k: number, a: number, b: number) => ease(Math.max(0, Math.min(1, (k - a) / (b - a))));

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
    // Held out at arm's length (see animateAvatar): upright, arrow ahead.
    model.rotation.set(Math.PI, 0, 0);
  } else if (weapon === "staff") {
    model.position.set(0, -0.35, 0);
  }
  hand.add(model);
}

// ---- Dying ----

const DIE_MS = 700; // falling over
const SINK_START_MS = 1500; // then lying there, then sinking away
const SINK_MS = 900;

// Eliminated: crumple and fall backward, lie there a moment, then sink into
// the ground (Royale hides them after DEATH_SHOW_MS).
export function dieAvatar(group: THREE.Group): void {
  group.userData.diedAt = performance.now();
}

export function reviveAvatar(group: THREE.Group): void {
  if (group.userData.diedAt === undefined) return;
  group.userData.diedAt = undefined;
  const parts = group.userData.parts as AvatarParts | undefined;
  if (parts) {
    parts.rig.body.rotation.set(0, 0, 0);
    parts.rig.body.position.set(0, 0, 0);
  }
}

export const DEATH_SHOW_MS = SINK_START_MS + SINK_MS;

// The fall: knees buckle, then the body tips back to lie on the ground.
function animateDeath(rig: Rig, ms: number): void {
  const k = Math.min(1, ms / DIE_MS);
  const fall = k * k; // speeds up as it goes
  const sink = Math.max(0, Math.min(1, (ms - SINK_START_MS) / SINK_MS));
  // Pivot about the feet: tip backward (+x rotation leans back for a body
  // facing -z), dropping to lie flat at about the ground.
  rig.body.rotation.x = fall * (Math.PI / 2) * 0.96;
  rig.body.position.set(0, -fall * 0.7 - sink * 0.6, fall * 0.75);
  rig.legL.hip.rotation.x = -0.4 * k;
  rig.legR.hip.rotation.x = -0.25 * k;
  rig.legL.knee.rotation.x = -0.9 * Math.sin(k * Math.PI);
  rig.legR.knee.rotation.x = -0.6 * Math.sin(k * Math.PI);
  // Arms flung out, then limp.
  rig.armL.shoulder.rotation.set(-0.6 * k, 0, -1.1 * k);
  rig.armR.shoulder.rotation.set(-0.5 * k, 0, 1.2 * k);
  rig.armL.elbow.rotation.x = -0.3 * k;
  rig.armR.elbow.rotation.x = -0.3 * k;
  rig.head.rotation.x = 0.3 * k;
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
  if (group.userData.diedAt !== undefined) return animateDeath(rig, now - group.userData.diedAt);
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
  const weapon = group.userData.weapon as WeaponId | null | undefined;
  const armed = !!weapon;
  rig.armL.shoulder.rotation.x = -s * amp * 0.8 + (weapon === "shield" ? -0.9 : 0);
  rig.armL.elbow.rotation.x = weapon === "shield" ? -0.8 : -0.15 - breathe;
  rig.armR.shoulder.rotation.y = 0;
  rig.armL.shoulder.rotation.y = 0;
  if (weapon === "bow") {
    // Bow arm straight out; the other hand back at the string.
    rig.armR.shoulder.rotation.x = -1.45;
    rig.armR.elbow.rotation.x = -0.1;
    rig.armL.shoulder.rotation.x = -1.35;
    rig.armL.shoulder.rotation.y = -0.5;
    rig.armL.elbow.rotation.x = -1.7;
  } else if (armed) {
    // Weapon ready: forearm forward, the weapon pointing ahead.
    rig.armR.shoulder.rotation.x = -0.35 + s * amp * 0.2;
    rig.armR.elbow.rotation.x = -1.0;
  } else {
    rig.armR.shoulder.rotation.x = s * amp * 0.8;
    rig.armR.elbow.rotation.x = -0.15 - breathe;
  }
  animateAttack(group, rig, weapon ?? null, now - (group.userData.swingAt ?? -Infinity));
}

// The attack itself, per weapon (and the bow's string, drawn or snapping).
function animateAttack(group: THREE.Group, rig: Rig, weapon: WeaponId | null, ms: number): void {
  const k = ms / (weapon ? (SWING_MS[weapon] ?? 280) : 280);
  const bow = weapon === "bow" ? rig.hand.children[0] : null;
  if (bow) setBowDraw(bow, k >= 0 && k < 1 ? (k < 0.35 ? Math.max(0, 1 - ms / 60) : span(k, 0.35, 0.95)) : 1, !(k >= 0 && k < 0.3));
  if (k < 0 || k >= 1) return;
  const R = rig.armR;
  switch (weapon) {
    case "sword": {
      // Arm up and out to the right, then a flat sweep across the body.
      const up = span(k, 0, 0.25) * (1 - span(k, 0.25, 0.55));
      const sweep = span(k, 0.25, 0.55) * (1 - span(k, 0.65, 1));
      R.shoulder.rotation.x = -0.35 - (up + sweep) * 1.1;
      R.shoulder.rotation.y = up * 0.9 - sweep * 1.0;
      R.elbow.rotation.x = -1.0 + sweep * 0.8;
      break;
    }
    case "mace": {
      // Raised high over the shoulder, then brought straight down.
      const up = span(k, 0, 0.35) * (1 - span(k, 0.35, 0.55));
      const down = span(k, 0.35, 0.55) * (1 - span(k, 0.7, 1));
      R.shoulder.rotation.x = -0.35 - up * 2.4 - down * 0.6;
      R.elbow.rotation.x = -1.0 - up * 0.6 + down * 0.9;
      break;
    }
    case "staff":
    case "daggers": {
      // A thrust: the arm straightens out while the forearm's angle (and so
      // the weapon's) stays the same, pointing ahead.
      const jab = Math.sin(Math.min(1, k) * Math.PI);
      R.shoulder.rotation.x = -0.35 - jab * 0.9;
      R.elbow.rotation.x = -1.0 + jab * 0.9;
      break;
    }
    case "shield": {
      const bash = Math.sin(Math.min(1, k) * Math.PI);
      rig.armL.shoulder.rotation.x = -0.9 - bash * 0.6;
      rig.armL.elbow.rotation.x = -0.8 + bash * 0.6;
      break;
    }
    case "bow":
      // The string hand jerks back on release.
      if (k < 0.2) rig.armL.shoulder.rotation.y = -0.5 - Math.sin((k / 0.2) * Math.PI) * 0.3;
      break;
    default: {
      // Casting: the hand pushed out.
      const push = Math.sin(Math.min(1, k) * Math.PI);
      R.shoulder.rotation.x = -0.35 - push * 1.1;
      R.elbow.rotation.x = -1.0 + push * 0.8;
    }
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
