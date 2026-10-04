// The sky: a big dome around the camera with a color gradient (deep blue
// overhead, pale at the horizon), a sun with a soft glow, and low-poly clouds
// drifting slowly overhead. The fog uses the horizon color, so far-away things
// fade into the sky instead of into a flat wall.
//
// Game-dev note: the dome is drawn "inside out" (BackSide) and follows the
// camera, so you can never reach its edge. Its color is worked out per pixel
// by a small shader from the direction you're looking.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type SkyStyle = "day" | "dusk";

type Preset = {
  top: string;
  horizon: string;
  ground: string; // below the horizon (rarely seen)
  sun: string;
  sunElevation: number; // degrees above the horizon
  sunAzimuth: number; // degrees, 0 = north (-Z), clockwise
  sunLight: string; // the directional light's color
  cloud: string;
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
  },
};

const DOME_RADIUS = 450;
const CLOUD_RANGE = 320; // clouds drift across this square and wrap around
const CLOUD_DRIFT = 1.2; // m/s

export class Sky {
  readonly sunDirection: THREE.Vector3;
  readonly sunColor: THREE.Color;
  readonly horizon: THREE.Color;
  private dome: THREE.Mesh;
  private clouds: THREE.Group[] = [];

  constructor(scene: THREE.Scene, style: SkyStyle, clouds: boolean) {
    const p = PRESETS[style];
    const el = THREE.MathUtils.degToRad(p.sunElevation);
    const az = THREE.MathUtils.degToRad(p.sunAzimuth);
    this.sunDirection = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    this.sunColor = new THREE.Color(p.sunLight);
    this.horizon = new THREE.Color(p.horizon);

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
    scene.add(this.dome);
    scene.background = null;
    scene.fog = new THREE.Fog(this.horizon, 60, 260);

    if (clouds) this.makeClouds(scene, p.cloud);
  }

  // Each cloud is a handful of squashed, flat-shaded blobs merged into one mesh.
  private makeClouds(scene: THREE.Scene, color: string): void {
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
      scene.add(cloud);
      this.clouds.push(cloud);
    }
  }

  update(camera: THREE.Camera, dt: number): void {
    this.dome.position.copy(camera.position);
    for (const cloud of this.clouds) {
      cloud.position.x += CLOUD_DRIFT * dt;
      if (cloud.position.x > CLOUD_RANGE) cloud.position.x -= CLOUD_RANGE * 2;
    }
  }
}
