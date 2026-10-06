// Texture sets for level blocks: "classic" (the patterns drawn in code, see
// surface.ts) or "oga", real tiling textures from OpenGameArt.org (all CC0;
// credits in public/textures/CREDITS.md). The choice is remembered in this
// browser and switches at once: every level material reads the same uniforms.
//
// The textures come as one atlas image (a grid of square tiles, listed in
// textureAtlas.ts), loaded the first time they're wanted and copied into a
// texture array, so a block face just names its layer.

import * as THREE from "three";
import { ATLAS, type TexFamily } from "./textureAtlas.ts";

export type TextureSet = "classic" | "oga";
export const TEXTURE_SET_NAMES: Record<TextureSet, string> = { classic: "Classic", oga: "OpenGameArt" };
const KEY = "wa.textures";

function saved(): TextureSet {
  try {
    return localStorage.getItem(KEY) === "oga" ? "oga" : "classic";
  } catch {
    return "classic";
  }
}

let current: TextureSet = saved();
export const textureSet = (): TextureSet => current;

// Shared by every level material (see withSurfaceDetail).
const placeholder = new THREE.DataArrayTexture(new Uint8Array([128, 128, 128, 255]), 1, 1, 1);
placeholder.needsUpdate = true;
export const textureUniforms = {
  uTexOn: { value: 0 },
  uTex: { value: placeholder as THREE.DataArrayTexture },
};

let loading: Promise<void> | null = null;
function loadAtlas(): Promise<void> {
  return (loading ??= new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const { tile, columns, layers } = ATLAS;
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);
      const data = new Uint8Array(tile * tile * 4 * layers.length);
      layers.forEach((_, i) => {
        const px = ctx.getImageData((i % columns) * tile, Math.floor(i / columns) * tile, tile, tile).data;
        data.set(px, i * tile * tile * 4);
      });
      const tex = new THREE.DataArrayTexture(data, tile, tile, layers.length);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      tex.anisotropy = 8;
      tex.needsUpdate = true;
      textureUniforms.uTex.value = tex;
      resolve();
    };
    img.onerror = () => {
      loading = null;
      reject(new Error("texture atlas failed to load"));
    };
    img.src = ATLAS.url;
  }));
}

// Switch sets; resolves once the new look is showing.
export async function setTextureSet(set: TextureSet): Promise<void> {
  current = set;
  try {
    localStorage.setItem(KEY, set);
  } catch {
    // not remembered, but used for this visit
  }
  if (set === "oga") await loadAtlas();
  textureUniforms.uTexOn.value = current === "oga" ? 1 : 0;
}

// At startup: load the atlas if this browser chose it last time.
export function initTextures(): void {
  if (current === "oga") setTextureSet("oga").catch(() => (textureUniforms.uTexOn.value = 0));
}

// Which layer a face of this family uses (and how many meters one tile
// covers): the variant is picked from the level and the block's color, so
// each map gets its own mix and differently colored blocks differ. -1: none.
const byFamily = new Map<TexFamily, number[]>();
ATLAS.layers.forEach((l, i) => {
  const list = byFamily.get(l.family) ?? [];
  list.push(i);
  byFamily.set(l.family, list);
});
function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
export function textureLayer(family: TexFamily | null, levelId: string, color: string): [number, number] {
  const list = family && byFamily.get(family);
  if (!list?.length) return [-1, 1];
  const layer = list[strHash(`${levelId}:${family}:${color.toLowerCase()}`) % list.length];
  return [layer, ATLAS.layers[layer].meters];
}
