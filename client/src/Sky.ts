// The sky: a big dome around the camera with a color gradient (deep blue
// overhead, pale at the horizon), a sun with a soft glow, and low-poly clouds
// drifting slowly overhead. The fog uses the horizon color, so far-away things
// fade into the sky instead of into a flat wall.
//
// Game-dev note: the dome is drawn "inside out" (BackSide) and follows the
// camera, so you can never reach its edge. Its color is worked out per pixel
// by a small shader from the direction you're looking.

import * as THREE from "three";
import { swapLook } from "./graphics/textures.ts";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type SkyStyle = "day" | "dusk" | "golden" | "night";

type Preset = {
  top: string;
  horizon: string;
  ground: string; // below the horizon (rarely seen)
  sun: string;
  sunElevation: number; // degrees above the horizon
  sunAzimuth: number; // degrees, 0 = north (-Z), clockwise
  sunLight: string; // the directional light's color
  cloud: string;
  hemiSky: string; // light from the sky dome (Game.ts's hemisphere light)
  hemiGround: string;
  hemi: number;
  sunIntensity: number;
  stars?: boolean;
  fog: [number, number]; // near and far, meters
};

const PRESETS: Record<SkyStyle, Preset> = {
  day: {
    top: "#2f6fd6",
    horizon: "#cfe4f7",
    ground: "#9fb6c9",
    sun: "#fff6d8",
    sunElevation: 55,
    sunAzimuth: 115,
    sunLight: "#fff4d6",
    cloud: "#ffffff",
    hemiSky: "#dfe9ff",
    hemiGround: "#4d6b3c",
    hemi: 1.6,
    sunIntensity: 2.2,
    fog: [60, 260],
  },
  dusk: {
    top: "#27306e",
    horizon: "#f5a27c",
    ground: "#6e4a5f",
    sun: "#ffc06a",
    sunElevation: 14,
    sunAzimuth: 250,
    sunLight: "#ffb987",
    cloud: "#f7c6c9",
    hemiSky: "#c9b6e8",
    hemiGround: "#4d3c5c",
    hemi: 1.3,
    sunIntensity: 2.2,
    stars: true,
    fog: [60, 260],
  },
  // Late afternoon: long shadows and warm light (the academy).
  golden: {
    top: "#3d6fc9",
    horizon: "#ffd9a6",
    ground: "#a88f7a",
    sun: "#ffe2a8",
    sunElevation: 26,
    sunAzimuth: 235,
    sunLight: "#ffd9a0",
    cloud: "#fff0dc",
    hemiSky: "#d6e2ff",
    hemiGround: "#5a6b3c",
    hemi: 1.45,
    sunIntensity: 2.6,
    fog: [70, 280],
  },
  // Moonlit: deep blue, stars, cool light.
  night: {
    top: "#060a24",
    horizon: "#28325e",
    ground: "#141a33",
    sun: "#dfe8ff",
    sunElevation: 38,
    sunAzimuth: 160,
    sunLight: "#9fb4ff",
    cloud: "#6a7399",
    hemiSky: "#6f7fc0",
    hemiGround: "#202842",
    hemi: 0.9,
    sunIntensity: 0.9,
    stars: true,
    fog: [45, 200],
  },
};

const DOME_RADIUS = 450;
const CLOUD_RANGE = 320; // clouds drift across this square and wrap around
const CLOUD_DRIFT = 1.2; // m/s

export class Sky {
  readonly sunDirection: THREE.Vector3;
  readonly sunColor: THREE.Color;
  readonly horizon: THREE.Color;
  readonly preset: Preset;
  private dome: THREE.Mesh;
  private clouds: THREE.Group[] = [];

  // The dome and clouds go into `parent` (the level's group, so they go when
  // the level does); the fog is set on the scene.
  constructor(parent: THREE.Object3D, scene: THREE.Scene, style: SkyStyle, clouds: boolean) {
    const p = PRESETS[style];
    const el = THREE.MathUtils.degToRad(p.sunElevation);
    const az = THREE.MathUtils.degToRad(p.sunAzimuth);
    this.sunDirection = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    this.sunColor = new THREE.Color(p.sunLight);
    this.horizon = new THREE.Color(p.horizon);
    this.preset = p;

    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(DOME_RADIUS, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          top: { value: new THREE.Color(p.top) },
          horizon: { value: new THREE.Color(p.horizon) },
          ground: { value: new THREE.Color(p.ground) },
          sunColor: { value: new THREE.Color(p.sun) },
          sunDir: { value: this.sunDirection },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 top, horizon, ground, sunColor, sunDir;
          varying vec3 vDir;
          void main() {
            vec3 d = normalize(vDir);
            float h = d.y;
            // Pale near the horizon, deep blue overhead; a soft band below.
            vec3 sky = h > 0.0 ? mix(horizon, top, pow(h, 0.55)) : mix(horizon, ground, pow(min(-h * 4.0, 1.0), 0.7));
            float s = max(dot(d, normalize(sunDir)), 0.0);
            sky += sunColor * (pow(s, 6.0) * 0.18 + pow(s, 64.0) * 0.35); // glow around the sun
            sky = mix(sky, sunColor * 1.15, smoothstep(0.9993, 0.9997, s)); // the sun's disc
            gl_FragColor = vec4(sky, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    );
    this.dome.renderOrder = -1;
    this.dome.frustumCulled = false;
    parent.add(this.dome);
    scene.background = null;
    scene.fog = new THREE.Fog(this.horizon, p.fog[0], p.fog[1]);

    if (clouds) this.makeClouds(parent, p.cloud);
    if (clouds && p.stars) this.makeStars(parent, p.sunElevation < 20 ? 0.45 : 1);

    // The OpenGameArt look: Kenney's sky panorama (with its own clouds), and
    // a sun flare, or the moon at night, where the light comes from.
    swapLook(this.dome, [this.dome, ...this.clouds], (a) => {
      const kind = style === "night" ? "night" : style === "day" ? "day" : "morning";
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(DOME_RADIUS, 48, 24),
        new THREE.MeshBasicMaterial({ map: a.sky[kind], side: THREE.BackSide, depthWrite: false, fog: false }),
      );
      sphere.renderOrder = -2;
      sphere.frustumCulled = false;
      const night = style === "night";
      const orb = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: night ? a.moon : a.sun,
          blending: night ? THREE.NormalBlending : THREE.AdditiveBlending,
          color: night ? "#ffffff" : p.sun,
          depthWrite: false,
          fog: false,
          toneMapped: false,
        }),
      );
      orb.scale.setScalar(DOME_RADIUS * (night ? 0.13 : 0.3));
      orb.renderOrder = -1;
      orb.frustumCulled = false;
      parent.add(sphere, orb);
      this.oga = { sphere, orb };
      return [sphere, orb];
    });
  }

  private oga: { sphere: THREE.Mesh; orb: THREE.Sprite } | null = null;

  // Each cloud is a handful of squashed, flat-shaded blobs merged into one mesh.
  private makeClouds(parent: THREE.Object3D, color: string): void {
    const material = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.35, flatShading: true, fog: false });
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 26; i++) {
      const parts: THREE.BufferGeometry[] = [];
      const blobs = 3 + Math.floor(rand() * 4);
      for (let b = 0; b < blobs; b++) {
        const g = new THREE.IcosahedronGeometry(6 + rand() * 7, 0);
        g.scale(1.4, 0.55, 1);
        g.translate((b - blobs / 2) * 9 + rand() * 4, rand() * 3, rand() * 8 - 4);
        parts.push(g);
      }
      const cloud = new THREE.Group();
      cloud.add(new THREE.Mesh(mergeGeometries(parts), material));
      cloud.position.set((rand() - 0.5) * CLOUD_RANGE * 2, 70 + rand() * 45, (rand() - 0.5) * CLOUD_RANGE * 2);
      cloud.rotation.y = rand() * Math.PI;
      parent.add(cloud);
      this.clouds.push(cloud);
    }
  }

  // Stars: points on the upper dome, fading toward the horizon.
  private stars: THREE.Points | null = null;
  private makeStars(parent: THREE.Object3D, brightness: number): void {
    const n = 1400;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    let seed = 99;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      const y = 0.08 + rand() * 0.92;
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(1 - y * y);
      const d = DOME_RADIUS * 0.9;
      pos.set([Math.cos(a) * r * d, y * d, Math.sin(a) * r * d], i * 3);
      const b = (0.4 + rand() * 0.6) * brightness * Math.min(1, y * 3);
      const tint = rand();
      col.set([b * (0.85 + tint * 0.15), b * 0.9, b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, fog: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending }));
    this.stars.renderOrder = -1;
    this.stars.frustumCulled = false;
    parent.add(this.stars);
  }

  update(camera: THREE.Camera, dt: number): void {
    this.dome.position.copy(camera.position);
    this.stars?.position.copy(camera.position);
    if (this.oga) {
      this.oga.sphere.position.copy(camera.position);
      this.oga.orb.position.copy(camera.position).addScaledVector(this.sunDirection, DOME_RADIUS * 0.85);
    }
    for (const cloud of this.clouds) {
      cloud.position.x += CLOUD_DRIFT * dt;
      if (cloud.position.x > CLOUD_RANGE) cloud.position.x -= CLOUD_RANGE * 2;
    }
  }
}
