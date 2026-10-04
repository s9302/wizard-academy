// The Wardrobe's live preview: your wizard on a little turntable, in its own
// small canvas. Drag to turn it; it turns slowly by itself otherwise.

import * as THREE from "three";
import type { Look } from "../../../shared/src/unlocks.ts";
import { animateAvatar, createAvatar, disposeAvatar, setAvatarLook } from "../Avatar.ts";

export class WardrobePreview {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 0.78, 0.1, 20);
  private avatar: THREE.Group;
  private id: number;
  private running = true;
  private spin = 0.5;
  private dragging = false;
  private lastX = 0;
  private idleSince = 0;

  constructor(id: number, look: Look) {
    this.id = id;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "wardrobe-preview";
    this.canvas.width = 300;
    this.canvas.height = 384;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(300, 384, false);
    this.scene.add(new THREE.HemisphereLight("#e8e4ff", "#3a3050", 1.7));
    const key = new THREE.DirectionalLight("#fff2dc", 2.2);
    key.position.set(2, 3, -3);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight("#9f7bff", 1.6);
    rim.position.set(-2, 2, 3);
    this.scene.add(rim);
    // A round stone plinth to stand on.
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.65, 0.12, 24), new THREE.MeshLambertMaterial({ color: "#57536f" }));
    plinth.position.y = -0.96;
    this.scene.add(plinth);
    this.avatar = createAvatar(id, "", look, false, { nameTag: false });
    this.scene.add(this.avatar);
    this.camera.position.set(0, 0.35, -4.1);
    this.camera.lookAt(0, 0.1, 0);

    this.canvas.addEventListener("pointerdown", (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      this.spin += (e.clientX - this.lastX) * 0.012;
      this.lastX = e.clientX;
      this.idleSince = performance.now();
    });
    this.canvas.addEventListener("pointerup", () => (this.dragging = false));
    requestAnimationFrame((t) => this.frame(t));
  }

  setLook(look: Look): void {
    setAvatarLook(this.avatar, this.id, look);
  }

  private frame(t: number): void {
    if (!this.running) return;
    requestAnimationFrame((n) => this.frame(n));
    if (!this.dragging && t - this.idleSince > 1500) this.spin += 0.006;
    this.avatar.rotation.y = this.spin;
    animateAvatar(this.avatar, t, 0);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.running = false;
    disposeAvatar(this.avatar);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
