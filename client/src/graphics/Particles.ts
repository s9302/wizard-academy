// Glowing particles: spell trails, sparks when a spell lands, torch flames,
// fountain spray, portal swirls. One pool of points drawn in a single draw
// call; each particle has a velocity, a lifetime, a color and a size, and
// fades and shrinks as it ages.
//
// Game-dev note: particles are "fire and forget". Nobody keeps a handle to
// one; you emit a burst and the pool recycles the oldest slots when full.

import * as THREE from "three";
import { quality } from "../quality.ts";

export type Emit = {
  at: THREE.Vector3 | readonly [number, number, number];
  count?: number;
  color: THREE.ColorRepresentation;
  color2?: THREE.ColorRepresentation; // each particle picks a color between the two
  speed?: number; // m/s, random directions
  up?: number; // extra upward speed
  spread?: number; // start position jitter, meters
  life?: number; // seconds
  size?: number; // meters
  gravity?: number; // m/s^2 (negative floats up)
  drag?: number; // 0..1 per second of velocity lost
  dir?: THREE.Vector3; // a bias direction (added to the random one)
};

const MAX: Record<string, number> = { low: 600, high: 2500, ultra: 5000 };

export class Particles {
  readonly points: THREE.Points;
  private max: number;
  private next = 0;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private size: Float32Array;
  private sizeNow: Float32Array;
  private alpha: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private geometry = new THREE.BufferGeometry();
  private tmp = new THREE.Color();
  private tmp2 = new THREE.Color();
  // Fewer particles on lower settings: every emit is scaled by this.
  readonly density: number;

  constructor(parent: THREE.Object3D) {
    const q = quality();
    this.max = MAX[q];
    this.density = q === "low" ? 0.35 : q === "high" ? 0.7 : 1;
    const n = this.max;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.age = new Float32Array(n).fill(1);
    this.life = new Float32Array(n).fill(1);
    this.size = new Float32Array(n);
    this.sizeNow = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("color", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("aSize", new THREE.BufferAttribute(this.sizeNow, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false, // stay bright, so bloom picks them up
      uniforms: { scale: { value: 600 } },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aAlpha;
        attribute vec3 color;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float scale;
        void main() {
          vColor = color;
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * scale / max(-mv.z, 0.1);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = dot(c, c) * 4.0;
          if (d > 1.0) discard;
          float glow = (1.0 - d) * (1.0 - d);
          gl_FragColor = vec4(vColor * glow * vAlpha * 1.6, 1.0);
        }`,
    });
    this.points = new THREE.Points(this.geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    parent.add(this.points);
  }

  // Point size scale depends on the screen height (keeps sizes in meters).
  resize(height: number, fovDeg: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.scale.value = height / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
  }

  emit(e: Emit): void {
    const count = Math.max(1, Math.round((e.count ?? 10) * this.density));
    const at = e.at instanceof THREE.Vector3 ? [e.at.x, e.at.y, e.at.z] : e.at;
    this.tmp.set(e.color);
    this.tmp2.set(e.color2 ?? e.color);
    const speed = e.speed ?? 1;
    const spread = e.spread ?? 0;
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      // A random direction on a sphere.
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const s = speed * (0.4 + Math.random() * 0.6);
      this.vel[i * 3] = r * Math.cos(a) * s + (e.dir?.x ?? 0);
      this.vel[i * 3 + 1] = u * s + (e.up ?? 0) + (e.dir?.y ?? 0);
      this.vel[i * 3 + 2] = r * Math.sin(a) * s + (e.dir?.z ?? 0);
      this.pos[i * 3] = at[0] + (Math.random() - 0.5) * spread;
      this.pos[i * 3 + 1] = at[1] + (Math.random() - 0.5) * spread;
      this.pos[i * 3 + 2] = at[2] + (Math.random() - 0.5) * spread;
      const m = Math.random();
      this.col[i * 3] = this.tmp.r + (this.tmp2.r - this.tmp.r) * m;
      this.col[i * 3 + 1] = this.tmp.g + (this.tmp2.g - this.tmp.g) * m;
      this.col[i * 3 + 2] = this.tmp.b + (this.tmp2.b - this.tmp.b) * m;
      this.age[i] = 0;
      this.life[i] = (e.life ?? 0.6) * (0.6 + Math.random() * 0.5);
      this.size[i] = (e.size ?? 0.2) * (0.7 + Math.random() * 0.6);
      this.grav[i] = e.gravity ?? 0;
      this.drag[i] = e.drag ?? 0;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      if (this.age[i] >= this.life[i]) {
        if (this.alpha[i] !== 0) {
          this.alpha[i] = 0;
          this.sizeNow[i] = 0;
        }
        continue;
      }
      this.age[i] += dt;
      const k = Math.min(1, this.age[i] / this.life[i]);
      const slow = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= slow;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * slow - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= slow;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.alpha[i] = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
      this.sizeNow[i] = this.size[i] * (1 - 0.5 * k);
    }
    for (const name of ["position", "color", "aSize", "aAlpha"]) this.geometry.getAttribute(name).needsUpdate = true;
  }

  dispose(): void {
    this.points.removeFromParent();
    this.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

// One shared pool per game (set by Game.ts), so any module can emit.
let shared: Particles | null = null;
export const particles = {
  set(p: Particles | null): void {
    shared = p;
  },
  emit(e: Emit): void {
    shared?.emit(e);
  },
  get density(): number {
    return shared?.density ?? 0;
  },
};
