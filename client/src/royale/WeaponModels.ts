// Low-poly weapon models, built from a few boxes and shapes. Used for your
// own view (Viewmodel.ts) and in other players' hands (Avatar.ts). Each
// model's grip is at its origin, pointing up (+Y) like a held sword. The bow
// is the exception: its limbs run along Y and its arrow points along -Z, and
// setBowDraw() pulls its string back.

import * as THREE from "three";
import type { WeaponId } from "../../../shared/src/classes.ts";

const mat = (color: string, emissive = 0) =>
  new THREE.MeshLambertMaterial({ color, flatShading: true, emissive: emissive ? color : "#000000", emissiveIntensity: emissive });

function part(geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  return m;
}

export function makeWeapon(weapon: WeaponId, spellColor = "#b48cff"): THREE.Group {
  const g = new THREE.Group();
  const steel = mat("#c9cdd6");
  const wood = mat("#7a5236");
  const gold = mat("#e8c547");
  switch (weapon) {
    case "sword":
      g.add(part(new THREE.BoxGeometry(0.06, 0.2, 0.06), wood, 0, 0.0)); // grip
      g.add(part(new THREE.BoxGeometry(0.28, 0.05, 0.08), gold, 0, 0.12)); // guard
      g.add(part(new THREE.BoxGeometry(0.07, 0.8, 0.02), steel, 0, 0.55)); // blade
      g.add(part(new THREE.ConeGeometry(0.05, 0.12, 4), steel, 0, 1.0)); // tip
      break;
    case "shield": {
      const face = part(new THREE.BoxGeometry(0.55, 0.7, 0.06), mat("#2f4f9e"), 0, 0.1);
      g.add(face);
      g.add(part(new THREE.BoxGeometry(0.6, 0.06, 0.08), gold, 0, 0.45)); // rim top
      g.add(part(new THREE.BoxGeometry(0.06, 0.62, 0.08), gold, 0, 0.1, 0.0)); // a cross
      g.add(part(new THREE.BoxGeometry(0.42, 0.06, 0.08), gold, 0, 0.18));
      break;
    }
    case "bow":
      buildBow(g, wood, gold);
      break;
    case "daggers":
      for (const x of [-0.12, 0.12]) {
        g.add(part(new THREE.BoxGeometry(0.05, 0.12, 0.05), wood, x, 0));
        g.add(part(new THREE.BoxGeometry(0.04, 0.32, 0.015), steel, x, 0.22));
      }
      break;
    case "staff":
      g.add(part(new THREE.CylinderGeometry(0.03, 0.035, 1.3, 6), wood, 0, 0.35));
      g.add(part(new THREE.OctahedronGeometry(0.09), mat("#8fe3ff", 0.6), 0, 1.07));
      break;
    case "mace": {
      // A wooden haft, a flanged steel head, a gold collar.
      g.add(part(new THREE.CylinderGeometry(0.03, 0.035, 0.6, 6), wood, 0, 0.15));
      g.add(part(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 8), gold, 0, 0.43));
      g.add(part(new THREE.DodecahedronGeometry(0.11, 0), steel, 0, 0.55));
      for (let i = 0; i < 4; i++) {
        const flange = part(new THREE.BoxGeometry(0.03, 0.18, 0.07), steel, Math.cos((i * Math.PI) / 2) * 0.1, 0.55, Math.sin((i * Math.PI) / 2) * 0.1);
        flange.rotation.y = (-i * Math.PI) / 2;
        g.add(flange);
      }
      break;
    }
    case "holy": {
      // A holy symbol: a gold sunburst on a short handle, glowing.
      g.add(part(new THREE.CylinderGeometry(0.025, 0.03, 0.22, 6), wood, 0, 0));
      g.add(part(new THREE.TorusGeometry(0.1, 0.022, 6, 16), gold, 0, 0.22));
      g.add(part(new THREE.OctahedronGeometry(0.07), mat("#ffe9a0", 0.9), 0, 0.22));
      break;
    }
    case "thorns": {
      // A gnarled wand of living wood, sprouting leaves and a green bud.
      g.add(part(new THREE.CylinderGeometry(0.022, 0.035, 0.5, 5), mat("#5b3d24"), 0, 0.15));
      for (let i = 0; i < 3; i++) {
        const leaf = part(new THREE.ConeGeometry(0.035, 0.12, 4), mat("#4fae4a"), Math.cos(i * 2.1) * 0.04, 0.2 + i * 0.1, Math.sin(i * 2.1) * 0.04);
        leaf.rotation.z = Math.cos(i * 2.1) * -0.9;
        leaf.rotation.x = Math.sin(i * 2.1) * 0.9;
        g.add(leaf);
      }
      g.add(part(new THREE.DodecahedronGeometry(0.06, 0), mat("#7fd06a", 0.7), 0, 0.44));
      break;
    }
    case "sickle": {
      // A short handle and a curved blade (a half ring of thin boxes).
      g.add(part(new THREE.BoxGeometry(0.05, 0.3, 0.05), wood, 0, 0.05));
      for (let i = 0; i < 7; i++) {
        const a = (i / 6) * Math.PI * 0.9;
        const seg = part(new THREE.BoxGeometry(0.06 - i * 0.005, 0.07, 0.015), steel, 0.13 - Math.cos(a) * 0.13, 0.22 + Math.sin(a) * 0.15);
        seg.rotation.z = a;
        g.add(seg);
      }
      break;
    }
    case "fists": {
      // Two wrapped fists, side by side.
      for (const x of [-0.13, 0.13]) {
        g.add(part(new THREE.BoxGeometry(0.1, 0.09, 0.11), mat("#e2b48c"), x, 0.05));
        g.add(part(new THREE.BoxGeometry(0.105, 0.04, 0.115), mat("#e8e0cc"), x, 0.0)); // the wraps
      }
      break;
    }
    case "spell": {
      // A glowing orb hovering over an open hand.
      g.add(part(new THREE.BoxGeometry(0.14, 0.05, 0.16), mat("#f3dcc4"), 0, 0));
      g.add(part(new THREE.IcosahedronGeometry(0.09, 1), mat(spellColor, 0.9), 0, 0.16));
      break;
    }
  }
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = false;
  });
  return g;
}

// ---- The bow ----

const BOW_TIP = 0.52; // how far each tip is from the grip, along Y
const BOW_REST_Z = 0.07; // the string at rest, behind the limbs' tips
const BOW_DRAW = 0.42; // how far the string comes back at full draw

// A recurve bow: each limb a smooth tube that bends forward (-Z) and flicks
// back at the tip; a leather grip; a string from tip to tip that bends at
// the nocking point; and an arrow, shown while drawn.
function buildBow(g: THREE.Group, wood: THREE.Material, gold: THREE.Material): void {
  const limbMat = mat("#6b4428");
  for (const sign of [1, -1]) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, sign * 0.06, 0),
      new THREE.Vector3(0, sign * 0.22, -0.06),
      new THREE.Vector3(0, sign * 0.4, -0.06),
      new THREE.Vector3(0, sign * BOW_TIP, 0.03),
    ]);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.022, 6), limbMat));
    g.add(part(new THREE.SphereGeometry(0.022, 6, 4), gold, 0, sign * BOW_TIP, 0.03)); // tip caps
  }
  g.add(part(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 8), mat("#3b2a1c"), 0, 0, 0)); // leather grip
  g.add(part(new THREE.BoxGeometry(0.035, 0.03, 0.05), wood, 0, 0.075, -0.01)); // arrow rest
  // The string: two thin pieces meeting at the nock (moved by setBowDraw).
  const stringMat = mat("#f4efe6");
  const top = part(new THREE.CylinderGeometry(0.004, 0.004, 1, 4), stringMat);
  const bottom = part(new THREE.CylinderGeometry(0.004, 0.004, 1, 4), stringMat);
  g.add(top, bottom);
  // The arrow, nocked on the string.
  const arrow = new THREE.Group();
  arrow.add(part(new THREE.CylinderGeometry(0.008, 0.008, 0.72, 5), mat("#c9a36b"), 0, 0, 0).rotateX(Math.PI / 2));
  arrow.add(part(new THREE.ConeGeometry(0.02, 0.07, 4), mat("#c9cdd6"), 0, 0, -0.39).rotateX(-Math.PI / 2));
  for (const a of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) {
    const f = part(new THREE.BoxGeometry(0.002, 0.03, 0.08), mat("#e85a4a"), Math.cos(a) * 0.012, Math.sin(a) * 0.012, 0.31);
    f.rotation.z = a;
    arrow.add(f);
  }
  g.add(arrow);
  g.userData.bow = { top, bottom, arrow };
  setBowDraw(g, 0, false);
}

// Pull the string back: 0 at rest, 1 fully drawn; `nocked` shows the arrow.
export function setBowDraw(g: THREE.Object3D, draw: number, nocked: boolean): void {
  const bow = g.userData.bow as { top: THREE.Mesh; bottom: THREE.Mesh; arrow: THREE.Group } | undefined;
  if (!bow) return;
  const nock = new THREE.Vector3(0, 0.075, BOW_REST_Z + draw * BOW_DRAW);
  const up = new THREE.Vector3(0, 1, 0);
  for (const [piece, tipY] of [
    [bow.top, BOW_TIP],
    [bow.bottom, -BOW_TIP],
  ] as const) {
    const tip = new THREE.Vector3(0, tipY, 0.03);
    piece.position.copy(tip).add(nock).multiplyScalar(0.5);
    piece.scale.y = tip.distanceTo(nock);
    piece.quaternion.setFromUnitVectors(up, tip.clone().sub(nock).normalize());
  }
  bow.arrow.visible = nocked;
  bow.arrow.position.set(0, 0.075, nock.z - 0.3);
}

export function disposeWeapon(g: THREE.Object3D): void {
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
}
