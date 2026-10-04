// Ultra graphics: the frame is drawn into an off-screen image first, then
// improved in passes before it reaches the screen ("post-processing"):
//
// 1. Ambient occlusion (GTAO): darkens corners and creases where light
//    can't easily reach, like where a wall meets the floor.
// 2. Bloom: very bright things (spells, windows, crystals, the sun) bleed a
//    soft glow onto what's around them.
// 3. A color grade: a little extra contrast and warmth, and a gentle
//    vignette that darkens the corners of the screen.
// 4. Output: filmic tone mapping (bright highlights roll off smoothly
//    instead of clipping to white) and conversion to screen colors.
//
// Anti-aliasing comes from rendering the first image with 4x multisampling.

import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    vignette: { value: 0.32 },
    warmth: { value: 0.03 },
    contrast: { value: 1.06 },
    saturation: { value: 1.1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float vignette, warmth, contrast, saturation;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, saturation);
      col = (col - 0.18) * contrast + 0.18;
      col += vec3(warmth, warmth * 0.4, -warmth);
      vec2 d = vUv - 0.5;
      col *= 1.0 - vignette * smoothstep(0.25, 0.85, dot(d, d) * 2.2);
      gl_FragColor = vec4(max(col, 0.0), c.a);
    }`,
};

export class PostFX {
  private composer: EffectComposer;
  private gtao: GTAOPass;
  private bloom: UnrealBloomPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    const size = renderer.getSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.gtao = new GTAOPass(scene, camera, size.x, size.y);
    this.gtao.blendIntensity = 0.85;
    this.gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.5, scale: 1, samples: 12 });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    this.composer.addPass(this.gtao);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.55, 0.45, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new ShaderPass(GradeShader));
    this.composer.addPass(new OutputPass());
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
  }

  setPixelRatio(r: number): void {
    this.composer.setPixelRatio(r);
  }

  render(dt: number): void {
    this.composer.render(dt);
  }

  dispose(): void {
    this.gtao.dispose();
    this.bloom.dispose();
    this.composer.dispose();
  }
}
