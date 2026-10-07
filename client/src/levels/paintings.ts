// Canvas-painted pictures for the academy's walls: portraits, landscapes,
// a seascape, a dragon, the academy by night, a starfield, the Potions
// Classroom's blackboard, house crests and common-room notice boards. Each
// is drawn once, from a seeded random, so it looks the same for everyone.

import * as THREE from "three";
import { HOUSES } from "../../../shared/src/houses.ts";

const HOUSE_BY_NAME = Object.fromEntries(Object.values(HOUSES).map((h) => [h.name, h]));

const cache = new Map<string, THREE.CanvasTexture>();

// A house emblem in one color, centered on (cx, cy), about `size` across.
export function drawEmblem(g: CanvasRenderingContext2D, emblem: string, cx: number, cy: number, size: number, color: string): void {
  const s = size / 100;
  g.save();
  g.translate(cx, cy);
  g.scale(s, s);
  g.fillStyle = g.strokeStyle = color;
  g.lineCap = g.lineJoin = "round";
  switch (emblem) {
    case "lion": {
      // A mane of points round a face, ears, a muzzle.
      g.beginPath();
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const r = i % 2 ? 34 : 48;
        g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.fill();
      g.globalCompositeOperation = "destination-out";
      g.beginPath();
      g.arc(0, 2, 24, 0, Math.PI * 2);
      g.fill();
      g.globalCompositeOperation = "source-over";
      g.beginPath();
      g.arc(-9, -4, 3.5, 0, Math.PI * 2);
      g.arc(9, -4, 3.5, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.moveTo(-6, 8);
      g.lineTo(6, 8);
      g.lineTo(0, 15);
      g.fill();
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(0, 15);
      g.lineTo(0, 19);
      g.moveTo(-8, 21);
      g.quadraticCurveTo(0, 26, 8, 21);
      g.stroke();
      break;
    }
    case "snake": {
      // An S of a body with a head and a forked tongue.
      g.lineWidth = 13;
      g.beginPath();
      g.moveTo(-30, 42);
      g.bezierCurveTo(30, 42, 32, 10, 0, 4);
      g.bezierCurveTo(-32, -2, -30, -34, 14, -36);
      g.stroke();
      g.beginPath();
      g.ellipse(22, -37, 13, 9, 0, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(34, -37);
      g.lineTo(44, -37);
      g.lineTo(48, -42);
      g.moveTo(44, -37);
      g.lineTo(48, -32);
      g.stroke();
      g.globalCompositeOperation = "destination-out";
      g.beginPath();
      g.arc(25, -40, 2.5, 0, Math.PI * 2);
      g.fill();
      g.globalCompositeOperation = "source-over";
      break;
    }
    case "eagle": {
      // Spread wings, a body, a hooked head.
      g.beginPath();
      g.moveTo(0, -10);
      g.lineTo(-48, -32);
      g.lineTo(-42, -18);
      g.lineTo(-50, -14);
      g.lineTo(-40, -4);
      g.lineTo(-46, 2);
      g.lineTo(-10, 8);
      g.lineTo(-8, 30);
      g.lineTo(-16, 44);
      g.lineTo(0, 36);
      g.lineTo(16, 44);
      g.lineTo(8, 30);
      g.lineTo(10, 8);
      g.lineTo(46, 2);
      g.lineTo(40, -4);
      g.lineTo(50, -14);
      g.lineTo(42, -18);
      g.lineTo(48, -32);
      g.closePath();
      g.fill();
      g.beginPath();
      g.arc(0, -18, 10, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.moveTo(6, -20);
      g.lineTo(16, -16);
      g.lineTo(8, -12);
      g.fill();
      break;
    }
    default: {
      // A badger's head: a broad snout, a stripe down the middle, small ears.
      g.beginPath();
      g.moveTo(-34, -20);
      g.quadraticCurveTo(-36, 18, 0, 40);
      g.quadraticCurveTo(36, 18, 34, -20);
      g.quadraticCurveTo(0, -42, -34, -20);
      g.fill();
      for (const sx of [-1, 1]) {
        g.beginPath();
        g.arc(sx * 30, -26, 8, 0, Math.PI * 2);
        g.fill();
      }
      g.globalCompositeOperation = "destination-out";
      g.beginPath();
      g.moveTo(-5, -34);
      g.lineTo(5, -34);
      g.lineTo(3, 24);
      g.lineTo(-3, 24);
      g.fill();
      for (const sx of [-1, 1]) {
        g.beginPath();
        g.ellipse(sx * 15, -2, 5, 3.5, sx * 0.4, 0, Math.PI * 2);
        g.fill();
      }
      g.globalCompositeOperation = "source-over";
      g.beginPath();
      g.arc(0, 32, 5, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.restore();
}

export function paintingTexture(subject: string, caption: string, accent: string | undefined, aspect: number): THREE.CanvasTexture {
  const key = `${subject}|${caption}|${accent}|${aspect.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const H = 256;
  const W = Math.round(H * aspect);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  let seed = 1;
  for (const ch of key) seed = (seed * 31 + ch.charCodeAt(0)) % 2147483647;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const sky = (top: string, bottom: string, to = H) => {
    const grad = g.createLinearGradient(0, 0, 0, to);
    grad.addColorStop(0, top);
    grad.addColorStop(1, bottom);
    g.fillStyle = grad;
    g.fillRect(0, 0, W, to);
  };
  const mountains = (base: number, height: number, color: string) => {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0, H);
    let x = 0;
    g.lineTo(0, base);
    while (x < W) {
      x += 20 + rand() * 50;
      g.lineTo(x, base - rand() * height);
    }
    g.lineTo(W, H);
    g.fill();
  };
  const stars = (n: number, maxY = H) => {
    for (let i = 0; i < n; i++) {
      g.fillStyle = `rgba(255,250,220,${0.4 + rand() * 0.6})`;
      g.fillRect(rand() * W, rand() * maxY, 1 + rand() * 1.5, 1 + rand() * 1.5);
    }
  };
  // A little castle silhouette (the academy).
  const castle = (cx: number, base: number, s: number, color: string, lit: boolean) => {
    g.fillStyle = color;
    g.fillRect(cx - 40 * s, base - 40 * s, 80 * s, 40 * s);
    for (const [dx, w, h] of [[-48, 16, 70], [32, 16, 70], [-8, 16, 90]]) {
      g.fillRect(cx + dx * s, base - h * s, w * s, h * s);
      g.beginPath();
      g.moveTo(cx + (dx - 3) * s, base - h * s);
      g.lineTo(cx + (dx + w / 2) * s, base - (h + 28) * s);
      g.lineTo(cx + (dx + w + 3) * s, base - h * s);
      g.fill();
    }
    if (lit) {
      g.fillStyle = "#ffd98a";
      for (let i = 0; i < 9; i++) g.fillRect(cx + (-34 + (i % 5) * 15) * s, base - (30 - Math.floor(i / 5) * 14) * s, 4 * s, 6 * s);
    }
  };

  switch (subject) {
    case "portrait": {
      // Someone in a wizard's hat, half-length, against a dark drape.
      const robe = accent ?? "#4a2a9e";
      sky("#2a2238", "#120e1a");
      g.fillStyle = "rgba(255,255,255,0.04)";
      for (let i = 0; i < 6; i++) g.fillRect(rand() * W, 0, 6 + rand() * 10, H);
      const cx = W / 2;
      g.fillStyle = robe;
      g.beginPath();
      g.moveTo(cx - W * 0.42, H);
      g.quadraticCurveTo(cx - W * 0.34, H * 0.55, cx, H * 0.56);
      g.quadraticCurveTo(cx + W * 0.34, H * 0.55, cx + W * 0.42, H);
      g.fill();
      const blank = caption.includes("First");
      g.fillStyle = ["#f0c8a0", "#d9a77c", "#a8754e", "#7a4e30"][Math.floor(rand() * 4)];
      g.beginPath();
      g.ellipse(cx, H * 0.43, W * 0.13, H * 0.12, 0, 0, Math.PI * 2);
      g.fill();
      // A beard, sometimes.
      if (rand() < 0.5) {
        g.fillStyle = ["#d8d8e0", "#5a3a2a", "#2a2228"][Math.floor(rand() * 3)];
        g.beginPath();
        g.moveTo(cx - W * 0.1, H * 0.46);
        g.lineTo(cx, H * 0.66);
        g.lineTo(cx + W * 0.1, H * 0.46);
        g.fill();
      }
      g.fillStyle = "#1a1420";
      if (!blank) {
        g.fillRect(cx - W * 0.06, H * 0.41, W * 0.03, H * 0.02);
        g.fillRect(cx + W * 0.03, H * 0.41, W * 0.03, H * 0.02);
      }
      // The hat.
      g.fillStyle = robe;
      g.beginPath();
      g.moveTo(cx - W * 0.22, H * 0.33);
      g.lineTo(cx + W * 0.04, H * 0.04);
      g.lineTo(cx + W * 0.2, H * 0.33);
      g.fill();
      g.fillRect(cx - W * 0.28, H * 0.32, W * 0.56, H * 0.03);
      if (blank) {
        // Scratched out.
        g.strokeStyle = "#0e0a12";
        g.lineWidth = 3;
        for (let i = 0; i < 14; i++) {
          g.beginPath();
          g.moveTo(cx - W * 0.15 + rand() * W * 0.08, H * 0.3 + rand() * H * 0.08);
          g.lineTo(cx + W * 0.07 + rand() * W * 0.08, H * 0.5 + rand() * H * 0.08);
          g.stroke();
        }
      }
      break;
    }
    case "landscape": {
      sky("#7fb8ff", "#ffe2b0", H * 0.7);
      g.fillStyle = "rgba(255,255,255,0.8)";
      for (let i = 0; i < 4; i++) {
        const x = rand() * W;
        const y = 20 + rand() * 60;
        g.beginPath();
        g.ellipse(x, y, 30 + rand() * 30, 8 + rand() * 6, 0, 0, Math.PI * 2);
        g.fill();
      }
      mountains(H * 0.6, H * 0.3, "#7a86b0");
      mountains(H * 0.72, H * 0.15, "#4f7d55");
      g.fillStyle = "#6fae5c";
      g.fillRect(0, H * 0.8, W, H * 0.2);
      if (caption.includes("Academy") || caption.includes("Garden")) castle(W * 0.7, H * 0.8, 0.6, "#5a5672", false);
      for (let i = 0; i < 14; i++) {
        g.fillStyle = ["#ff8fb8", "#ffd25a", "#ffffff", "#c58fff"][i % 4];
        g.fillRect(rand() * W, H * 0.84 + rand() * H * 0.14, 3, 3);
      }
      break;
    }
    case "seascape": {
      sky("#ffb07a", "#ffe4b8", H * 0.55);
      g.fillStyle = "#ffef9a";
      g.beginPath();
      g.arc(W * 0.3, H * 0.5, 26, 0, Math.PI * 2);
      g.fill();
      const sea = g.createLinearGradient(0, H * 0.55, 0, H);
      sea.addColorStop(0, "#2a6fa0");
      sea.addColorStop(1, "#123a5a");
      g.fillStyle = sea;
      g.fillRect(0, H * 0.55, W, H * 0.45);
      g.strokeStyle = "rgba(255,240,200,0.5)";
      for (let i = 0; i < 30; i++) {
        const y = H * 0.58 + rand() * H * 0.4;
        g.beginPath();
        g.moveTo(rand() * W, y);
        g.lineTo(rand() * W, y);
        g.stroke();
      }
      // A ruined tower on a rock.
      g.fillStyle = "#3a3346";
      g.beginPath();
      g.moveTo(W * 0.62, H * 0.62);
      g.lineTo(W * 0.92, H * 0.62);
      g.lineTo(W * 0.86, H * 0.5);
      g.lineTo(W * 0.7, H * 0.52);
      g.fill();
      g.fillRect(W * 0.74, H * 0.24, W * 0.06, H * 0.3);
      break;
    }
    case "dragon": {
      sky("#1a2a4a", "#9ad0ff");
      mountains(H * 0.75, H * 0.35, "#e8f4ff");
      mountains(H * 0.88, H * 0.12, "#a8c4dc");
      // A pale dragon in flight: body, wings, tail.
      const cx = W * 0.5;
      const cy = H * 0.38;
      g.fillStyle = "#d8f0ff";
      g.beginPath();
      g.moveTo(cx - 70, cy + 30);
      g.lineTo(cx - 10, cy - 50);
      g.lineTo(cx + 5, cy);
      g.lineTo(cx + 20, cy - 60);
      g.lineTo(cx + 75, cy + 25);
      g.lineTo(cx + 10, cy + 15);
      g.fill();
      g.beginPath();
      g.ellipse(cx, cy + 12, 40, 10, 0.1, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.moveTo(cx + 38, cy + 8);
      g.lineTo(cx + 60, cy + 2);
      g.lineTo(cx + 40, cy + 18);
      g.fill();
      g.strokeStyle = "#d8f0ff";
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(cx - 38, cy + 16);
      g.quadraticCurveTo(cx - 80, cy + 40, cx - 110, cy + 20);
      g.stroke();
      break;
    }
    case "night":
    case "castle": {
      const night = subject === "night";
      sky(night ? "#0b1030" : "#3a2a5a", night ? "#2a2a6a" : "#ff9a6a", H);
      stars(night ? 90 : 25, H * 0.6);
      g.fillStyle = night ? "#fff6d0" : "#ffe08a";
      g.beginPath();
      g.arc(W * 0.8, H * 0.22, night ? 18 : 24, 0, Math.PI * 2);
      g.fill();
      mountains(H * 0.8, H * 0.12, night ? "#141a3a" : "#3a2a3a");
      castle(W * 0.45, H * 0.82, night ? 1.2 : 1, night ? "#0e1028" : "#2a1e30", true);
      g.fillStyle = night ? "#0a0c20" : "#20182a";
      g.fillRect(0, H * 0.82, W, H * 0.18);
      break;
    }
    case "stars": {
      sky("#05060f", "#1a1440");
      stars(160);
      // A comet, and a few constellations joined up.
      g.strokeStyle = "rgba(200,220,255,0.6)";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(W * 0.15, H * 0.2);
      g.lineTo(W * 0.4, H * 0.45);
      g.stroke();
      g.fillStyle = "#e8f4ff";
      g.beginPath();
      g.arc(W * 0.4, H * 0.45, 5, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "rgba(232,197,71,0.6)";
      g.lineWidth = 1;
      for (let k = 0; k < 3; k++) {
        g.beginPath();
        let x = W * (0.5 + rand() * 0.4);
        let y = H * (0.15 + rand() * 0.6);
        g.moveTo(x, y);
        for (let i = 0; i < 4; i++) {
          x += (rand() - 0.5) * 60;
          y += (rand() - 0.5) * 50;
          g.lineTo(x, y);
          g.fillStyle = "#fff";
          g.fillRect(x - 1.5, y - 1.5, 3, 3);
        }
        g.stroke();
      }
      break;
    }
    case "crest": {
      // A house's shield: its color, a gilt edge, its emblem, its name.
      const house = HOUSE_BY_NAME[caption];
      sky("#2a2238", "#120e1a");
      const color = house?.color ?? accent ?? "#7a1f3a";
      const trim = house?.trim ?? "#e8c547";
      g.beginPath();
      g.moveTo(W * 0.15, H * 0.06);
      g.lineTo(W * 0.85, H * 0.06);
      g.lineTo(W * 0.85, H * 0.5);
      g.quadraticCurveTo(W * 0.85, H * 0.78, W * 0.5, H * 0.88);
      g.quadraticCurveTo(W * 0.15, H * 0.78, W * 0.15, H * 0.5);
      g.closePath();
      g.fillStyle = color;
      g.fill();
      g.lineWidth = 8;
      g.strokeStyle = trim;
      g.stroke();
      drawEmblem(g, house?.emblem ?? "lion", W / 2, H * 0.44, Math.min(W, H) * 0.5, trim);
      // The name goes on the plaque below (the caption).
      break;
    }
    case "notices": {
      // A cork board with notes pinned up (the caption is the house's name).
      g.fillStyle = "#a8794a";
      g.fillRect(0, 0, W, H);
      g.fillStyle = "rgba(0,0,0,0.12)";
      for (let i = 0; i < 300; i++) g.fillRect(rand() * W, rand() * H, 2, 2);
      const notes = [
        `${caption} common room rules: 1. No hexing the furniture.`,
        "Ditchquid tryouts! Bring your own broom.",
        "LOST: one toad. Answers to 'Gerald'.",
        "Study group for Trial IV, Thursdays",
        "Whoever took my socks: I know.",
        "House points this week: we're winning (probably)",
      ];
      const spots = [[0.05, 0.08], [0.52, 0.06], [0.08, 0.5], [0.55, 0.45], [0.3, 0.27], [0.32, 0.7]];
      g.font = `${Math.round(H * 0.055)}px Georgia, serif`;
      g.textBaseline = "top";
      notes.forEach((text, i) => {
        const [fx, fy] = spots[i];
        const x = fx * W;
        const y = fy * H;
        const w = W * 0.42;
        const h = H * 0.24;
        g.save();
        g.translate(x + w / 2, y + h / 2);
        g.rotate((rand() - 0.5) * 0.12);
        g.fillStyle = ["#f4efe0", "#fff3a8", "#dff0ff", "#ffe0e8"][i % 4];
        g.fillRect(-w / 2, -h / 2, w, h);
        g.fillStyle = "#2a2230";
        // Wrap the note's words onto lines.
        const words = text.split(" ");
        let line = "";
        let ly = -h / 2 + 6;
        for (const word of words) {
          const next = line ? `${line} ${word}` : word;
          if (g.measureText(next).width > w - 12 && line) {
            g.fillText(line, -w / 2 + 6, ly);
            line = word;
            ly += H * 0.065;
          } else line = next;
        }
        g.fillText(line, -w / 2 + 6, ly);
        g.fillStyle = accent ?? "#c8323c";
        g.beginPath();
        g.arc(0, -h / 2 + 4, 4, 0, Math.PI * 2);
        g.fill();
        g.restore();
      });
      return finish(c, key);
    }
    case "blackboard": {
      g.fillStyle = "#1f3a2c";
      g.fillRect(0, 0, W, H);
      g.fillStyle = "rgba(255,255,255,0.05)";
      for (let i = 0; i < 40; i++) g.fillRect(rand() * W, rand() * H, 30 + rand() * 60, 4 + rand() * 6);
      g.fillStyle = g.strokeStyle = "rgba(240,240,230,0.85)";
      g.lineWidth = 2;
      g.font = "italic 22px Georgia, serif";
      g.textBaseline = "top";
      g.fillText("Today: Draught of Swiftness", 20, 16);
      g.font = "16px Georgia, serif";
      [
        "1. Three sprigs of windleaf (chopped, not torn)",
        "2. Stir clockwise x7, then ONCE anticlockwise",
        "3. Add the feather LAST. Not first. Looking at you.",
        "4. Simmer until it hums a low C",
      ].forEach((line, i) => g.fillText(line, 24, 56 + i * 26));
      // A cauldron doodle, and an arrow.
      const cx = W * 0.82;
      g.beginPath();
      g.arc(cx, H * 0.62, 40, 0, Math.PI);
      g.stroke();
      g.beginPath();
      g.moveTo(cx - 46, H * 0.62);
      g.lineTo(cx + 46, H * 0.62);
      g.stroke();
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.arc(cx - 15 + i * 15, H * 0.5 - i * 10, 6, 0, Math.PI * 2);
        g.stroke();
      }
      g.font = "bold 18px Georgia, serif";
      g.fillText("NO EXPLODING.", 24, H - 44);
      break;
    }
    default:
      sky("#555", "#222");
  }

  // A brass plaque with the title.
  if (caption) {
    g.font = `bold ${Math.round(H * 0.06)}px Georgia, serif`;
    const tw = g.measureText(caption).width + 20;
    const ph = H * 0.09;
    g.fillStyle = "#b8923a";
    g.fillRect((W - tw) / 2, H - ph - 6, tw, ph);
    g.fillStyle = "#2a1e10";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(caption, W / 2, H - ph / 2 - 6);
  }
  return finish(c, key);
}

function finish(c: HTMLCanvasElement, key: string): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}
