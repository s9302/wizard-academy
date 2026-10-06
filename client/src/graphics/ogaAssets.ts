// The OpenGameArt look's models and images (beside the texture atlas, see
// textures.ts): Kenney's Nature Kit trees and pines (bushes are its round
// trees sunk into the ground), Kenney's Graveyard Kit lamp posts, Kenney's
// sky panoramas, a moon and a sun flare, Shoehorn's gothic window tracery and
// a mullioned window frame. All CC0; credits in public/oga/CREDITS.md.
//
// Loaded once, the first time the OpenGameArt look is chosen. place() draws
// many copies of a model as instanced meshes: one draw call per part of a
// model, however many trees a level has.

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const BASE = "/oga/";
const TREES = ["tree_default", "tree_oak", "tree_detailed", "tree_fat", "tree_tall", "tree_plateau", "tree_simple", "tree_blocks"];
const PINES = ["tree_pineDefaultA", "tree_pineRoundA", "tree_pineRoundC", "tree_pineTallA_detailed", "tree_pineTallB_detailed", "tree_cone"];
const BUSHES = ["tree_fat", "tree_oak", "tree_plateau", "tree_default"]; // crowns only (sunk into the ground)

// A model standing on y = 0, one unit tall (so scale = height in meters).
export type Model = { root: THREE.Object3D; parts: { geometry: THREE.BufferGeometry; material: THREE.Material; matrix: THREE.Matrix4 }[] };
export type SkyKind = "day" | "morning" | "night";

export type OgaAssets = {
  trees: Model[];
  pines: Model[];
  bushes: Model[];
  lamps: Model[];
  sky: Record<SkyKind, THREE.Texture>;
  sun: THREE.Texture;
  moon: THREE.Texture;
  tracery: THREE.Texture[];
  frame: THREE.Texture;
};

let assets: OgaAssets | null = null;
let loading: Promise<OgaAssets> | null = null;
export const ogaAssets = (): OgaAssets | null => assets;

// Bake a loaded scene into a unit-tall model standing on the ground,
// centered on its middle (or on its base: a lamp's post, not its arm).
function toModel(scene: THREE.Object3D, material?: (m: THREE.Mesh) => THREE.Material, onBase = false): Model {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const h = box.max.y - box.min.y || 1;
  const c = box.getCenter(new THREE.Vector3());
  if (onBase) {
    // The middle of everything in the bottom 5%.
    const base = new THREE.Box3();
    const v = new THREE.Vector3();
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const pos = mesh.geometry.getAttribute("position");
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        if (v.y < box.min.y + h * 0.05) base.expandByPoint(v);
      }
    });
    if (!base.isEmpty()) base.getCenter(c);
  }
  const fix = new THREE.Matrix4().makeScale(1 / h, 1 / h, 1 / h).multiply(new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z));
  const parts: Model["parts"] = [];
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const m = material ? material(mesh) : mats[0];
    parts.push({ geometry: mesh.geometry, material: m, matrix: fix.clone().multiply(mesh.matrixWorld) });
  });
  return { root: scene, parts };
}

// Kenney's lamp posts share one palette image: the post is its green stripe
// (x 320-383, y 256-383) and the lantern glass its yellow one (x 384-447).
// Repaint the post as dark iron, and make only the glass glow.
const POST = { x: 320, y: 256, w: 64, h: 128 };
const GLASS = { x: 384, y: 256, w: 64, h: 128 };
function lampMaterial(original: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const image = original.map!.image as CanvasImageSource & { width: number; height: number };
  const paint = (draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture => {
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    draw(canvas.getContext("2d")!);
    const t = new THREE.CanvasTexture(canvas);
    t.flipY = false; // glTF's UVs
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const map = paint((g) => {
    g.drawImage(image, 0, 0);
    const iron = g.createLinearGradient(0, POST.y, 0, POST.y + POST.h);
    iron.addColorStop(0, "#4a4458");
    iron.addColorStop(1, "#1f1c27");
    g.fillStyle = iron;
    g.fillRect(POST.x, POST.y, POST.w, POST.h);
  });
  const emissiveMap = paint((g) => {
    g.fillStyle = "#000";
    g.fillRect(0, 0, image.width, image.height);
    g.fillStyle = "#ffd08a";
    g.fillRect(GLASS.x, GLASS.y, GLASS.w, GLASS.h);
  });
  return new THREE.MeshStandardMaterial({ map, emissiveMap, emissive: "#ffffff", emissiveIntensity: 2.2, roughness: 0.55, metalness: 0 });
}

function loadTexture(url: string, srgb = true): Promise<THREE.Texture> {
  return new THREE.TextureLoader().loadAsync(url).then((t) => {
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

export function loadOgaAssets(): Promise<OgaAssets> {
  return (loading ??= (async () => {
    const gltf = new GLTFLoader();
    // glTF defaults to fully metallic when a file doesn't say, which renders
    // black without reflections to show: these are painted wood and leaves.
    const matte = (m: THREE.Mesh) => {
      const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
      mat.metalness = 0;
      mat.roughness = 0.85;
      return mat;
    };
    const glb = (name: string) => gltf.loadAsync(`${BASE}models/${name}.glb`).then((g) => toModel(g.scene, matte));
    const lamp = (name: string) =>
      gltf.loadAsync(`${BASE}models/${name}.glb`).then((g) => {
        let mat: THREE.MeshStandardMaterial | null = null;
        return toModel(g.scene, (m) => (mat ??= lampMaterial(m.material as THREE.MeshStandardMaterial)), true);
      });
    const [trees, pines, bushes, lamps, day, morning, night, sun, moon, tracery, frame] = await Promise.all([
      Promise.all(TREES.map(glb)),
      Promise.all(PINES.map(glb)),
      Promise.all(BUSHES.map(glb)),
      Promise.all(["lightpost-single", "lightpost-double"].map(lamp)),
      loadTexture(`${BASE}sky/day.jpg`),
      loadTexture(`${BASE}sky/morning.jpg`),
      loadTexture(`${BASE}sky/night.jpg`),
      loadTexture(`${BASE}sky/sun.png`),
      loadTexture(`${BASE}sky/moon.png`),
      Promise.all([1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => loadTexture(`${BASE}windows/gothic${i}.png`))),
      loadTexture(`${BASE}windows/frame.png`),
    ]);
    for (const t of [day, morning, night]) t.mapping = THREE.EquirectangularReflectionMapping;
    for (const t of tracery) {
      t.magFilter = THREE.NearestFilter; // crisp pixel-art lead lines
      t.anisotropy = 4;
    }
    assets = { trees, pines, bushes, lamps, sky: { day, morning, night }, sun, moon, tracery, frame };
    return assets;
  })().catch((e) => {
    loading = null;
    throw e;
  }));
}

// Many copies of models: one InstancedMesh per model part. Each placement is
// a model and where it stands (its matrix scales the unit-tall model).
export function place(parent: THREE.Object3D, placements: { model: Model; matrix: THREE.Matrix4 }[]): THREE.Group {
  const group = new THREE.Group();
  const byModel = new Map<Model, THREE.Matrix4[]>();
  for (const p of placements) {
    const list = byModel.get(p.model) ?? [];
    list.push(p.matrix);
    byModel.set(p.model, list);
  }
  const m = new THREE.Matrix4();
  for (const [model, matrices] of byModel) {
    for (const part of model.parts) {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, matrices.length);
      matrices.forEach((mat, i) => mesh.setMatrixAt(i, m.multiplyMatrices(mat, part.matrix)));
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  }
  parent.add(group);
  return group;
}

// Pick one of a list by a position (the same tree stands in the same spot every visit).
export function pick<T>(list: T[], x: number, z: number): T {
  const h = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453);
  return list[Math.floor((h - Math.floor(h)) * list.length)];
}
