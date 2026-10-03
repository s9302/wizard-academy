// On-screen run info for parkour trials: the timer, checkpoint count, a big
// banner for checkpoints and finishes, and the room's leaderboard. It only
// displays what the server decided (see server/src/rooms/ParkourRoom.ts).

import type { ServerClock } from "./ServerClock.ts";

export function formatTime(ms: number): string {
  const total = Math.max(0, ms) / 1000;
  const minutes = Math.floor(total / 60);
  const seconds = (total % 60).toFixed(2).padStart(5, "0");
  return minutes > 0 ? `${minutes}:${seconds}` : (total % 60).toFixed(2);
}

function el(tag: string, id: string, parent: HTMLElement): HTMLElement {
  const node = document.createElement(tag);
  node.id = id;
  parent.appendChild(node);
  return node;
}

export class ParkourHud {
  private clock: ServerClock;
  private count: number;
  private timerEl: HTMLElement;
  private progressEl: HTMLElement;
  private bannerEl: HTMLElement;
  private boardEl: HTMLElement;
  private state: "ready" | "running" | "finished" = "ready";
  private startedAt = 0;
  private finalTime = 0;
  private reached = 0;
  private bannerTimer: number | undefined;

  constructor(hud: HTMLElement, clock: ServerClock, checkpointCount: number, levelName: string) {
    this.clock = clock;
    this.count = checkpointCount;
    const run = el("div", "run", hud);
    el("div", "run-name", run).textContent = levelName;
    this.timerEl = el("div", "run-timer", run);
    this.progressEl = el("div", "run-progress", run);
    this.bannerEl = el("div", "banner", hud);
    this.boardEl = el("div", "leaderboard", hud);
    this.reset();
  }

  reset(): void {
    this.state = "ready";
    this.reached = 0;
    this.progressEl.textContent = "Step off the platform to start · R to restart";
    this.timerEl.textContent = formatTime(0);
  }

  runStart(serverTime: number): void {
    this.state = "running";
    this.startedAt = serverTime;
    this.updateProgress();
  }

  checkpoint(reached: number, split: number): void {
    this.reached = reached;
    this.updateProgress();
    this.banner(`Checkpoint ${reached}/${this.count} · ${formatTime(split)}`);
  }

  finish(time: number, best: number, newBest: boolean): void {
    this.state = "finished";
    this.finalTime = time;
    this.timerEl.textContent = formatTime(time);
    this.progressEl.textContent = `Best ${formatTime(best)} · R to run again`;
    this.banner(newBest ? `Finished! ${formatTime(time)} — new best!` : `Finished! ${formatTime(time)}`, 4000);
  }

  leaderboard(entries: { name: string; time: number }[], myName: string): void {
    this.boardEl.replaceChildren();
    const title = document.createElement("div");
    title.className = "board-title";
    title.textContent = "Best times";
    this.boardEl.appendChild(title);
    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "No finishes yet";
      this.boardEl.appendChild(empty);
    }
    entries.forEach((entry, i) => {
      const row = document.createElement("div");
      row.className = entry.name.toLowerCase() === myName.toLowerCase() ? "board-row me" : "board-row";
      // textContent, never innerHTML: names come from other players.
      row.textContent = `${i + 1}. ${entry.name} — ${formatTime(entry.time)}`;
      this.boardEl.appendChild(row);
    });
  }

  update(): void {
    if (this.state === "running") this.timerEl.textContent = formatTime(this.clock.now() - this.startedAt);
    else if (this.state === "finished") this.timerEl.textContent = formatTime(this.finalTime);
  }

  private updateProgress(): void {
    this.progressEl.textContent = `Checkpoint ${this.reached}/${this.count}`;
  }

  private banner(text: string, ms = 2000): void {
    this.bannerEl.textContent = text;
    this.bannerEl.classList.add("show");
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.bannerEl.classList.remove("show"), ms);
  }
}
