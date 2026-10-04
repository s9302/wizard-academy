// On-screen info for tag and infection: round state and timer, your role,
// banners when you're tagged, and the results panel at the end of a round.
// Like the parkour HUD, it only shows what the server decided.

import type { RoundState } from "../../shared/src/protocol.ts";
import type { RoomMode } from "../../shared/src/rooms.ts";
import { BotControls } from "./BotControls.ts";
import type { ServerClock } from "./ServerClock.ts";

function el(tag: string, id: string, parent: HTMLElement): HTMLElement {
  const node = document.createElement(tag);
  node.id = id;
  parent.appendChild(node);
  return node;
}

const clockText = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export class ChaseHud {
  private clock: ServerClock;
  private mode: RoomMode;
  private timerEl: HTMLElement;
  private roleEl: HTMLElement;
  private bannerEl: HTMLElement;
  private resultsEl: HTMLElement;
  private bots: BotControls;
  private state: RoundState = "waiting";
  private endsAt: number | null = null;
  private chaser = false;
  private chaserCount = 0;
  private total = 0;
  private bannerTimer: number | undefined;

  // onBots: ask the server to add or remove a bot.
  constructor(hud: HTMLElement, clock: ServerClock, mode: RoomMode, roomName: string, onBots: (action: "add" | "remove") => void) {
    this.clock = clock;
    this.mode = mode;

    // Bot controls live in the pause panel (press Esc), where the mouse is free.
    this.bots = new BotControls(onBots);
    const panel = el("div", "run", hud); // same look as the parkour panel
    el("div", "run-name", panel).textContent = roomName;
    this.timerEl = el("div", "run-timer", panel);
    this.roleEl = el("div", "run-progress", panel);
    this.bannerEl = el("div", "banner", hud);
    this.resultsEl = el("div", "results", hud);
    this.resultsEl.hidden = true;
  }

  get isChaser(): boolean {
    return this.chaser;
  }

  get playing(): boolean {
    return this.state === "playing";
  }

  round(state: RoundState, endsAt: number | null): void {
    this.state = state;
    this.endsAt = endsAt;
    if (state !== "ended") this.resultsEl.hidden = true;
    if (state === "countdown") this.banner("Get ready!", 1500);
    if (state === "playing") this.banner(this.chaser ? this.chaserBanner() : "Run!", 2500);
    this.updateRole();
  }

  // ids = current chasers; total = players in the room including you.
  chasers(ids: number[], myId: number, total: number): void {
    const wasChaser = this.chaser;
    this.chaser = ids.includes(myId);
    document.body.classList.toggle("role-it", this.chaser && this.mode === "tag");
    document.body.classList.toggle("role-cursed", this.chaser && this.mode === "infection");
    if (this.state === "playing" && this.chaser && !wasChaser) this.banner(this.chaserBanner(), 2500);
    if (this.state === "playing" && !this.chaser && wasChaser && this.mode === "tag") this.banner("Tagged! Now run!", 2000);
    this.chaserCount = ids.length;
    this.total = total;
    this.updateRole();
  }

  botCount(count: number, max: number): void {
    this.bots.update(count, max);
  }

  result(title: string, lines: string[]): void {
    this.resultsEl.replaceChildren();
    const h = document.createElement("h2");
    h.textContent = title; // textContent, never innerHTML: contains player names
    this.resultsEl.appendChild(h);
    for (const line of lines) {
      const div = document.createElement("div");
      div.textContent = line;
      this.resultsEl.appendChild(div);
    }
    this.resultsEl.hidden = false;
  }

  private chaserBanner(): string {
    return this.mode === "tag" ? "You're It! Tag someone (click)" : "You carry the curse! Touch them (click)";
  }

  private updateRole(): void {
    const { chaserCount, total } = this;
    if (this.state === "waiting") {
      this.roleEl.textContent = "Waiting for 2+ players \u00b7 Esc to add bots";
      return;
    }
    if (this.state !== "playing") {
      this.roleEl.textContent = this.state === "countdown" ? "Round starting" : "Round over";
      return;
    }
    if (this.mode === "tag") {
      this.roleEl.textContent = this.chaser ? "You're It! Click to tag" : "Don't get tagged";
    } else {
      const survivors = total - chaserCount;
      const role = this.chaser ? "You're cursed: click to spread it" : "Survive!";
      this.roleEl.textContent = chaserCount ? `${role} · ${survivors} survivor${survivors === 1 ? "" : "s"} left` : role;
    }
  }

  update(): void {
    const left = this.endsAt === null ? 0 : this.endsAt - this.clock.now();
    switch (this.state) {
      case "waiting":
        this.timerEl.textContent = "—";
        break;
      case "countdown":
        this.timerEl.textContent = `Starting in ${Math.max(1, Math.ceil(left / 1000))}`;
        break;
      case "playing":
        this.timerEl.textContent = clockText(left);
        break;
      case "ended":
        this.timerEl.textContent = `Next round in ${Math.max(1, Math.ceil(left / 1000))}`;
        break;
    }
  }

  private banner(text: string, ms: number): void {
    this.bannerEl.textContent = text;
    this.bannerEl.classList.add("show");
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.bannerEl.classList.remove("show"), ms);
  }
}
