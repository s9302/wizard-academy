// Draws a level's props: trees, torches, banners, roofs, water, crystals,
// stained glass. Decoration only; anything solid is a box in the level data.
//
// Game-dev notes:
// - Static props (trees, rocks, roofs) are merged into one mesh per
//   material, like the level's blocks, so fifty trees cost two draw calls.
// - Banners and water move in their vertex/fragment shaders, driven by one
//   `time` value, so animating them costs the CPU nothing.
// - Real lights are expensive (every lit pixel pays for every light), so
//   only the Ultra setting gives torches and lamps an actual flickering
//   light, and only a handful of them.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Level, Prop } from "../../../shared/src/levels/types.ts";
import { type OgaAssets, pick, place } from "../graphics/ogaAssets.ts";
import { particles } from "../graphics/Particles.ts";
import { swapLook } from "../graphics/textures.ts";
import { addBoard, resetBoards, tickBoards } from "../hub/hallOfFame.ts";
import { HOUSES } from "../../../shared/src/houses.ts";
import { drawEmblem, paintingTexture } from "./paintings.ts";
import { quality } from "../quality.ts";

const MAX_PROP_LIGHTS = 8; // Ultra only, on top of the level's own lights

let seed = 1;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

type Animated = { update(time: number, dt: number): void };

// Geometry waiting to be merged, by color.
class Batch {
  private parts = new Map<string, THREE.BufferGeometry[]>();
  add(color: string, g: THREE.BufferGeometry, m: THREE.Matrix4): void {
    g.applyMatrix4(m);
    // Merging needs the same attributes everywhere.
    if (g.index) g = g.toNonIndexed();
    g.deleteAttribute("uv");
    const list = this.parts.get(color) ?? [];
    list.push(g);
    this.parts.set(color, list);
  }
  build(parent: THREE.Object3D, standard: boolean): void {
    for (const [color, list] of this.parts) {
      const geometry = mergeGeometries(list);
      const material = standard
        ? new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true })
        : new THREE.MeshLambertMaterial({ color, flatShading: true });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = mesh.receiveShadow = true;
      parent.add(mesh);
      for (const g of list) g.dispose();
    }
  }
}

const at = (x: number, y: number, z: number, yaw = 0, s = 1, sy = s) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(s, sy, s));

function vary(color: string, amount = 0.08): string {
  const c = new THREE.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h + (rand() - 0.5) * amount * 0.3, hsl.s, Math.min(1, Math.max(0, hsl.l + (rand() - 0.5) * amount)));
  return "#" + c.getHexString();
}

// ---- Canvas textures (banners, stained glass) ----

// The academy's own banner device: a wizard's hat under a star.
function hatAndStar(g: CanvasRenderingContext2D): void {
  g.fillStyle = "#e8c547";
  g.beginPath();
  g.moveTo(64, 70);
  g.lineTo(88, 150);
  g.lineTo(40, 150);
  g.closePath();
  g.fill();
  g.fillRect(28, 150, 72, 10);
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 7 : 16;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    g.lineTo(64 + Math.cos(a) * r, 40 + Math.sin(a) * r);
  }
  g.fill();
}

function bannerTexture(color: string, emblem?: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = color;
  g.fillRect(0, 0, 128, 256);
  g.strokeStyle = "#e8c547";
  g.lineWidth = 8;
  g.strokeRect(10, 6, 108, 236);
  if (emblem) {
    // A house banner: its emblem instead of the academy's hat and star.
    const house = Object.values(HOUSES).find((h) => h.emblem === emblem);
    drawEmblem(g, emblem, 64, 96, 96, house?.trim ?? "#e8c547");
  } else hatAndStar(g);
  // A swallowtail cut at the bottom (transparent).
  g.globalCompositeOperation = "destination-out";
  g.beginPath();
  g.moveTo(0, 256);
  g.lineTo(64, 214);
  g.lineTo(128, 256);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function stainedGlassTexture(round: boolean): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const colors = ["#5a3cff", "#ff4a8b", "#ffd25a", "#3cc8ff", "#7dff8a", "#b45aff"];
  g.fillStyle = "#1a1030";
  g.fillRect(0, 0, 256, 256);
  if (round) {
    // A rose window: rings of colored petals.
    for (let ring = 3; ring >= 0; ring--) {
      const n = 6 + ring * 4;
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2;
        const a1 = ((i + 1) / n) * Math.PI * 2;
        g.fillStyle = colors[(i + ring * 2) % colors.length];
        g.beginPath();
        g.moveTo(128, 128);
        g.arc(128, 128, 30 + ring * 30, a0 + 0.04, a1 - 0.04);
        g.closePath();
        g.fill();
      }
    }
    g.fillStyle = "#ffe58a";
    g.beginPath();
    g.arc(128, 128, 22, 0, Math.PI * 2);
    g.fill();
    g.globalCompositeOperation = "destination-in";
    g.beginPath();
    g.arc(128, 128, 126, 0, Math.PI * 2);
    g.fill();
  } else {
    // A tall lancet: a grid of colored panes.
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 4; x++) {
        g.fillStyle = colors[(x * 3 + y * 5) % colors.length];
        g.fillRect(x * 64 + 4, y * 32 + 3, 56, 26);
      }
    }
  }
  // Lead lines.
  g.globalCompositeOperation = "source-atop";
  g.strokeStyle = "#140c24";
  g.lineWidth = 3;
  for (let i = 0; i < 12; i++) {
    g.beginPath();
    g.moveTo(rand() * 256, 0);
    g.lineTo(rand() * 256, 256);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---- The OpenGameArt look (see graphics/ogaAssets.ts) ----

// Stained glass: Shoehorn's gothic lead tracery over glowing jewel-toned
// glass, clipped round for a rose window.
const ogaGlass = new Map<string, THREE.CanvasTexture>();
function ogaWindowTexture(a: OgaAssets, round: boolean, index: number): THREE.CanvasTexture {
  const key = `${round}:${index}`;
  const cached = ogaGlass.get(key);
  if (cached) return cached;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 256, 256);
  const tones = [["#3a2a9a", "#7a4ad8", "#d86aa8"], ["#1f4a9a", "#5a3cff", "#ffb84a"], ["#5a1f7a", "#c84a8a", "#ffd25a"]][index % 3];
  tones.forEach((t, i) => grad.addColorStop(i / (tones.length - 1), t));
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  // Panes of slightly different tints, so the glass isn't one smooth wash.
  let r = 77 + index;
  const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 60; i++) {
    g.fillStyle = `hsla(${200 + rnd() * 140}, 80%, ${45 + rnd() * 25}%, 0.25)`;
    g.fillRect(rnd() * 256, rnd() * 256, 20 + rnd() * 50, 20 + rnd() * 50);
  }
  g.drawImage(a.tracery[index % a.tracery.length].image as CanvasImageSource, 0, 0, 256, 256);
  if (round) {
    g.globalCompositeOperation = "destination-in";
    g.beginPath();
    g.arc(128, 128, 126, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  ogaGlass.set(key, t);
  return t;
}

// The models for this level's trees, pines, bushes, lamps and windows.
function buildOgaProps(
  parent: THREE.Object3D,
  swapped: { trees: number[][]; pines: number[][]; bushes: number[][]; lamps: number[][]; windows: { p: number[]; w: number; h: number; yaw: number }[] },
  a: OgaAssets,
  bright: boolean,
): THREE.Group {
  const group = new THREE.Group();
  parent.add(group);
  const spin = (x: number, z: number) => Math.abs(Math.sin(x * 3.7 + z * 1.3)) * Math.PI * 2;
  const placements: { model: (typeof a.trees)[number]; matrix: THREE.Matrix4 }[] = [];
  for (const [x, y, z, s] of swapped.trees) placements.push({ model: pick(a.trees, x, z), matrix: at(x, y, z, spin(x, z), 5 * s) });
  for (const [x, y, z, s] of swapped.pines) placements.push({ model: pick(a.pines, x, z), matrix: at(x, y, z, spin(x, z), 6 * s) });
  // Bushes: a round tree's crown, its trunk sunk into the ground.
  for (const [x, y, z, s] of swapped.bushes) placements.push({ model: pick(a.bushes, x, z), matrix: at(x, y - 0.8 * s, z, spin(x, z), 2.3 * s) });
  for (const [x, y, z] of swapped.lamps) placements.push({ model: pick(a.lamps, x, z), matrix: at(x, y, z, spin(x, z), 3.6) });
  place(group, placements);
  swapped.windows.forEach((win, i) => {
    const round = Math.abs(win.w - win.h) < 0.01;
    const m = new THREE.MeshBasicMaterial({ map: ogaWindowTexture(a, round, i), transparent: round, toneMapped: false });
    if (bright) m.color.setScalar(1.8);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(win.w, win.h), m);
    mesh.position.set(win.p[0], win.p[1], win.p[2]);
    mesh.rotation.y = win.yaw;
    group.add(mesh);
  });
  return group;
}

// ---- Animated materials ----

const time = { value: 0 };

function bannerMaterial(color: string, emblem?: string): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ map: bannerTexture(color, emblem), side: THREE.DoubleSide, alphaTest: 0.5 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.time = time;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float time;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        // Hangs from the top edge (uv.y = 1): the lower, the more it sways.
        float hang = 1.0 - uv.y;
        transformed.z += sin(time * 2.1 + position.x * 1.7 + hang * 3.0) * 0.12 * hang + sin(time * 3.7 + hang * 6.0) * 0.03 * hang;`,
      );
  };
  m.customProgramCacheKey = () => "banner";
  return m;
}

function waterMaterial(color: string, sunDir: THREE.Vector3, sky: THREE.Color): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { deep: { value: new THREE.Color(color) }, sky: { value: sky.clone() }, sunDir: { value: sunDir.clone() } },
    ]),
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 deep, sky, sunDir;
      uniform float time;
      varying vec3 vWorld;
      #include <fog_pars_fragment>
      void main() {
        vec2 p = vWorld.xz;
        // Ripples: a few sine waves in different directions make the normal.
        float t = time;
        vec2 g = vec2(0.0);
        g += vec2(0.8, 0.6) * cos(dot(p, vec2(0.8, 0.6)) * 3.1 + t * 1.6) * 0.06;
        g += vec2(-0.5, 0.9) * cos(dot(p, vec2(-0.5, 0.9)) * 4.7 - t * 2.1) * 0.04;
        g += vec2(0.95, -0.3) * cos(dot(p, vec2(0.95, -0.3)) * 7.3 + t * 2.9) * 0.025;
        vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
        vec3 v = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
        vec3 col = mix(deep, sky, 0.08 + 0.55 * fres);
        vec3 h = normalize(normalize(sunDir) + v);
        col += vec3(1.0, 0.95, 0.85) * pow(max(dot(n, h), 0.0), 120.0) * 1.6;
        gl_FragColor = vec4(col, 0.82 + 0.15 * fres);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

// ---- Building props ----

export type PropOptions = { sunDir: THREE.Vector3; sky: THREE.Color; lightBudget: number };

export function addProps(parent: THREE.Object3D, level: Level, opts: PropOptions): Animated {
  const props = level.props ?? [];
  seed = 4242;
  const q = quality();
  const standard = q === "ultra";
  const batch = new Batch();
  // Trees, bushes, lamps and stained glass have an OpenGameArt look too: their
  // classic shapes go in their own group, swapped with the models.
  const classic = new THREE.Group();
  parent.add(classic);
  const swapBatch = new Batch();
  const swapped = { trees: [] as number[][], pines: [] as number[][], bushes: [] as number[][], lamps: [] as number[][], windows: [] as { p: number[]; w: number; h: number; yaw: number }[] };
  const animated: Animated[] = [];
  const flames: { pos: THREE.Vector3; light: THREE.PointLight | null; base: number }[] = [];
  const fountains: THREE.Vector3[] = [];
  const crystals: { mesh: THREE.Mesh; y: number; light: THREE.PointLight | null }[] = [];
  const spinners: { obj: THREE.Object3D; speed: number }[] = [];
  const fires: { pos: THREE.Vector3; light: THREE.PointLight | null; flames: THREE.Mesh[]; base: number }[] = [];
  const brews: { pos: THREE.Vector3; color: string }[] = [];
  const birds: { obj: THREE.Object3D; y: number; base: number }[] = [];
  resetBoards();
  let lights = q === "ultra" ? Math.min(MAX_PROP_LIGHTS, opts.lightBudget) : 0;
  const glowMaterials = new Map<string, THREE.MeshBasicMaterial>();
  const glow = (color: string, k: number) => {
    const key = `${color}:${k}`;
    let m = glowMaterials.get(key);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color, toneMapped: false });
      m.color.multiplyScalar(q === "ultra" ? k : 1);
      glowMaterials.set(key, m);
    }
    return m;
  };
  const addLight = (pos: THREE.Vector3, color: string, intensity: number, distance: number): THREE.PointLight | null => {
    if (lights <= 0) return null;
    lights--;
    const l = new THREE.PointLight(color, intensity, distance, 1.6);
    l.position.copy(pos);
    parent.add(l);
    return l;
  };
  // A small still flame (candles, chandeliers): no smoke, no light of its own.
  const candleFlame = (x: number, y: number, z: number, s = 1) => {
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.035 * s, 0.11 * s, 5), glow("#ffc46a", 3));
    m.position.set(x, y + 0.055 * s, z);
    parent.add(m);
  };
  // Where a point at (dx, dy, dz) in a prop's own frame (front = +z) lands.
  const local = (x: number, y: number, z: number, yaw: number, dx: number, dy: number, dz: number) =>
    at(x + dx * Math.cos(yaw) + dz * Math.sin(yaw), y + dy, z - dx * Math.sin(yaw) + dz * Math.cos(yaw), yaw);
  const flame = (pos: THREE.Vector3, light: boolean) => {
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.34, 6), glow("#ffb14a", 3));
    m.position.copy(pos).add(new THREE.Vector3(0, 0.12, 0));
    parent.add(m);
    flames.push({ pos, light: light ? addLight(pos.clone().add(new THREE.Vector3(0, 0.3, 0)), "#ffae5a", 9, 11) : null, base: rand() * 10 });
  };

  for (const p of props) {
    const [x, y, z] = p.pos;
    const s = p.scale ?? 1;
    const yaw = p.yaw ?? 0;
    switch (p.kind) {
      case "tree": {
        swapped.trees.push([x, y, z, s]);
        swapBatch.add("#6b4a30", new THREE.CylinderGeometry(0.18, 0.3, 2.6, 7), at(x, y + 1.3 * s, z, 0, s));
        const leaves = p.color ?? "#3f8a4a";
        for (let i = 0; i < 4; i++) {
          const r = (1.3 + rand() * 0.6) * s;
          const g = new THREE.IcosahedronGeometry(r, 0);
          const a = rand() * Math.PI * 2;
          const off = i === 0 ? 0 : 0.9 * s;
          swapBatch.add(vary(leaves), g, at(x + Math.cos(a) * off, y + (3 + rand() * 1.2) * s, z + Math.sin(a) * off, rand() * 3, 1, 0.85));
        }
        break;
      }
      case "pine": {
        swapped.pines.push([x, y, z, s]);
        swapBatch.add("#5a3e28", new THREE.CylinderGeometry(0.15, 0.22, 1.6, 6), at(x, y + 0.8 * s, z, 0, s));
        const c = p.color ?? "#2f6a46";
        for (let i = 0; i < 3; i++) {
          swapBatch.add(vary(c, 0.05), new THREE.ConeGeometry((1.7 - i * 0.45) * s, (2.0 - i * 0.3) * s, 7), at(x, y + (1.9 + i * 1.15) * s, z, rand() * 3));
        }
        break;
      }
      case "bush":
        swapped.bushes.push([x, y, z, s]);
        for (let i = 0; i < 3; i++) {
          swapBatch.add(vary(p.color ?? "#4f8a45"), new THREE.IcosahedronGeometry((0.55 + rand() * 0.3) * s, 0), at(x + (rand() - 0.5) * s, y + 0.45 * s, z + (rand() - 0.5) * s, rand() * 3, 1, 0.8));
        }
        break;
      case "rock":
        batch.add(vary(p.color ?? "#8a8698", 0.1), new THREE.DodecahedronGeometry(0.7 * s, 0), at(x, y + 0.25 * s, z, rand() * 3, 1, 0.6));
        break;
      case "flowers": {
        const [w, d] = p.size ?? [2, 1.2];
        const colors = ["#ff8fb8", "#ffd25a", "#8fb8ff", "#ff7a5a", "#ffffff", "#c58fff"];
        const n = Math.round(w * d * 9);
        for (let i = 0; i < n; i++) {
          const fx = x + (rand() - 0.5) * w;
          const fz = z + (rand() - 0.5) * d;
          batch.add("#4f8a45", new THREE.BoxGeometry(0.04, 0.3, 0.04), at(fx, y + 0.15, fz));
          batch.add(colors[Math.floor(rand() * colors.length)], new THREE.OctahedronGeometry(0.09, 0), at(fx, y + 0.32, fz, rand() * 3));
        }
        break;
      }
      case "torch": {
        batch.add("#5a3e28", new THREE.CylinderGeometry(0.06, 0.09, 1.7, 6), at(x, y + 0.85, z));
        batch.add("#3a3346", new THREE.CylinderGeometry(0.2, 0.1, 0.22, 8), at(x, y + 1.75, z));
        flame(new THREE.Vector3(x, y + 1.9, z), p.light ?? true);
        break;
      }
      case "sconce": {
        const back = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(-0.25);
        batch.add("#3a3346", new THREE.BoxGeometry(0.12, 0.12, 0.4), at(x + back.x / 2, y - 0.2, z + back.z / 2, yaw));
        batch.add("#3a3346", new THREE.CylinderGeometry(0.16, 0.08, 0.18, 8), at(x, y - 0.1, z));
        flame(new THREE.Vector3(x, y, z), p.light ?? true);
        break;
      }
      case "lamp": {
        swapped.lamps.push([x, y, z]);
        swapBatch.add("#2c2838", new THREE.CylinderGeometry(0.07, 0.1, 2.8, 6), at(x, y + 1.4, z));
        swapBatch.add("#2c2838", new THREE.BoxGeometry(0.42, 0.06, 0.42), at(x, y + 2.83, z));
        swapBatch.add("#2c2838", new THREE.ConeGeometry(0.32, 0.3, 4), at(x, y + 3.33, z, Math.PI / 4));
        const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.36, 0.3), glow("#ffd98a", 2.5));
        lantern.position.set(x, y + 3.02, z);
        classic.add(lantern);
        if (p.light) addLight(new THREE.Vector3(x, y + 3, z), "#ffd08a", 8, 12);
        break;
      }
      case "banner": {
        const [w, h] = p.size ?? [1.6, 4];
        const g = new THREE.PlaneGeometry(w, h, 6, 14);
        g.translate(0, -h / 2, 0);
        const mesh = new THREE.Mesh(g, bannerMaterial(p.color ?? "#4a2a9e", p.name));
        mesh.position.set(x, y, z);
        mesh.rotation.y = yaw;
        mesh.castShadow = true;
        parent.add(mesh);
        batch.add("#e8c547", new THREE.CylinderGeometry(0.05, 0.05, w + 0.4, 6).rotateZ(Math.PI / 2), at(x, y + 0.04, z, yaw));
        break;
      }
      case "cone": {
        const [r, h] = p.size ?? [4, 6];
        batch.add(p.color ?? "#3b2a6b", new THREE.ConeGeometry(r, h, 8), at(x, y + h / 2, z, Math.PI / 8));
        batch.add("#e8c547", new THREE.SphereGeometry(0.35, 8, 6), at(x, y + h + 0.2, z));
        break;
      }
      case "water": {
        const [w, d] = p.size ?? [4, 4];
        const material = waterMaterial(p.color ?? "#1f5f8f", opts.sunDir, opts.sky);
        material.uniforms.time = time;
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(x, y, z);
        mesh.receiveShadow = false;
        parent.add(mesh);
        break;
      }
      case "fountain":
        fountains.push(new THREE.Vector3(x, y, z));
        break;
      case "crystal": {
        const color = p.color ?? "#e8c547";
        const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.8 * s, 0), glow(color, 2.2));
        mesh.scale.y = 1.5;
        mesh.position.set(x, y, z);
        mesh.castShadow = true;
        parent.add(mesh);
        crystals.push({ mesh, y, light: addLight(new THREE.Vector3(x, y, z), color, 14, 14) });
        break;
      }
      case "window": {
        const [w, h] = p.size ?? [2, 3];
        const round = Math.abs(w - h) < 0.01;
        const m = new THREE.MeshBasicMaterial({ map: stainedGlassTexture(round), transparent: round, toneMapped: false });
        if (q === "ultra") m.color.setScalar(1.8);
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
        mesh.position.set(x, y, z);
        mesh.rotation.y = yaw;
        classic.add(mesh);
        swapped.windows.push({ p: [x, y, z], w, h, yaw });
        break;
      }
      case "painting": {
        const [w, h] = p.size ?? [2, 1.5];
        const [subject, caption = ""] = (p.name ?? "landscape").split("|");
        const fw = 0.12;
        // A gilt frame just behind the canvas.
        for (const [dx, dy, fw2, fh] of [[0, h / 2 + fw / 2, w + fw * 2, fw], [0, -h / 2 - fw / 2, w + fw * 2, fw], [-w / 2 - fw / 2, 0, fw, h], [w / 2 + fw / 2, 0, fw, h]]) {
          batch.add("#b8923a", new THREE.BoxGeometry(fw2, fh, 0.1), local(x, y + dy, z, yaw, dx, 0, -0.02));
        }
        batch.add("#2a1e10", new THREE.BoxGeometry(w, h, 0.04), local(x, y, z, yaw, 0, 0, -0.04));
        const m = new THREE.MeshLambertMaterial({ map: paintingTexture(subject, caption, p.color, w / h) });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
        mesh.position.set(x, y, z);
        mesh.rotation.y = yaw;
        mesh.receiveShadow = true;
        parent.add(mesh);
        break;
      }
      case "armor": {
        const steel = "#b8bccb";
        const dark = "#4a4d5c";
        const L = (dx: number, dy: number, dz: number) => local(x, y, z, yaw, dx, dy, dz);
        for (const sx of [-0.14, 0.14]) {
          batch.add(steel, new THREE.CylinderGeometry(0.08, 0.07, 0.8, 6), L(sx, 0.4, 0));
          batch.add(steel, new THREE.CylinderGeometry(0.09, 0.08, 0.5, 6), L(sx, 1.05, 0));
          batch.add(dark, new THREE.BoxGeometry(0.16, 0.08, 0.28), L(sx, 0.04, 0.05));
        }
        batch.add(dark, new THREE.CylinderGeometry(0.26, 0.24, 0.22, 8), L(0, 1.32, 0));
        batch.add(steel, new THREE.CylinderGeometry(0.28, 0.22, 0.6, 8), L(0, 1.7, 0));
        for (const sx of [-0.36, 0.36]) {
          batch.add(steel, new THREE.SphereGeometry(0.13, 8, 6), L(sx, 1.95, 0));
          batch.add(steel, new THREE.CylinderGeometry(0.065, 0.06, 0.6, 6), L(sx * 1.05, 1.6, 0));
          batch.add(dark, new THREE.BoxGeometry(0.11, 0.12, 0.12), L(sx * 1.05, 1.26, 0));
        }
        batch.add(steel, new THREE.CylinderGeometry(0.15, 0.16, 0.3, 8), L(0, 2.2, 0));
        batch.add(dark, new THREE.BoxGeometry(0.2, 0.03, 0.05), L(0, 2.22, 0.15));
        batch.add(p.color ?? "#c8323c", new THREE.ConeGeometry(0.06, 0.3, 5), L(0, 2.48, -0.03));
        // A halberd in its right hand.
        batch.add("#5a3e28", new THREE.CylinderGeometry(0.025, 0.025, 2.6, 5), L(0.4, 1.3, 0.12));
        batch.add(dark, new THREE.BoxGeometry(0.03, 0.35, 0.25), L(0.4, 2.45, 0.2));
        break;
      }
      case "chandelier": {
        const [r, chain] = p.size ?? [1.8, 1.8];
        const ringY = y - chain;
        batch.add("#2e2b38", new THREE.TorusGeometry(r, 0.06, 6, 24).rotateX(Math.PI / 2), at(x, ringY, z));
        batch.add("#2e2b38", new THREE.TorusGeometry(r * 0.55, 0.05, 6, 18).rotateX(Math.PI / 2), at(x, ringY + 0.3, z));
        batch.add("#2e2b38", new THREE.CylinderGeometry(0.03, 0.03, chain, 4), at(x, y - chain / 2, z));
        const n = Math.round(r * 5);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const cx = x + Math.cos(a) * r;
          const cz = z + Math.sin(a) * r;
          batch.add("#f4efe0", new THREE.CylinderGeometry(0.045, 0.045, 0.22, 5), at(cx, ringY + 0.13, cz));
          candleFlame(cx, ringY + 0.24, cz, 1.4);
          if (i % 2 === 0) batch.add("#2e2b38", new THREE.CylinderGeometry(0.015, 0.015, Math.hypot(r, chain * 0.4), 3), new THREE.Matrix4().lookAt(new THREE.Vector3(cx, ringY, cz), new THREE.Vector3(x, ringY + chain * 0.4, z), new THREE.Vector3(0, 1, 0)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)).setPosition((cx + x) / 2, ringY + chain * 0.2, (cz + z) / 2));
        }
        if (p.light) addLight(new THREE.Vector3(x, ringY - 0.3, z), "#ffd08a", 12, 16);
        break;
      }
      case "candle": {
        batch.add("#2e2b38", new THREE.CylinderGeometry(0.07 * s, 0.09 * s, 0.03, 8), at(x, y + 0.015, z));
        batch.add("#f4efe0", new THREE.CylinderGeometry(0.04 * s, 0.04 * s, 0.2 * s, 6), at(x, y + 0.1 * s, z));
        candleFlame(x, y + 0.2 * s, z, s);
        break;
      }
      case "fire": {
        batch.add("#4a2e1c", new THREE.CylinderGeometry(0.1, 0.1, 1.1, 6).rotateZ(Math.PI / 2), at(x, y + 0.1, z, 0.4));
        batch.add("#4a2e1c", new THREE.CylinderGeometry(0.1, 0.1, 1.1, 6).rotateZ(Math.PI / 2), at(x, y + 0.1, z, -0.4));
        const flames: THREE.Mesh[] = [];
        for (const [dx, dz, h, color] of [[0, 0, 0.9, "#ffb14a"], [-0.25, 0.1, 0.6, "#ff7a2a"], [0.25, -0.1, 0.65, "#ff7a2a"], [0.05, 0.15, 0.45, "#ffe08a"]] as const) {
          const m = new THREE.Mesh(new THREE.ConeGeometry(0.16, h, 6), glow(color, 3));
          m.position.set(x + dx, y + 0.15 + h / 2, z + dz);
          parent.add(m);
          flames.push(m);
        }
        fires.push({ pos: new THREE.Vector3(x, y + 0.5, z), light: p.light ? addLight(new THREE.Vector3(x, y + 0.8, z), "#ff9a4a", 10, 9) : null, flames, base: rand() * 10 });
        break;
      }
      case "cauldron": {
        const color = p.color ?? "#7dff5a";
        batch.add("#1d1a22", new THREE.SphereGeometry(0.5 * s, 10, 8, 0, Math.PI * 2, Math.PI * 0.25, Math.PI * 0.75), at(x, y + 0.42 * s, z));
        batch.add("#2e2b38", new THREE.TorusGeometry(0.36 * s, 0.05 * s, 6, 16).rotateX(Math.PI / 2), at(x, y + 0.78 * s, z));
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2;
          batch.add("#1d1a22", new THREE.BoxGeometry(0.07 * s, 0.2 * s, 0.07 * s), at(x + Math.cos(a) * 0.3 * s, y + 0.1 * s, z + Math.sin(a) * 0.3 * s));
        }
        const brew = new THREE.Mesh(new THREE.CircleGeometry(0.33 * s, 16).rotateX(-Math.PI / 2), glow(color, 1.8));
        brew.position.set(x, y + 0.74 * s, z);
        parent.add(brew);
        brews.push({ pos: new THREE.Vector3(x, y + 0.76 * s, z), color });
        break;
      }
      case "globe": {
        batch.add("#4e3322", new THREE.CylinderGeometry(0.35, 0.45, 0.1, 8), at(x, y + 0.05, z));
        batch.add("#4e3322", new THREE.CylinderGeometry(0.05, 0.07, 0.8, 6), at(x, y + 0.5, z));
        batch.add("#b8923a", new THREE.TorusGeometry(0.5, 0.025, 4, 20, Math.PI), at(x, y + 1.3, z, Math.PI / 2));
        const c = document.createElement("canvas");
        c.width = 128;
        c.height = 64;
        const g = c.getContext("2d")!;
        g.fillStyle = "#2f6fa8";
        g.fillRect(0, 0, 128, 64);
        for (let i = 0; i < 12; i++) {
          g.fillStyle = ["#6fae5c", "#c9b27a", "#4f7d45"][i % 3];
          g.beginPath();
          g.ellipse(rand() * 128, 10 + rand() * 44, 6 + rand() * 14, 4 + rand() * 8, rand() * 3, 0, Math.PI * 2);
          g.fill();
        }
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.45, 20, 14), new THREE.MeshLambertMaterial({ map: tex }));
        ball.position.set(x, y + 1.3, z);
        ball.rotation.z = 0.4;
        ball.castShadow = true;
        parent.add(ball);
        spinners.push({ obj: ball, speed: 0.25 });
        break;
      }
      case "orrery": {
        batch.add("#b8923a", new THREE.CylinderGeometry(0.3, 0.35, 0.08, 10), at(x, y + 0.04, z));
        batch.add("#b8923a", new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6), at(x, y + 0.3, z));
        const sun = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), glow("#ffd25a", 2.4));
        sun.position.set(x, y + 0.6, z);
        parent.add(sun);
        const brass = new THREE.MeshLambertMaterial({ color: "#b8923a" });
        [[0.3, "#9ad0ff", 0.06, 1.1], [0.5, "#ff8a5a", 0.08, 0.7], [0.7, "#c58fff", 0.07, 0.45]].forEach(([r, color, size, speed]) => {
          const pivot = new THREE.Group();
          pivot.position.set(x, y + 0.6, z);
          pivot.rotation.y = rand() * 6;
          const arm = new THREE.Mesh(new THREE.BoxGeometry(r as number, 0.015, 0.015), brass);
          arm.position.x = (r as number) / 2;
          const planet = new THREE.Mesh(new THREE.SphereGeometry(size as number, 10, 8), new THREE.MeshLambertMaterial({ color: color as string }));
          planet.position.x = r as number;
          pivot.add(arm, planet);
          parent.add(pivot);
          spinners.push({ obj: pivot, speed: speed as number });
        });
        break;
      }
      case "phoenix": {
        batch.add("#b8923a", new THREE.CylinderGeometry(0.04, 0.05, 1.6, 6), at(x, y + 0.8, z));
        batch.add("#b8923a", new THREE.CylinderGeometry(0.3, 0.35, 0.06, 8), at(x, y + 0.03, z));
        batch.add("#b8923a", new THREE.CylinderGeometry(0.025, 0.025, 0.7, 5).rotateZ(Math.PI / 2), at(x, y + 1.6, z, yaw));
        const bird = new THREE.Group();
        bird.position.set(x, y + 1.85, z);
        bird.rotation.y = yaw;
        const red = glow("#ff5a2a", 1.6);
        const gold = glow("#ffb84a", 1.8);
        const body = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), red);
        body.scale.set(1, 1.2, 1.3);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), red);
        head.position.set(0, 0.22, 0.1);
        const beak = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.1, 4).rotateX(Math.PI / 2), gold);
        beak.position.set(0, 0.2, 0.22);
        const crest = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.14, 4), gold);
        crest.position.set(0, 0.34, 0.06);
        crest.rotation.x = -0.4;
        const tail = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.6, 4), gold);
        tail.position.set(0, -0.25, -0.22);
        tail.rotation.x = -2.4;
        bird.add(body, head, beak, crest, tail);
        for (const sx of [-1, 1]) {
          const wing = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.42, 4), red);
          wing.position.set(sx * 0.17, 0, -0.05);
          wing.rotation.set(-2.2, 0, sx * 0.25);
          bird.add(wing);
        }
        parent.add(bird);
        birds.push({ obj: bird, y: y + 1.85, base: rand() * 10 });
        break;
      }
      case "board": {
        const [w, h] = p.size ?? [6, 4];
        const canvas = document.createElement("canvas");
        canvas.width = 1024;
        canvas.height = Math.round((1024 * h) / w);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: texture }));
        mesh.position.set(x, y, z);
        mesh.rotation.y = yaw;
        parent.add(mesh);
        batch.add("#4e3322", new THREE.BoxGeometry(w + 0.3, h + 0.3, 0.1), local(x, y, z, yaw, 0, 0, -0.06));
        addBoard({ canvas, kind: p.name ?? "xp", texture });
        break;
      }
      default:
        break; // students and NPCs are drawn elsewhere
    }
  }
  batch.build(parent, standard);
  swapBatch.build(classic, standard);
  swapLook(classic, [classic], (a) => [buildOgaProps(parent, swapped, a, q === "ultra")]);

  let emitClock = 0;
  return {
    update(t: number, dt: number) {
      time.value = t;
      emitClock += dt;
      const tick = emitClock > 1 / 30; // particles at 30 Hz is plenty
      if (tick) emitClock = 0;
      for (const f of flames) {
        if (f.light) f.light.intensity = 8 + Math.sin(t * 13 + f.base) * 1.2 + Math.sin(t * 7.3 + f.base * 2) * 1.5;
        if (tick) particles.emit({ at: f.pos, count: 1, color: "#ffb347", color2: "#ff5a1f", up: 1.4, speed: 0.25, spread: 0.12, life: 0.55, size: 0.22, drag: 1 });
      }
      tickBoards(Date.now());
      for (const sp of spinners) sp.obj.rotation.y += sp.speed * dt;
      for (const b of birds) {
        b.obj.position.y = b.y + Math.sin(t * 1.3 + b.base) * 0.03;
        if (tick && Math.random() < 0.15) particles.emit({ at: b.obj.position, count: 1, color: "#ffb84a", color2: "#ff5a1f", up: 0.4, speed: 0.3, spread: 0.2, life: 0.8, size: 0.08, gravity: -0.2 });
      }
      for (const f of fires) {
        f.flames.forEach((m, i) => (m.scale.y = 0.85 + Math.sin(t * (9 + i * 2.3) + f.base + i) * 0.15));
        if (f.light) f.light.intensity = 9 + Math.sin(t * 11 + f.base) * 1.5 + Math.sin(t * 6.1) * 1.2;
        if (tick) particles.emit({ at: f.pos, count: 1, color: "#ffb347", color2: "#ff5a1f", up: 1.6, speed: 0.3, spread: 0.3, life: 0.7, size: 0.3, drag: 1 });
      }
      if (tick) {
        for (const b of brews) if (Math.random() < 0.12) particles.emit({ at: b.pos, count: 1, color: b.color, speed: 0.15, spread: 0.2, up: 0.6, life: 0.9, size: 0.12, gravity: -0.4 });
      }
      for (const c of crystals) {
        c.mesh.rotation.y = t * 0.7;
        c.mesh.position.y = c.y + Math.sin(t * 1.6) * 0.2;
        if (tick && Math.random() < 0.3) particles.emit({ at: c.mesh.position, count: 1, color: "#fff2b0", speed: 0.8, spread: 1.2, life: 1.2, size: 0.12, gravity: -0.3 });
      }
      if (tick) {
        for (const f of fountains) {
          particles.emit({ at: f, count: 3, color: "#cfefff", color2: "#7fc4ff", up: 4.2, speed: 0.9, spread: 0.2, life: 1.1, size: 0.16, gravity: 7 });
        }
      }
    },
  };
}
