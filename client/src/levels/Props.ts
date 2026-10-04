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
import { particles } from "../graphics/Particles.ts";
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

function bannerTexture(color: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = color;
  g.fillRect(0, 0, 128, 256);
  g.strokeStyle = "#e8c547";
  g.lineWidth = 8;
  g.strokeRect(10, 6, 108, 236);
  // A wizard's hat and a star.
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

// ---- Animated materials ----

const time = { value: 0 };

function bannerMaterial(color: string): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ map: bannerTexture(color), side: THREE.DoubleSide, alphaTest: 0.5 });
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
  const animated: Animated[] = [];
  const flames: { pos: THREE.Vector3; light: THREE.PointLight | null; base: number }[] = [];
  const fountains: THREE.Vector3[] = [];
  const crystals: { mesh: THREE.Mesh; y: number; light: THREE.PointLight | null }[] = [];
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
        batch.add("#6b4a30", new THREE.CylinderGeometry(0.18, 0.3, 2.6, 7), at(x, y + 1.3 * s, z, 0, s));
        const leaves = p.color ?? "#3f8a4a";
        for (let i = 0; i < 4; i++) {
          const r = (1.3 + rand() * 0.6) * s;
          const g = new THREE.IcosahedronGeometry(r, 0);
          const a = rand() * Math.PI * 2;
          const off = i === 0 ? 0 : 0.9 * s;
          batch.add(vary(leaves), g, at(x + Math.cos(a) * off, y + (3 + rand() * 1.2) * s, z + Math.sin(a) * off, rand() * 3, 1, 0.85));
        }
        break;
      }
      case "pine": {
        batch.add("#5a3e28", new THREE.CylinderGeometry(0.15, 0.22, 1.6, 6), at(x, y + 0.8 * s, z, 0, s));
        const c = p.color ?? "#2f6a46";
        for (let i = 0; i < 3; i++) {
          batch.add(vary(c, 0.05), new THREE.ConeGeometry((1.7 - i * 0.45) * s, (2.0 - i * 0.3) * s, 7), at(x, y + (1.9 + i * 1.15) * s, z, rand() * 3));
        }
        break;
      }
      case "bush":
        for (let i = 0; i < 3; i++) {
          batch.add(vary(p.color ?? "#4f8a45"), new THREE.IcosahedronGeometry((0.55 + rand() * 0.3) * s, 0), at(x + (rand() - 0.5) * s, y + 0.45 * s, z + (rand() - 0.5) * s, rand() * 3, 1, 0.8));
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
        batch.add("#2c2838", new THREE.CylinderGeometry(0.07, 0.1, 2.8, 6), at(x, y + 1.4, z));
        batch.add("#2c2838", new THREE.BoxGeometry(0.42, 0.06, 0.42), at(x, y + 2.83, z));
        batch.add("#2c2838", new THREE.ConeGeometry(0.32, 0.3, 4), at(x, y + 3.33, z, Math.PI / 4));
        const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.36, 0.3), glow("#ffd98a", 2.5));
        lantern.position.set(x, y + 3.02, z);
        parent.add(lantern);
        if (p.light) addLight(new THREE.Vector3(x, y + 3, z), "#ffd08a", 8, 12);
        break;
      }
      case "banner": {
        const [w, h] = p.size ?? [1.6, 4];
        const g = new THREE.PlaneGeometry(w, h, 6, 14);
        g.translate(0, -h / 2, 0);
        const mesh = new THREE.Mesh(g, bannerMaterial(p.color ?? "#4a2a9e"));
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
        parent.add(mesh);
        break;
      }
      default:
        break; // students and NPCs are drawn elsewhere
    }
  }
  batch.build(parent, standard);

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
