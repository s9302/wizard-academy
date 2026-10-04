// On-screen info for the battle royale: the round and storm (top), your
// health, shield and spells (bottom), red flashes when you're hurt, a hit
// marker when your spell lands, and a purple haze while you're in the storm.
// Like the other HUDs, it only shows what the server decided.

import { CLASS_IDS, CLASSES, type ClassId, type Hand, SWAP_MS, WEAPONS, weaponOf } from "../../../shared/src/classes.ts";
import { MAX_HEALTH, SPELLS } from "../../../shared/src/combat.ts";
import type { RoundState } from "../../../shared/src/protocol.ts";
import { BotControls } from "../BotControls.ts";
import type { ServerClock } from "../ServerClock.ts";
import type { Storm } from "./Storm.ts";

function el(tag: string, id: string, parent: HTMLElement, className = ""): HTMLElement {
  const node = document.createElement(tag);
  if (id) node.id = id;
  if (className) node.className = className;
  parent.appendChild(node);
  return node;
}

const clockText = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export class RoyaleHud {
  private clock: ServerClock;
  private storm: Storm;
  private timerEl: HTMLElement;
  private infoEl: HTMLElement;
  private bannerEl: HTMLElement;
  private resultsEl: HTMLElement;
  private hpFill: HTMLElement;
  private shieldFill: HTMLElement;
  private hpText: HTMLElement;
  private classEl: HTMLElement;
  private slots: Record<Hand, { el: HTMLElement; name: HTMLElement; cooldown: HTMLElement }>;
  private fireSlot: HTMLElement;
  private calloutEl: HTMLElement;
  private picker: HTMLElement;
  private cls: ClassId = "wizard";
  private hand: Hand = "main";
  private spellCooldown = SPELLS.bolt.cooldownMs;
  private fireCount: HTMLElement;
  private hurtEl: HTMLElement;
  private stormEl: HTMLElement;
  private crosshairEl: HTMLElement;
  private bots: BotControls;
  private state: RoundState = "waiting";
  private endsAt: number | null = null;
  private aliveCount = 0;
  private amAlive = false;
  private hp = MAX_HEALTH;
  private bannerTimer: number | undefined;
  private hitTimer: number | undefined;
  private hurtTimer: number | undefined;
  private calloutTimer: number | undefined;

  constructor(
    hud: HTMLElement,
    clock: ServerClock,
    storm: Storm,
    roomName: string,
    actions: { onBots: (action: "add" | "remove") => void; onClass: (cls: ClassId) => void },
  ) {
    this.clock = clock;
    this.storm = storm;

    // Bot controls and the class picker live in the pause panel (press Esc),
    // where the mouse is free.
    this.bots = new BotControls(actions.onBots);
    this.picker = this.makePicker(actions.onClass);

    this.crosshairEl = document.getElementById("crosshair")!;
    this.stormEl = el("div", "storm-haze", hud);
    this.hurtEl = el("div", "hurt-flash", hud);

    const panel = el("div", "run", hud); // same look as the other modes' panel
    el("div", "run-name", panel).textContent = roomName;
    this.timerEl = el("div", "run-timer", panel);
    this.infoEl = el("div", "run-progress", panel);
    this.bannerEl = el("div", "banner", hud);
    this.resultsEl = el("div", "results", hud);
    this.resultsEl.hidden = true;

    this.calloutEl = el("div", "callout", hud);
    const bottom = el("div", "royale-bottom", hud);
    this.classEl = el("div", "", bottom, "class-badge");
    const bar = el("div", "", bottom, "hp-bar");
    this.hpFill = el("div", "hp-fill", bar);
    this.shieldFill = el("div", "shield-fill", bar);
    this.hpText = el("div", "hp-text", bar);
    const slots = el("div", "spell-slots", bottom);
    const slot = (key: string): { el: HTMLElement; name: HTMLElement; cooldown: HTMLElement } => {
      const box = el("div", "", slots, "spell-slot");
      el("div", "", box, "slot-key").textContent = key;
      const name = el("div", "", box, "slot-name");
      return { el: box, name, cooldown: el("div", "", box, "slot-cooldown") };
    };
    this.slots = { main: slot("1 · Main"), backup: slot("2 · Backup") };
    this.fireSlot = el("div", "", slots, "spell-slot fire");
    el("div", "", this.fireSlot, "slot-key").textContent = "Right-click";
    el("div", "", this.fireSlot, "slot-name").textContent = SPELLS.fireball.name;
    this.fireCount = el("div", "", this.fireSlot, "slot-count");
    this.health(MAX_HEALTH, MAX_HEALTH, 0);
    this.charges(0);
  }

  // Esc panel: pick a class (sent to the server, which confirms with "equip").
  private makePicker(onClass: (cls: ClassId) => void): HTMLElement {
    const box = document.createElement("div");
    box.id = "class-picker";
    box.onclick = (e) => e.stopPropagation(); // not "click to resume"
    const title = document.createElement("div");
    title.className = "picker-title";
    title.textContent = "Class";
    box.appendChild(title);
    for (const id of CLASS_IDS) {
      const def = CLASSES[id];
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.cls = id;
      const name = document.createElement("strong");
      name.textContent = def.name;
      const blurb = document.createElement("span");
      blurb.textContent = `${def.maxHealth} health · ${def.blurb}`;
      button.append(name, blurb);
      button.onclick = () => onClass(id);
      box.appendChild(button);
    }
    document.querySelector("#overlay .panel")!.insertBefore(box, document.getElementById("bot-controls"));
    return box;
  }

  // What we're playing as and holding.
  loadout(cls: ClassId, hand: Hand, spellName: string, spellCooldownMs: number): void {
    this.cls = cls;
    this.spellCooldown = spellCooldownMs;
    this.hand = hand;
    this.classEl.textContent = CLASSES[cls].name;
    for (const h of ["main", "backup"] as Hand[]) {
      const w = weaponOf(cls, h);
      this.slots[h].name.textContent = w === "spell" ? spellName : WEAPONS[w].name;
      this.slots[h].el.classList.toggle("active", h === hand);
    }
    for (const b of this.picker.querySelectorAll<HTMLButtonElement>("button")) b.classList.toggle("on", b.dataset.cls === cls);
  }

  // "Blocked!", "Backstab!" near the crosshair.
  callout(text: string): void {
    this.calloutEl.textContent = text;
    this.calloutEl.classList.add("show");
    window.clearTimeout(this.calloutTimer);
    this.calloutTimer = window.setTimeout(() => this.calloutEl.classList.remove("show"), 700);
  }

  round(state: RoundState, endsAt: number | null): void {
    this.state = state;
    this.endsAt = endsAt;
    if (state !== "ended") this.resultsEl.hidden = true;
    if (state === "countdown") this.banner("Get ready!", 1500);
    if (state === "playing") this.banner("Last wizard standing wins!", 2500);
  }

  alive(count: number, amAlive: boolean): void {
    const wasAlive = this.amAlive;
    this.aliveCount = count;
    this.amAlive = amAlive;
    if (this.state === "playing" && wasAlive && !amAlive) this.banner("You're out! Spectating", 3000);
    document.body.classList.toggle("spectating", this.state === "playing" && !amAlive);
  }

  get canAct(): boolean {
    return this.state !== "countdown" && (this.state !== "playing" || this.amAlive);
  }

  health(hp: number, max: number, shield: number): void {
    if (hp < this.hp) this.hurt();
    this.hp = hp;
    this.hpFill.style.width = `${(100 * hp) / max}%`;
    this.hpFill.className = hp > max / 2 ? "" : hp > max / 4 ? "mid" : "low";
    this.shieldFill.style.width = `${(100 * shield) / max}%`;
    this.shieldFill.hidden = shield <= 0;
    this.hpText.textContent = shield > 0 ? `${hp} + ${shield} ward` : `${hp}`;
  }

  charges(n: number): void {
    this.fireCount.textContent = `×${n}`;
    this.fireSlot.classList.toggle("empty", n === 0);
  }

  // Your spell hit someone.
  hitMarker(): void {
    this.crosshairEl.classList.add("hit");
    window.clearTimeout(this.hitTimer);
    this.hitTimer = window.setTimeout(() => this.crosshairEl.classList.remove("hit"), 160);
  }

  private hurt(): void {
    this.hurtEl.classList.add("show");
    window.clearTimeout(this.hurtTimer);
    this.hurtTimer = window.setTimeout(() => this.hurtEl.classList.remove("show"), 180);
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

  // readyIn: ms until the hand in use can attack again; swapIn: ms of hand
  // swap left. inStorm: outside the circle.
  update(readyIn: number, swapIn: number, inStorm: boolean): void {
    const now = this.clock.now();
    const left = this.endsAt === null ? 0 : this.endsAt - now;
    switch (this.state) {
      case "waiting":
        this.timerEl.textContent = "—";
        this.infoEl.textContent = "Waiting for 2+ players · Esc to add bots · practice your aim!";
        break;
      case "countdown":
        this.timerEl.textContent = `Starting in ${Math.max(1, Math.ceil(left / 1000))}`;
        this.infoEl.textContent = "Spells are locked until the round starts";
        break;
      case "playing": {
        const t = this.storm.timing(now);
        this.timerEl.textContent = t?.phase === "hold" ? clockText(t.msLeft) : t?.phase === "shrink" ? "Closing!" : "The storm!";
        const what = t?.phase === "hold" ? "Storm moves in" : t?.phase === "shrink" ? "Storm closing" : "Storm everywhere";
        const status = this.amAlive ? `${this.aliveCount} wizards left` : "Spectating · Esc to leave";
        this.infoEl.textContent = `${what} · ${status}`;
        break;
      }
      case "ended":
        this.timerEl.textContent = `Next round in ${Math.max(1, Math.ceil(left / 1000))}`;
        this.infoEl.textContent = "Round over";
        break;
    }
    this.stormEl.classList.toggle("show", inStorm && this.state === "playing" && this.amAlive);
    const w = WEAPONS[weaponOf(this.cls, this.hand)];
    const full = w.kind === "spell" ? this.spellCooldown : w.kind === "projectile" ? SPELLS.arrow.cooldownMs : w.melee!.cooldownMs;
    const fraction = Math.min(1, Math.max(readyIn / full, swapIn / SWAP_MS));
    this.slots[this.hand].cooldown.style.height = `${fraction * 100}%`;
    this.slots[this.hand === "main" ? "backup" : "main"].cooldown.style.height = "0%";
  }

  private banner(text: string, ms: number): void {
    this.bannerEl.textContent = text;
    this.bannerEl.classList.add("show");
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.bannerEl.classList.remove("show"), ms);
  }

  dispose(): void {
    this.picker.remove();
    window.clearTimeout(this.calloutTimer);
    window.clearTimeout(this.bannerTimer);
    window.clearTimeout(this.hitTimer);
    window.clearTimeout(this.hurtTimer);
    document.body.classList.remove("spectating");
  }
}
