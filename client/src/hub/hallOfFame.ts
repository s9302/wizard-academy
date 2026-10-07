// The Hall of Champions (upstairs in the academy): the leaderboards on its
// walls and the panel at its lectern. The data comes from /api/halloffame,
// which the server refreshes at most once a minute.

import type { HallOfFame } from "../../../shared/src/hallOfFame.ts";
import { levelInfo } from "../../../shared/src/progression.ts";
import { ROOMS } from "../../../shared/src/rooms.ts";
import { formatTime } from "../ParkourHud.ts";

const MAX_AGE_MS = 30_000;
let cache: { at: number; data: HallOfFame } | null = null;
let pending: Promise<HallOfFame | null> | null = null;

export function getHallOfFame(): Promise<HallOfFame | null> {
  if (cache && Date.now() - cache.at < MAX_AGE_MS) return Promise.resolve(cache.data);
  pending ??= fetch("/api/halloffame")
    .then((r) => (r.ok ? (r.json() as Promise<HallOfFame>) : null))
    .catch(() => null)
    .then((data) => {
      if (data) cache = { at: Date.now(), data };
      pending = null;
      return data ?? cache?.data ?? null;
    });
  return pending;
}

// "Trial IV: The Storm Gate" -> ["Trial IV", "The Storm Gate"]
export const TRIALS = ROOMS.filter((r) => /^trial\d$/.test(r.id)).map((r) => {
  const [short, title] = r.name.split(": ");
  return { id: r.id, short, title: title ?? "" };
});

// "trials:1-5" -> trial1..trial5
function trialsIn(kind: string): typeof TRIALS {
  const m = /^trials:(\d)-(\d)$/.exec(kind);
  if (!m) return [];
  return TRIALS.filter((t) => {
    const n = Number(t.id.slice(5));
    return n >= Number(m[1]) && n <= Number(m[2]);
  });
}

const GOLD = "#e8c547";
const MEDALS = ["#ffd75a", "#d6dae6", "#d08a4a"];

// Draws one wall board ("xp" or "trials:a-b") onto its canvas.
export function drawBoard(canvas: HTMLCanvasElement, kind: string, data: HallOfFame | null): void {
  const g = canvas.getContext("2d")!;
  const W = canvas.width;
  const H = canvas.height;
  // Dark slate with a gilt border.
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#211a33");
  bg.addColorStop(1, "#140f22");
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = GOLD;
  g.lineWidth = 10;
  g.strokeRect(14, 14, W - 28, H - 28);
  g.lineWidth = 2;
  g.strokeRect(30, 30, W - 60, H - 60);
  g.textBaseline = "middle";
  const text = (s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = "left", weight = "") => {
    g.font = `${weight} ${size}px Georgia, "Times New Roman", serif`;
    g.fillStyle = color;
    g.textAlign = align;
    g.fillText(s, x, y);
  };
  const fit = (s: string, max: number) => {
    let out = s;
    while (out.length > 1 && g.measureText(out).width > max) out = out.slice(0, -1);
    return out === s ? s : out.slice(0, -1) + "…";
  };

  if (kind === "xp") {
    text("Champions of the Academy", W / 2, 80, 48, GOLD, "center", "bold");
    text("Most experience", W / 2, 128, 26, "#c8b8f0", "center", "italic");
    const rows = data?.xp ?? [];
    if (!data) text("The board is blank for now…", W / 2, H / 2, 30, "#9a93b0", "center", "italic");
    else if (!rows.length) text("No champions yet. Be the first.", W / 2, H / 2, 30, "#9a93b0", "center", "italic");
    const top = 176;
    const rowH = (H - top - 50) / 10;
    rows.slice(0, 10).forEach((r, i) => {
      const y = top + rowH * (i + 0.5);
      const color = MEDALS[i] ?? "#ece6ff";
      text(`${i + 1}.`, 90, y, 32, color, "right", "bold");
      g.font = "bold 32px Georgia, serif";
      text(fit(r.name, W * 0.5), 110, y, 32, color, "left", i < 3 ? "bold" : "");
      text(`Level ${levelInfo(r.xp).level}`, W * 0.7, y, 28, "#c8b8f0", "center");
      text(`${r.xp.toLocaleString()} XP`, W - 70, y, 28, "#ece6ff", "right");
    });
    return;
  }

  const trials = trialsIn(kind);
  text("Trial Records", W / 2, 72, 44, GOLD, "center", "bold");
  text("The fastest clears", W / 2, 114, 24, "#c8b8f0", "center", "italic");
  if (!data) text("The board is blank for now…", W / 2, H / 2, 30, "#9a93b0", "center", "italic");
  const top = 150;
  const blockH = (H - top - 40) / Math.max(1, trials.length);
  trials.forEach((t, i) => {
    if (!data) return;
    const y0 = top + blockH * i;
    g.strokeStyle = "rgba(232,197,71,0.25)";
    g.lineWidth = 2;
    if (i) {
      g.beginPath();
      g.moveTo(60, y0);
      g.lineTo(W - 60, y0);
      g.stroke();
    }
    text(t.short, 60, y0 + blockH * 0.3, 28, GOLD, "left", "bold");
    text(t.title, 60, y0 + blockH * 0.68, 20, "#c8b8f0", "left", "italic");
    const entries = (data.times[t.id] ?? []).slice(0, 3);
    if (!entries.length) text("Not yet cleared", W * 0.62, y0 + blockH / 2, 24, "#9a93b0", "center", "italic");
    const colW = (W - 320 - 60) / 3;
    entries.forEach((e, j) => {
      const cx = 320 + colW * (j + 0.5);
      g.font = "24px Georgia, serif";
      text(fit(e.name, colW - 16), cx, y0 + blockH * 0.32, 24, MEDALS[j], "center", j === 0 ? "bold" : "");
      text(formatTime(e.time), cx, y0 + blockH * 0.7, 22, "#ece6ff", "center");
    });
  });
}

// Boards in the current level, redrawn when fresh data arrives.
type Board = { canvas: HTMLCanvasElement; kind: string; texture: { needsUpdate: boolean } };
let boards: Board[] = [];
let lastFetch = 0;

// A new level: forget the old one's boards.
export function resetBoards(): void {
  boards = [];
  lastFetch = 0;
}

export function addBoard(board: Board): void {
  boards.push(board);
  drawBoard(board.canvas, board.kind, cache?.data ?? null);
  board.texture.needsUpdate = true;
}

// Called every frame by the props: refreshes the boards once a minute
// (only while the level has any).
export function tickBoards(now: number): void {
  if (!boards.length || now - lastFetch < 60_000) return;
  lastFetch = now;
  const mine = boards;
  void getHallOfFame().then((data) => {
    if (mine !== boards) return; // left the level meanwhile
    for (const b of boards) {
      drawBoard(b.canvas, b.kind, data);
      b.texture.needsUpdate = true;
    }
  });
}
