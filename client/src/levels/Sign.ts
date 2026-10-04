// A floating sign: a canvas texture on a sprite (always faces the camera), with
// a title, an optional colored subtitle, and a few lines of text. Used for the
// hub's portal signs and area labels. Text is drawn with fillText, so names
// and other text can never inject HTML.

import * as THREE from "three";

const W = 512;
const H = 208;

export type SignText = { title: string; subtitle?: string; lines?: string[]; color: string };

export class Sign {
  readonly sprite: THREE.Sprite;
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;

  constructor(text: SignText, width = 5.4) {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    this.ctx = canvas.getContext("2d")!;
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture, depthWrite: false }));
    this.sprite.scale.set(width, (width * H) / W, 1);
    this.draw(text);
  }

  draw({ title, subtitle = "", lines = [], color }: SignText): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(20, 14, 38, 0.78)";
    ctx.beginPath();
    ctx.roundRect(4, 4, W - 8, H - 8, 22);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // With fewer lines, center the block vertically.
    const rows = 1 + (subtitle ? 1 : 0) + lines.length;
    let y = H / 2 - ((rows - 1) * 40) / 2 - (rows > 1 ? 4 : 0);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 50px system-ui, sans-serif";
    ctx.fillText(title, W / 2, y);
    y += 44;
    if (subtitle) {
      ctx.fillStyle = color;
      ctx.font = "600 34px system-ui, sans-serif";
      ctx.fillText(subtitle, W / 2, y);
      y += 40;
    }
    ctx.fillStyle = "#e8e0f5";
    ctx.font = "32px system-ui, sans-serif";
    for (const line of lines) {
      ctx.fillText(line, W / 2, y);
      y += 36;
    }
    this.texture.needsUpdate = true;
  }
}
