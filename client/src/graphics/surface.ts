// Surface detail for level blocks, drawn by the GPU instead of textures.
//
// Every block face gets two extra vertex attributes: where on the face each
// corner is, in meters (aFace = u, v, width, height), and which pattern to
// draw (aPattern: bricks, planks, grass...). A few lines of shader code then
// draw mortar lines, plank gaps, grass speckle and a darker bevel along each
// face's edges, and bend the lighting along those lines ("bump mapping"), so
// a flat-colored box reads as a stone wall or a wooden ramp.
//
// No image files: the patterns are math on those meter coordinates, so they
// are the same size on every block and cost no downloads.

import * as THREE from "three";
import type { Box } from "../../../shared/src/levels/types.ts";

export const Pattern = { Plain: 0, Grass: 1, Brick: 2, Wood: 3, Sand: 4, Slab: 5, Roof: 6 } as const;
type PatternId = (typeof Pattern)[keyof typeof Pattern];

type Family = "grass" | "wood" | "stone" | "sand" | "roof" | "plain";

// The levels' palettes, by name; anything else is guessed from its color.
const KNOWN: Record<string, Family> = {
  "#6fae5c": "grass", "#4f7d45": "grass", "#6f8f4f": "grass", "#7c9a5a": "grass", "#3f8a4a": "grass",
  "#a8744f": "wood", "#7a5236": "wood", "#6b4a30": "wood", "#5a3e28": "wood",
  "#b9a27a": "sand", "#c98f5f": "sand", "#d9c79a": "sand", "#a4573c": "sand", "#7f4330": "sand",
  "#8d8aa6": "stone", "#6c6889": "stone", "#57536f": "stone", "#a5a2bb": "stone", "#9c9384": "stone",
  "#9c8f7a": "stone", "#8f8a7a": "stone", "#9a7b6a": "stone",
  "#3b2a6b": "roof", "#8a6f8f": "roof",
};

// Which family a color belongs to: known palette colors, else a guess from
// its hue, saturation and lightness (as you'd pick them in a paint program).
function family(color: string): Family {
  const known = KNOWN[color.toLowerCase()];
  if (known) return known;
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(color).getHSL(hsl, THREE.SRGBColorSpace);
  const h = hsl.h * 360;
  if (h >= 75 && h <= 160 && hsl.s > 0.25 && hsl.l < 0.55) return "grass";
  if (h >= 15 && h <= 35 && hsl.s > 0.35 && hsl.l < 0.4) return "wood";
  if (hsl.s < 0.3 && hsl.l > 0.3 && hsl.l < 0.75) return "stone";
  return "plain";
}

// The pattern for one face of a box. Small things (books, chairs) stay plain.
function facePattern(box: Box, kind: Family, up: boolean, faceW: number, faceH: number): PatternId {
  const small = Math.min(...box.size) < 0.25 && Math.max(...box.size) < 3;
  if (faceW * faceH < 1.5 || small) return Pattern.Plain;
  switch (kind) {
    case "grass":
      return Pattern.Grass;
    case "wood":
      return Pattern.Wood;
    case "sand":
      return Pattern.Sand;
    case "roof":
      return up ? Pattern.Roof : Pattern.Brick;
    case "stone":
      return up ? Pattern.Slab : Pattern.Brick;
    default:
      return Pattern.Plain;
  }
}

// Adds aFace and aPattern to a BoxGeometry made for `box` (before it's moved
// into place). BoxGeometry's faces come in the order +x, -x, +y, -y, +z, -z,
// four corners each, with uv running 0..1 across every face.
export function addSurfaceAttributes(geometry: THREE.BufferGeometry, box: Box): void {
  const [w, h, d] = box.size;
  const uv = geometry.getAttribute("uv");
  const count = uv.count;
  const face = new Float32Array(count * 4);
  const pattern = new Float32Array(count);
  const kind = family(box.color);
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  const perFace = count / 6;
  for (let i = 0; i < count; i++) {
    const f = Math.floor(i / perFace);
    const [fw, fh] = dims[f];
    face.set([uv.getX(i) * fw, uv.getY(i) * fh, fw, fh], i * 4);
    pattern[i] = facePattern(box, kind, f === 2, fw, fh);
  }
  geometry.setAttribute("aFace", new THREE.BufferAttribute(face, 4));
  geometry.setAttribute("aPattern", new THREE.BufferAttribute(pattern, 1));
}

const SHADER_FUNCTIONS = /* glsl */ `
varying vec4 vFace;
varying float vPattern;
float surfHeight = 1.0;

float sHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float sNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(sHash(i), sHash(i + vec2(1.0, 0.0)), u.x), mix(sHash(i + vec2(0.0, 1.0)), sHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// Distance to the nearest grout line of a grid of w x h cells, every other
// row shifted by half a cell (running bond). Sets cell to the cell id.
float sGrid(vec2 uv, float w, float h, out vec2 cell) {
  float row = floor(uv.y / h);
  float x = uv.x / w + 0.5 * mod(row, 2.0);
  cell = vec2(floor(x), row);
  vec2 f = vec2(fract(x) * w, fract(uv.y / h) * h);
  return min(min(f.x, w - f.x), min(f.y, h - f.y));
}

// How much to darken this spot, and its "height" for the bump (surfHeight).
float surfaceShade() {
  vec2 uv = vFace.xy;
  vec2 size = vFace.zw;
  int pattern = int(vPattern + 0.5);
  vec2 e = min(uv, size - uv);
  float edge = min(e.x, e.y);
  // A bevel: a little darker right at every block edge.
  float shade = mix(0.8, 1.0, smoothstep(0.0, 0.09, edge));
  float n = sNoise(uv * 1.1) * 0.5 + sNoise(uv * 3.7) * 0.3 + sNoise(uv * 11.0) * 0.2;
  surfHeight = smoothstep(0.0, 0.05, edge);
  vec2 cell;
  if (pattern == 1) { // grass: patches and speckle
    shade *= 0.86 + 0.24 * n;
    shade *= 0.93 + 0.14 * sHash(floor(uv * 22.0));
    surfHeight = n;
  } else if (pattern == 2) { // bricks / cut stone blocks
    float d = sGrid(uv, 1.1, 0.55, cell);
    float line = smoothstep(0.012, 0.04, d);
    shade *= mix(0.68, 1.0, line) * (0.9 + 0.18 * sHash(cell)) * (0.92 + 0.12 * n);
    surfHeight = line * (0.85 + 0.15 * n);
  } else if (pattern == 3) { // planks with grain
    float p = uv.y / 0.28;
    float f = fract(p);
    float gap = smoothstep(0.0, 0.07, min(f, 1.0 - f));
    float grain = sin(uv.x * 24.0 + sNoise(vec2(uv.x * 0.6, floor(p) * 7.0)) * 9.0 + floor(p) * 3.0);
    shade *= mix(0.62, 1.0, gap) * (0.93 + 0.05 * grain) * (0.9 + 0.2 * sHash(vec2(floor(p), 3.0)));
    surfHeight = gap;
  } else if (pattern == 4) { // sand / earth
    shade *= 0.88 + 0.2 * n;
    shade *= 0.95 + 0.1 * sHash(floor(uv * 40.0));
    surfHeight = n;
  } else if (pattern == 5) { // big floor slabs
    float d = sGrid(uv + 0.3, 1.6, 1.6, cell);
    float line = smoothstep(0.01, 0.045, d);
    shade *= mix(0.7, 1.0, line) * (0.9 + 0.16 * sHash(cell)) * (0.92 + 0.12 * n);
    surfHeight = line;
  } else if (pattern == 6) { // roof tiles
    float d = sGrid(uv, 0.5, 0.32, cell);
    float line = smoothstep(0.01, 0.04, d);
    shade *= mix(0.6, 1.0, line) * (0.88 + 0.2 * sHash(cell));
    surfHeight = line;
  } else {
    shade *= 0.96 + 0.06 * n;
  }
  return shade;
}

// Bend the normal along the pattern (three.js's bump-map math).
vec3 surfacePerturb(vec3 surfPos, vec3 surfNorm, float faceDirection) {
  vec2 dHdxy = vec2(dFdx(surfHeight), dFdy(surfHeight)) * 0.6;
  vec3 sx = normalize(dFdx(surfPos));
  vec3 sy = normalize(dFdy(surfPos));
  vec3 r1 = cross(sy, surfNorm);
  vec3 r2 = cross(surfNorm, sx);
  float det = dot(sx, r1) * faceDirection;
  vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
  return normalize(abs(det) * surfNorm - grad);
}
`;

// Teach a Lambert or Standard material to draw the patterns.
export function withSurfaceDetail<T extends THREE.MeshLambertMaterial | THREE.MeshStandardMaterial>(material: T, bump: boolean): T {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute vec4 aFace;\nattribute float aPattern;\nvarying vec4 vFace;\nvarying float vPattern;",
      )
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFace = aFace;\nvPattern = aPattern;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + SHADER_FUNCTIONS)
      .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= surfaceShade();")
      .replace(
        "#include <normal_fragment_maps>",
        bump ? "#include <normal_fragment_maps>\nnormal = surfacePerturb(-vViewPosition, normal, faceDirection);" : "#include <normal_fragment_maps>",
      );
  };
  material.customProgramCacheKey = () => `surface-${bump}`;
  return material;
}
