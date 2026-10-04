// Draws the arena features that do something: ladders, teleporter pads,
// jump pads, and lava or void pits. The rules live elsewhere (climbing and
// bouncing in PlayerController, teleports and pits on the server); this is
// what they look like, with a glow and particles so they read from afar.

import * as THREE from "three";
import type { JumpPad, Ladder, Level, Pit, Teleporter } from "../../../shared/src/levels/types.ts";
import { PAD_RADIUS, TELEPORT_RADIUS } from "../../../shared/src/levels/types.ts";
import { particles } from "../graphics/Particles.ts";
import { quality } from "../quality.ts";

const time = { value: 0 };

function ladder(parent: THREE.Object3D, l: Ladder): void {
  const w = l.width ?? 1;
  const g = new THREE.Group();
  const wood = new THREE.MeshLambertMaterial({ color: "#8a5a36", flatShading: true });
  for (const s of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.09, l.height + 0.4, 0.09), wood);
    rail.position.set((s * w) / 2, (l.height + 0.4) / 2, 0);
    rail.castShadow = true;
    g.add(rail);
  }
  for (let y = 0.3; y < l.height + 0.2; y += 0.35) {
    const rung = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, 0.07), wood);
    rung.position.set(0, y, 0);
    g.add(rung);
  }
  // Stand it against the wall: the climber faces yaw, the ladder is in front of them.
  g.position.set(l.pos[0], l.pos[1], l.pos[2]);
  g.rotation.y = l.yaw;
  g.translateZ(0.12); // a hair off the wall, toward the climber
  parent.add(g);
}

function padMesh(color: string, radius: number, arrow: boolean): THREE.Group {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(radius + 0.15, radius + 0.25, 0.16, 20), new THREE.MeshLambertMaterial({ color: "#3a3346", flatShading: true }));
  base.position.y = 0.08;
  base.receiveShadow = true;
  g.add(base);
  const glow = new THREE.MeshBasicMaterial({ color, toneMapped: false });
  if (quality() === "ultra") glow.color.multiplyScalar(2.2);
  const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 0.6, radius, 24), glow);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.17;
  g.add(ring);
  if (arrow) {
    const tip = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.35, radius * 0.5, 4), glow);
    tip.position.y = 0.3;
    g.add(tip);
  } else {
    const core = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.45, 20), glow);
    core.rotation.x = -Math.PI / 2;
    core.position.y = 0.171;
    g.add(core);
  }
  return g;
}

function poolMaterial(kind: Pit["kind"]): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    toneMapped: false,
    uniforms: { time, ultra: { value: quality() === "ultra" ? 1 : 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vXZ;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vXZ = w.xz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float time, ultra;
      varying vec2 vXZ;
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y); }
      void main() {
        vec2 p = vXZ * 0.6;
        float f = n(p + vec2(time * 0.15, time * 0.1)) * 0.6 + n(p * 2.3 - time * 0.25) * 0.4;
        ${
          kind === "lava"
            ? `vec3 col = mix(vec3(0.55, 0.06, 0.0), vec3(1.0, 0.55, 0.08), smoothstep(0.35, 0.8, f));
               col += vec3(1.0, 0.85, 0.4) * smoothstep(0.78, 0.95, f);
               col *= 1.0 + ultra * 1.4;`
            : `vec3 col = mix(vec3(0.02, 0.0, 0.05), vec3(0.25, 0.05, 0.45), smoothstep(0.4, 0.9, f));
               float swirl = sin(length(vXZ) * 3.0 - time * 2.0 + f * 4.0);
               col += vec3(0.5, 0.2, 0.9) * smoothstep(0.92, 1.0, swirl) * (0.6 + ultra);`
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

export type Features = { update(time: number, dt: number): void };

export function addFeatures(parent: THREE.Object3D, level: Level): Features {
  for (const l of level.ladders ?? []) ladder(parent, l);
  const teleporters: Teleporter[] = level.teleporters ?? [];
  const pads: JumpPad[] = level.jumpPads ?? [];
  const pits: Pit[] = level.pits ?? [];
  for (const t of teleporters) {
    const g = padMesh(t.color ?? "#5ac8ff", TELEPORT_RADIUS, false);
    g.position.set(...t.pos);
    parent.add(g);
    // A faint beam of light over it.
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(TELEPORT_RADIUS * 0.8, TELEPORT_RADIUS * 0.9, 3, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: t.color ?? "#5ac8ff", transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
    );
    beam.position.set(t.pos[0], t.pos[1] + 1.6, t.pos[2]);
    parent.add(beam);
  }
  for (const p of pads) {
    const g = padMesh("#7dffb0", PAD_RADIUS, true);
    g.position.set(...p.pos);
    parent.add(g);
  }
  for (const pit of pits) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(pit.size[0], pit.size[1]), poolMaterial(pit.kind));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(...pit.pos);
    parent.add(mesh);
    // A low stone lip around it.
    const lip = new THREE.MeshLambertMaterial({ color: pit.kind === "lava" ? "#3a2a26" : "#2a2238", flatShading: true });
    const [w, d] = pit.size;
    for (const [x, z, sw, sd] of [
      [0, -d / 2, w + 0.4, 0.2],
      [0, d / 2, w + 0.4, 0.2],
      [-w / 2, 0, 0.2, d],
      [w / 2, 0, 0.2, d],
    ]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sw, 0.12, sd), lip);
      m.position.set(pit.pos[0] + x, pit.pos[1] + 0.02, pit.pos[2] + z);
      parent.add(m);
    }
    if (pit.kind === "lava" && quality() === "ultra") {
      const light = new THREE.PointLight("#ff6a1a", 10, Math.max(w, d) + 6, 1.6);
      light.position.set(pit.pos[0], pit.pos[1] + 1.2, pit.pos[2]);
      parent.add(light);
    }
  }

  let clock = 0;
  return {
    update(t: number, dt: number) {
      time.value = t;
      clock += dt;
      if (clock < 1 / 15) return;
      clock = 0;
      for (const tp of teleporters) {
        const a = Math.random() * Math.PI * 2;
        particles.emit({
          at: [tp.pos[0] + Math.cos(a) * TELEPORT_RADIUS * 0.8, tp.pos[1] + 0.2, tp.pos[2] + Math.sin(a) * TELEPORT_RADIUS * 0.8],
          count: 1, color: tp.color ?? "#5ac8ff", color2: "#ffffff", up: 2.2, speed: 0.1, life: 1.2, size: 0.12,
        });
      }
      for (const p of pads) particles.emit({ at: [p.pos[0], p.pos[1] + 0.3, p.pos[2]], count: 1, color: "#7dffb0", up: 3, speed: 0.4, spread: PAD_RADIUS, life: 0.7, size: 0.1 });
      for (const pit of pits) {
        const at: [number, number, number] = [pit.pos[0] + (Math.random() - 0.5) * pit.size[0], pit.pos[1] + 0.1, pit.pos[2] + (Math.random() - 0.5) * pit.size[1]];
        if (pit.kind === "lava") particles.emit({ at, count: 1, color: "#ffb347", color2: "#ff3c0a", up: 1.5, speed: 0.3, life: 1.4, size: 0.14, gravity: -0.3 });
        else particles.emit({ at, count: 1, color: "#9a5aff", color2: "#2a1050", up: 0.8, speed: 0.2, life: 1.8, size: 0.2 });
      }
    },
  };
}
