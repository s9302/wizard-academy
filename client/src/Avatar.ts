// What other players look like: a capsule body, a pointy wizard hat, a pale
// face patch so you can tell which way they're facing, and a floating name tag.
// The group's origin is the capsule center, matching the networked position.

import * as THREE from "three";
import { PLAYER_HALF_HEIGHT, PLAYER_RADIUS } from "../../shared/src/constants.ts";

const TOP = PLAYER_HALF_HEIGHT + PLAYER_RADIUS; // top of the capsule

// Spread hues out using the golden angle so neighbouring ids look different.
export function playerColor(id: number): THREE.Color {
  return new THREE.Color().setHSL(((id * 137.508) % 360) / 360, 0.55, 0.55);
}

function flat(color: THREE.ColorRepresentation): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

function makeNameTag(name: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const font = "bold 40px system-ui, sans-serif";
  ctx.font = font;
  const width = Math.ceil(ctx.measureText(name).width) + 32;
  canvas.width = width;
  canvas.height = 64;
  ctx.font = font; // resizing the canvas resets the context
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.beginPath();
  ctx.roundRect(0, 0, width, 64, 16);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
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

const HAT_COLOR = new THREE.Color("#3b2a6b");
const STATUS_LOOK = {
  it: { aura: new THREE.Color("#ff4a3d"), hat: new THREE.Color("#d8332a") },
  cursed: { aura: new THREE.Color("#8cff5a"), hat: new THREE.Color("#24361c") },
};
const CURSED_BODY = new THREE.Color("#3c5a2e");

// The parts setAvatarStatus changes, kept on the group's userData.
type AvatarParts = {
  bodyMat: THREE.MeshLambertMaterial;
  hatMats: THREE.MeshLambertMaterial[];
  aura: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  baseColor: THREE.Color;
};

export function setAvatarStatus(group: THREE.Group, status: AvatarStatus): void {
  const parts = group.userData.parts as AvatarParts;
  if (status === "runner") {
    parts.aura.visible = false;
    parts.bodyMat.color.copy(parts.baseColor);
    for (const m of parts.hatMats) m.color.copy(HAT_COLOR);
    return;
  }
  const look = STATUS_LOOK[status];
  parts.aura.visible = true;
  parts.aura.material.color.copy(look.aura);
  for (const m of parts.hatMats) m.color.copy(look.hat);
  if (status === "cursed") parts.bodyMat.color.copy(parts.baseColor).lerp(CURSED_BODY, 0.65);
  else parts.bodyMat.color.copy(parts.baseColor);
}

export function createAvatar(id: number, name: string): THREE.Group {
  const group = new THREE.Group();

  const baseColor = playerColor(id);
  const bodyMat = flat(baseColor);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(PLAYER_RADIUS, PLAYER_HALF_HEIGHT * 2, 3, 10), bodyMat);
  body.castShadow = true;
  group.add(body);

  // Face patch on the -Z side, which is "forward" in three.js.
  const face = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.22, 0.1), flat("#f3dcc4"));
  face.position.set(0, TOP - 0.38, -PLAYER_RADIUS + 0.02);
  group.add(face);

  const brimMat = flat(HAT_COLOR);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.05, 12), brimMat);
  brim.position.y = TOP - 0.05;
  brim.castShadow = true;
  group.add(brim);

  const coneMat = flat(HAT_COLOR);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.75, 8), coneMat);
  cone.position.y = TOP + 0.33;
  cone.rotation.x = -0.15; // a little floppy tilt
  cone.castShadow = true;
  group.add(cone);

  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.35, 0.08, 8), flat("#e8c547"));
  band.position.y = TOP + 0.02;
  group.add(band);

  // A glowing shell around the body, shown for "It" and the cursed.
  const aura = new THREE.Mesh(
    new THREE.SphereGeometry(0.75, 12, 8),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.28, depthWrite: false }),
  );
  aura.scale.y = 1.55;
  aura.visible = false;
  group.add(aura);

  group.add(makeNameTag(name));
  const parts: AvatarParts = { bodyMat, hatMats: [brimMat, coneMat], aura, baseColor };
  group.userData.parts = parts;
  return group;
}

export function disposeAvatar(group: THREE.Group): void {
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.Sprite) {
      obj.geometry.dispose();
      const material = obj.material as THREE.Material & { map?: THREE.Texture };
      material.map?.dispose();
      material.dispose();
    }
  });
}
