// On-screen info for the battle royale: the round and storm (top), your
// health, shield and spells (bottom), red flashes when you're hurt, a hit
// marker when your spell lands, and a purple haze while you're in the storm.
// Like the other HUDs, it only shows what the server decided.

import { ABILITIES, type AbilityId } from "../../../shared/src/abilities.ts";
import { CLASS_IDS, CLASSES, type ClassId, type Hand, SWAP_MS, WEAPONS, weaponOf } from "../../../shared/src/classes.ts";
import { MAX_HEALTH, SPELLS } from "../../../shared/src/combat.ts";
import { LEVELS } from "../../../shared/src/levels/index.ts";
import type { RoundState } from "../../../shared/src/protocol.ts";
import { BotControls } from "../BotControls.ts";
import type { ServerClock } from "../ServerClock.ts";
import type { Storm } from "./Storm.ts";
import { sound } from "../audio/Sound.ts";

function el(tag: string, id: string, parent: HTMLElement, className = ""): HTMLElement {
  const node = document.createElement(tag);
  if (id) node.id = id;
  if (className) node.className = className;
  parent.appendChild(node);
  return node;
}

import { ICONS } from "./icons.ts";

const clockText = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

type Slot = { el: HTMLElement; icon: HTMLElement; name: HTMLElement; cooldown: HTMLElement };

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
  private slots: Record<Hand, Slot>;
  private fireSlot: HTMLElement;
  private abilitySlots: Slot[] = [];
  private stealthEl: HTMLElement;
  private calloutEl: HTMLElement;
  private picker: HTMLElement;
  private side: HTMLElement; // pause panel column: class, vote, bots
  private votePanel: HTMLElement; // in the pause panel: buttons
  private voteCard: HTMLElement; // on screen: the tally
  private myVote: string | null = null;
  private onVote: (arena: string) => void;
  private cls: ClassId = "wizard";
  private hand: Hand = "main";
  private pendingCls: ClassId | null = null;
  private spellCooldown = SPELLS.bolt.cooldownMs;
  private spellId = "bolt";
  private fireCount: HTMLElement;
  private hurtEl: HTMLElement;
  private stormEl: HTMLElement;
  private crosshairEl: HTMLElement;
  private bots: BotControls;
  private monsterControls: BotControls;
  private state: RoundState = "waiting";
  private lastBeep = 0;
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
    actions: { onBots: (action: "add" | "remove") => void; onMonsters: (action: "add" | "remove") => void; onClass: (cls: ClassId) => void; onVote: (arena: string) => void },
  ) {
    this.clock = clock;
    this.onVote = actions.onVote;
    this.storm = storm;

    // Bot controls and the class picker live in the pause panel (press Esc),
    // where the mouse is free.
    // On wide screens they sit in a column on the right (see style.css).
    this.bots = new BotControls(actions.onBots);
    const pausePanel = document.querySelector("#overlay .panel")!;
    this.side = document.createElement("div");
    this.side.id = "arena-side";
    pausePanel.insertBefore(this.side, pausePanel.firstChild);
    this.picker = this.makePicker(actions.onClass);
    this.votePanel = document.createElement("div");
    this.votePanel.id = "arena-vote";
    this.votePanel.hidden = true;
    this.votePanel.onclick = (e) => e.stopPropagation();
    this.monsterControls = new BotControls(actions.onMonsters, "monster");
    this.side.append(this.picker, this.votePanel, document.getElementById("bot-controls")!, document.getElementById("monster-controls")!);

    document.body.classList.add("in-royale");
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
    this.stealthEl = el("div", "stealth-note", hud);
    this.stealthEl.textContent = "Hidden";
    this.voteCard = el("div", "vote-card", hud);
    this.voteCard.hidden = true;
    // Bottom center: class and health, then an action bar of square slots
    // in three groups (weapons 1/2, abilities E/R, Fireball on right-click).
    const bottom = el("div", "royale-bottom", hud);
    const vitals = el("div", "", bottom, "vitals");
    this.classEl = el("div", "", vitals, "class-badge");
    const bar = el("div", "", vitals, "hp-bar");
    this.hpFill = el("div", "hp-fill", bar);
    this.shieldFill = el("div", "shield-fill", bar);
    this.hpText = el("div", "hp-text", bar);
    const slots = el("div", "spell-slots", bottom);
    const group = (cls: string) => el("div", "", slots, `slot-group ${cls}`);
    const slot = (parent: HTMLElement, key: string): Slot => {
      const box = el("div", "", parent, "spell-slot");
      const cooldown = el("div", "", box, "slot-cooldown");
      el("div", "", box, "slot-key").textContent = key;
      const icon = el("div", "", box, "slot-icon");
      const name = el("div", "", box, "slot-name");
      return { el: box, icon, name, cooldown };
    };
    const weapons = group("weapons");
    this.slots = { main: slot(weapons, "1"), backup: slot(weapons, "2") };
    const abilities = group("abilities");
    this.abilitySlots = [slot(abilities, "E"), slot(abilities, "R")];
    for (const a of this.abilitySlots) a.el.classList.add("ability");
    const fire = slot(group("extra"), "RMB");
    this.fireSlot = fire.el;
    this.fireSlot.classList.add("fire");
    fire.icon.innerHTML = ICONS.fireball;
    fire.name.textContent = SPELLS.fireball.name;
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
    return box;
  }

  // What we're playing as and holding.
  loadout(cls: ClassId, hand: Hand, spellId: string, spellName: string, spellCooldownMs: number): void {
    this.spellId = spellId;
    this.cls = cls;
    this.spellCooldown = spellCooldownMs;
    this.hand = hand;
    this.showClass();
    for (const h of ["main", "backup"] as Hand[]) {
      const w = weaponOf(cls, h);
      const name = w === "spell" ? spellName : WEAPONS[w].name;
      this.slots[h].name.textContent = name;
      this.slots[h].icon.innerHTML = ICONS[w === "spell" ? this.spellId : w] ?? "";
      this.slots[h].el.title = name;
      this.slots[h].el.classList.toggle("active", h === hand);
    }
    this.showPicker();
  }

  // A class picked mid-round, waiting for the round to end (null: none).
  pending(cls: ClassId | null): void {
    this.pendingCls = cls;
    this.showClass();
    this.showPicker();
  }

  private showClass(): void {
    const next = this.pendingCls && this.pendingCls !== this.cls ? ` \u2192 ${CLASSES[this.pendingCls].name} next round` : "";
    this.classEl.textContent = CLASSES[this.cls].name + next;
  }

  private showPicker(): void {
    for (const b of this.picker.querySelectorAll<HTMLButtonElement>("button")) {
      b.classList.toggle("on", b.dataset.cls === this.cls);
      b.classList.toggle("next", b.dataset.cls === this.pendingCls && this.pendingCls !== this.cls);
    }
  }

  // The arena vote: options (level ids) and votes so far. Empty: closed.
  vote(options: string[], votes: Record<string, number>): void {
    if (!options.includes(this.myVote ?? "")) this.myVote = null;
    this.votePanel.replaceChildren();
    this.voteCard.replaceChildren();
    this.votePanel.hidden = this.voteCard.hidden = options.length === 0;
    if (!options.length) return;
    const title = document.createElement("div");
    title.className = "picker-title";
    title.textContent = "Vote: next arena";
    this.votePanel.appendChild(title);
    const cardTitle = document.createElement("div");
    cardTitle.className = "vote-title";
    cardTitle.textContent = "Next arena (Esc to vote)";
    this.voteCard.appendChild(cardTitle);
    for (const id of options) {
      const level = LEVELS[id];
      const size = level?.arena?.size ?? "";
      const n = votes[id] ?? 0;
      const label = `${level?.name ?? id}`;
      const count = `${n} vote${n === 1 ? "" : "s"}`;
      const button = document.createElement("button");
      button.type = "button";
      button.className = id === this.myVote ? "on" : "";
      const name = document.createElement("strong");
      name.textContent = label;
      const detail = document.createElement("span");
      detail.textContent = `${size[0]?.toUpperCase() ?? ""}${size.slice(1)} \u00b7 ${count}`;
      button.append(name, detail);
      button.onclick = () => {
        this.myVote = id;
        this.onVote(id);
      };
      this.votePanel.appendChild(button);
      const line = document.createElement("div");
      line.className = id === this.myVote ? "mine" : "";
      line.textContent = `${size} \u00b7 ${label} \u2014 ${count}`;
      this.voteCard.appendChild(line);
    }
  }

  // E and R: names, and how much of each cooldown is left (0..1).
  abilities(ids: AbilityId[], cooling: number[]): void {
    this.abilitySlots.forEach((slot, i) => {
      const name = ABILITIES[ids[i]].name;
      if (slot.name.textContent !== name) {
        slot.name.textContent = name;
        slot.icon.innerHTML = ICONS[ids[i]] ?? "";
        slot.el.title = `${name}: ${ABILITIES[ids[i]].description}`;
      }
      slot.cooldown.style.height = `${Math.min(1, cooling[i]) * 100}%`;
      slot.el.classList.toggle("cooling", cooling[i] > 0);
    });
  }

  // You've vanished (Rogue): darker screen edges and a note.
  stealthed(on: boolean): void {
    this.stealthEl.classList.toggle("show", on);
    document.body.classList.toggle("stealthed", on);
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

  monsterCount(count: number, max: number): void {
    this.monsterControls.update(count, max);
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
      case "countdown": {
        const secs = Math.max(1, Math.ceil(left / 1000));
        if (secs !== this.lastBeep && secs <= 5) sound.fx("beep", { volume: 0.5 });
        this.lastBeep = secs;
        this.timerEl.textContent = `Starting in ${secs}`;
        this.infoEl.textContent = "Spells are locked until the round starts";
        break;
      }
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
    // The bot buttons belong to the panel (tag and infection use them too).
    const panel = document.querySelector("#overlay .panel")!;
    panel.appendChild(document.getElementById("bot-controls")!);
    const monsters = document.getElementById("monster-controls")!;
    monsters.hidden = true;
    panel.appendChild(monsters);
    this.side.remove();
    window.clearTimeout(this.calloutTimer);
    window.clearTimeout(this.bannerTimer);
    window.clearTimeout(this.hitTimer);
    window.clearTimeout(this.hurtTimer);
    document.body.classList.remove("spectating", "stealthed", "in-royale");
  }
}
