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
varying float vSurfY; // world height (grime near the ground, moss low on walls)
float surfHeight = 1.0;

float sHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 sHash2(vec2 p) {
  return vec2(sHash(p), sHash(p + 17.31));
}
float sNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(sHash(i), sHash(i + vec2(1.0, 0.0)), u.x), mix(sHash(i + vec2(0.0, 1.0)), sHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// Four octaves of noise (0..1), for weathering and patches.
float sFbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * sNoise(p);
    p = p * 2.03 + 7.1;
    a *= 0.5;
  }
  return v / 0.9375;
}
// Distance to the nearest grout line of rows h tall, each row's blocks a
// different width (w, +-40%) and offset, edges wobbled by noise. Sets cell.
float sBlocks(vec2 uv, float w, float h, float wobble, out vec2 cell) {
  float row = floor(uv.y / h);
  float rw = w * (0.75 + 0.5 * sHash(vec2(row, 4.0)));
  float x = uv.x / rw + sHash(vec2(row, 9.0));
  cell = vec2(floor(x), row);
  float bw = rw;
  vec2 f = vec2(fract(x) * bw, fract(uv.y / h) * h);
  float d = min(min(f.x, bw - f.x), min(f.y, h - f.y));
  return d + (sNoise(uv * 9.0) - 0.5) * wobble;
}

// How to tint this spot (a color multiplier), and its "height" for the bump
// (surfHeight). Fine detail fades with distance (detail), so far-off walls
// don't shimmer.
vec3 surfaceShade() {
  vec2 uv = vFace.xy;
  vec2 size = vFace.zw;
  int pattern = int(vPattern + 0.5);
  vec2 e = min(uv, size - uv);
  float edge = min(e.x, e.y);
  float footprint = length(fwidth(uv));
  float detail = 1.0 - smoothstep(0.03, 0.2, footprint);
  vec3 tint = vec3(mix(0.8, 1.0, smoothstep(0.0, 0.09, edge))); // a bevel at every block edge
  float n = sFbm(uv * 1.3);
  float fine = mix(0.5, sNoise(uv * 23.0), detail);
  surfHeight = smoothstep(0.0, 0.05, edge);
  // Ground grime: a little darker and browner low down on everything.
  float low = 1.0 - smoothstep(0.0, 1.4, vSurfY);
  vec2 cell;
  if (pattern == 1) {
    // Grass: patches from yellow-green to deep green, blade speckle, bare earth.
    float meadow = sFbm(uv * 0.35);
    tint *= mix(vec3(0.82, 0.9, 0.7), vec3(1.08, 1.06, 0.95), meadow);
    tint *= 0.9 + 0.2 * mix(0.5, sHash(floor(uv * 34.0)), detail);
    float dirt = smoothstep(0.62, 0.72, sFbm(uv * 0.6 + 11.0));
    tint = mix(tint, vec3(0.95, 0.78, 0.6), dirt * 0.45);
    surfHeight = n * 0.6 + fine * 0.4;
  } else if (pattern == 2) {
    // Cut stone: uneven blocks, chipped edges, rounded bevels, tones per
    // block, hairline cracks, moss in the mortar near the ground.
    float d = sBlocks(uv, 1.0, 0.5, 0.025 * detail, cell);
    float bevel = smoothstep(0.0, 0.07, d);
    float mortar = 1.0 - smoothstep(0.008, 0.03, d);
    float tone = sHash(cell);
    tint *= mix(vec3(0.92, 0.94, 1.02), vec3(1.06, 1.0, 0.92), tone) * (0.86 + 0.24 * sHash(cell + 3.0));
    tint *= mix(0.62, 1.0, bevel) * (0.88 + 0.18 * n) * (0.94 + 0.08 * fine);
    float crack = (1.0 - smoothstep(0.0, 0.02, abs(sNoise(uv * 3.0 + cell * 5.0) - 0.5))) * step(0.72, sHash(cell + 7.0)) * detail;
    tint *= 1.0 - crack * 0.35;
    float moss = mortar * (0.35 + 0.65 * low) * smoothstep(0.45, 0.7, sFbm(uv * 1.7 + 3.0));
    tint = mix(tint, tint * vec3(0.72, 1.05, 0.62), moss);
    tint *= 1.0 - low * 0.12 * (1.0 - smoothstep(0.0, 0.5, uv.y));
    surfHeight = bevel * (0.85 + 0.15 * n) - crack * 0.3;
  } else if (pattern == 3) {
    // Planks: staggered boards with end seams, wavy grain and rings, knots,
    // a nail at each board end.
    float bh = 0.26;
    float row = floor(uv.y / bh);
    float fy = fract(uv.y / bh);
    float len = 1.4 + sHash(vec2(row, 1.0)) * 1.2;
    float bx = uv.x / len + sHash(vec2(row, 2.0));
    float fx = fract(bx);
    float board = floor(bx);
    float seam = smoothstep(0.0, 0.05, min(fy, 1.0 - fy)) * smoothstep(0.0, 0.01, min(fx, 1.0 - fx) * len);
    vec2 bp = vec2(fx * len, fy * bh);
    float warp = sNoise(vec2(bp.x * 0.8, board * 3.1 + row)) * 6.0;
    float grain = sin((bp.y * 90.0 + warp + sin(bp.x * 3.0 + row) * 1.5));
    float rings = sin(length(vec2(bp.x * 0.15, bp.y * 2.5) - vec2(0.2, 0.15 + sHash(vec2(board, row)) * 0.3)) * 60.0 + warp);
    tint *= (0.86 + 0.24 * sHash(vec2(board, row))) * mix(0.55, 1.0, seam);
    tint *= 0.94 + 0.06 * mix(0.0, grain * 0.6 + rings * 0.4, detail);
    vec2 knotAt = vec2(sHash(vec2(board, row + 5.0)) * len, bh * (0.3 + 0.4 * sHash(vec2(row, board))));
    float knot = (1.0 - smoothstep(0.02, 0.05, length((bp - knotAt) * vec2(0.6, 1.0)))) * step(0.6, sHash(vec2(board + 2.0, row)));
    tint *= 1.0 - knot * 0.45;
    float nail = (1.0 - smoothstep(0.008, 0.014, min(length(bp - vec2(0.06, bh * 0.5)), length(bp - vec2(len - 0.06, bh * 0.5))))) * detail;
    tint = mix(tint, vec3(0.35, 0.33, 0.32), nail);
    surfHeight = seam - knot * 0.2 - nail * 0.5;
  } else if (pattern == 4) {
    // Sand / earth: wind ripples, pebbles, darker patches.
    float ripple = sin(uv.x * 5.5 + uv.y * 1.2 + sFbm(uv * 0.5) * 6.0) * 0.5 + 0.5;
    tint *= (0.86 + 0.18 * n) * (0.95 + 0.06 * ripple);
    // Pebbles: a few cells of a jittered grid get a small filled stone at their point.
    vec2 pg = uv * 3.2;
    vec2 pi = floor(pg);
    vec2 pid = pi;
    float pd = 8.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 o = vec2(float(x), float(y));
        float d = length(o + sHash2(pi + o) * 0.8 + 0.1 - fract(pg));
        if (d < pd) {
          pd = d;
          pid = pi + o;
        }
      }
    }
    float pebble = (1.0 - smoothstep(0.1, 0.17, pd * (0.8 + 0.5 * sHash(pid + 5.0)))) * step(0.8, sHash(pid)) * detail;
    tint *= 1.0 + (sHash(pid + 2.0) - 0.5) * 0.4 * pebble;
    tint *= 0.95 + 0.1 * mix(0.5, sHash(floor(uv * 45.0)), detail);
    surfHeight = ripple * 0.5 + n * 0.5 + pebble * 0.3;
  } else if (pattern == 5) {
    // Floor slabs: uneven sizes, worn middles, cracks, dirt in the seams.
    float d = sBlocks(uv + 0.3, 1.6, 1.25, 0.02 * detail, cell);
    float line = smoothstep(0.012, 0.05, d);
    float worn = sFbm(uv * 0.8 + cell);
    tint *= (0.88 + 0.16 * sHash(cell)) * (0.88 + 0.18 * worn) * (0.95 + 0.07 * fine);
    tint *= mix(vec3(0.62, 0.58, 0.52), vec3(1.0), line);
    float crack = (1.0 - smoothstep(0.0, 0.018, abs(sNoise(uv * 2.2 + cell * 3.0) - 0.5))) * step(0.65, sHash(cell + 11.0)) * detail;
    tint *= 1.0 - crack * 0.3;
    surfHeight = line * (0.8 + 0.2 * worn) - crack * 0.25;
  } else if (pattern == 6) {
    // Roof shingles: rows overlapping, rounded bottoms, a shadow under each.
    float sh = 0.3;
    float row = floor(uv.y / sh);
    float x = uv.x / 0.42 + 0.5 * mod(row, 2.0);
    vec2 sc = vec2(floor(x), row);
    vec2 f = vec2(fract(x), fract(uv.y / sh));
    float roundness = length(vec2((f.x - 0.5) * 1.6, f.y * 1.1));
    float bottom = smoothstep(0.0, 0.25, f.y);
    float sides = smoothstep(0.0, 0.06, min(f.x, 1.0 - f.x));
    tint *= (0.82 + 0.26 * sHash(sc)) * mix(0.55, 1.0, bottom * sides) * (0.9 + 0.12 * n);
    tint *= 1.0 - 0.15 * smoothstep(0.75, 0.95, roundness) * detail;
    surfHeight = bottom * sides;
  } else {
    tint *= (0.93 + 0.1 * n) * (0.97 + 0.04 * fine);
  }
  tint *= mix(vec3(1.0), vec3(0.9, 0.86, 0.8), low * 0.35);
  return tint;
}

// Bend the normal along the pattern (three.js's bump-map math).
vec3 surfacePerturb(vec3 surfPos, vec3 surfNorm, float faceDirection) {
  vec2 dHdxy = vec2(dFdx(surfHeight), dFdy(surfHeight)) * 0.7;
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
        "#include <common>\nattribute vec4 aFace;\nattribute float aPattern;\nvarying vec4 vFace;\nvarying float vPattern;\nvarying float vSurfY;",
      )
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFace = aFace;\nvPattern = aPattern;\nvSurfY = (modelMatrix * vec4(transformed, 1.0)).y;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + SHADER_FUNCTIONS)
      .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= surfaceShade();")
      .replace(
        "#include <normal_fragment_maps>",
        bump ? "#include <normal_fragment_maps>\nnormal = surfacePerturb(-vViewPosition, normal, faceDirection);" : "#include <normal_fragment_maps>",
      );
  };
  material.customProgramCacheKey = () => `surface2-${bump}`;
  return material;
}
