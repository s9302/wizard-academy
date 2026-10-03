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

export function createAvatar(id: number, name: string): THREE.Group {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(PLAYER_RADIUS, PLAYER_HALF_HEIGHT * 2, 3, 10),
    flat(playerColor(id)),
  );
  body.castShadow = true;
  group.add(body);

  // Face patch on the -Z side, which is "forward" in three.js.
  const face = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.22, 0.1), flat("#f3dcc4"));
  face.position.set(0, TOP - 0.38, -PLAYER_RADIUS + 0.02);
  group.add(face);

  const hatColor = "#3b2a6b";
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.05, 12), flat(hatColor));
  brim.position.y = TOP - 0.05;
  brim.castShadow = true;
  group.add(brim);

  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.75, 8), flat(hatColor));
  cone.position.y = TOP + 0.33;
  cone.rotation.x = -0.15; // a little floppy tilt
  cone.castShadow = true;
  group.add(cone);

  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.35, 0.08, 8), flat("#e8c547"));
  band.position.y = TOP + 0.02;
  group.add(band);

  group.add(makeNameTag(name));
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
