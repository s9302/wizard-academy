// The window that opens when you press E at a hub station: the Spellbook
// (pick your left-click spell, see your perks), the Wardrobe (hat and robe),
// the Chronicle (the story so far) and the lore tablets.
//
// Choices go to the server ("loadout"), which checks they're unlocked and
// saves them; the panel redraws when the server confirms.

import { SPELLS } from "../../../shared/src/combat.ts";
import type { Station } from "../../../shared/src/levels/types.ts";
import { CHAPTERS, chaptersDone, TABLETS } from "../../../shared/src/story.ts";
import {
  type Hat,
  HAT_NAMES,
  HATS,
  type Loadout,
  PRIMARY_SPELLS,
  type PrimarySpell,
  requirementText,
  type Robe,
  ROBE_COLORS,
  ROBE_NAMES,
  ROBES,
  UNLOCKS,
  unlocksFor,
  unlocksForChapter,
} from "../../../shared/src/unlocks.ts";

export type PanelProfile = { xp: number; bestTimes: Record<string, number>; loadout: Loadout; isAdmin: boolean };

const SPELL_TEXT: Record<PrimarySpell, string> = {
  bolt: "20 damage, fast. The reliable one.",
  frost: "14 damage, and whoever it hits is slowed for 1.5 s.",
  spark: "Three sparks in a fan, 9 damage each. Only reaches 20 m.",
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, parent: HTMLElement, text = "", className = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text) node.textContent = text; // never innerHTML
  if (className) node.className = className;
  parent.appendChild(node);
  return node;
}

export class HubPanel {
  private root: HTMLElement;
  private body: HTMLElement;
  private station: Station | null = null;
  private profile: PanelProfile;
  private save: (loadout: Loadout) => void;
  private onClose: () => void;

  constructor(profile: PanelProfile, save: (loadout: Loadout) => void, onClose: () => void) {
    this.profile = profile;
    this.save = save;
    this.onClose = onClose;
    this.root = document.getElementById("hub-panel")!;
    this.body = document.getElementById("hub-panel-body")!;
    document.getElementById("hub-panel-close")!.onclick = () => this.close(true);
  }

  get isOpen(): boolean {
    return this.station !== null;
  }

  open(station: Station): void {
    this.station = station;
    this.root.hidden = false;
    this.render();
  }

  // relock: closed with the button (a click, so the mouse can be captured again).
  close(relock = false): void {
    if (!this.station) return;
    this.station = null;
    this.root.hidden = true;
    if (relock) this.onClose();
  }

  // The server saved a new loadout (or XP changed): redraw.
  update(profile: PanelProfile): void {
    this.profile = profile;
    if (this.station) this.render();
  }

  private render(): void {
    const s = this.station!;
    this.body.replaceChildren();
    if (s.kind === "spellbook") this.spellbook();
    else if (s.kind === "wardrobe") this.wardrobe();
    else if (s.kind === "chronicle") this.chronicle();
    else this.tablet(s.tablet ?? "");
  }

  private get unlocked(): Set<string> {
    return unlocksFor(this.profile);
  }

  private lockText(id: string): string | null {
    if (this.unlocked.has(id)) return null;
    const u = UNLOCKS.find((x) => x.id === id);
    return u ? requirementText(u.requires) : "Locked";
  }

  // A row of choices: equipped, choose, or locked (with how to unlock it).
  private choice(parent: HTMLElement, name: string, detail: string, unlockId: string, equipped: boolean, pick: () => void, swatch?: string): void {
    const card = el("div", parent, "", "choice");
    if (swatch) el("span", card, "", "swatch").style.background = swatch;
    const text = el("div", card, "", "choice-text");
    el("div", text, name, "choice-name");
    if (detail) el("div", text, detail, "choice-detail");
    const lock = this.lockText(unlockId);
    if (lock) {
      card.classList.add("locked");
      el("div", card, lock, "choice-lock");
    } else if (equipped) {
      el("div", card, "Equipped", "choice-on");
    } else {
      const button = el("button", card, "Choose");
      button.type = "button";
      button.onclick = pick;
    }
  }

  private spellbook(): void {
    const b = this.body;
    el("h2", b, "Spellbook");
    el("p", b, "Your left-click spell in the battle royale. They share one cooldown, so pick the one that suits you.", "panel-hint");
    for (const spell of PRIMARY_SPELLS) {
      const def = SPELLS[spell];
      this.choice(b, def.name, SPELL_TEXT[spell], `spell:${spell}`, this.profile.loadout.primary === spell, () =>
        this.save({ ...this.profile.loadout, primary: spell }),
      );
    }
    el("h3", b, "Perks");
    el("p", b, "Movement perks work everywhere except the trials, so trial times stay comparable.", "panel-hint");
    for (const id of ["perk:doubleJump", "perk:dash"]) {
      const u = UNLOCKS.find((x) => x.id === id)!;
      const card = el("div", b, "", "choice");
      const text = el("div", card, "", "choice-text");
      el("div", text, u.name, "choice-name");
      el("div", text, u.description, "choice-detail");
      const lock = this.lockText(id);
      if (lock) {
        card.classList.add("locked");
        el("div", card, lock, "choice-lock");
      } else el("div", card, "Active", "choice-on");
    }
    el("p", b, "Fireball (right click) comes from Fire Tomes in the arena.", "panel-hint");
  }

  private wardrobe(): void {
    const b = this.body;
    const look = this.profile.loadout;
    el("h2", b, "Wardrobe");
    el("h3", b, "Hat");
    for (const hat of HATS as Hat[]) {
      this.choice(b, HAT_NAMES[hat], "", `hat:${hat}`, look.hat === hat, () => this.save({ ...look, hat }));
    }
    el("h3", b, "Robe");
    for (const robe of ROBES as Robe[]) {
      const swatch = robe === "auto" ? "linear-gradient(90deg, #e86f6f, #6fe8a8, #6f8fe8)" : ROBE_COLORS[robe];
      this.choice(b, ROBE_NAMES[robe], "", `robe:${robe}`, look.robe === robe, () => this.save({ ...look, robe }), swatch);
    }
  }

  private chronicle(): void {
    const b = this.body;
    const done = chaptersDone(this.profile.bestTimes);
    el("h2", b, "The Chronicle");
    el("p", b, `Chapters completed: ${done.length} of ${CHAPTERS.length}. Each trial is a chapter; clear it to finish it.`, "panel-hint");
    for (const c of CHAPTERS) {
      const section = el("div", b, "", done.includes(c.id) ? "chapter done" : "chapter");
      el("h3", section, `${c.title}${done.includes(c.id) ? "  ✓" : ""}`);
      for (const line of c.intro) el("p", section, line);
      if (done.includes(c.id)) for (const line of c.outro) el("p", section, line, "outro");
      const rewards = unlocksForChapter(c.id).map((u) => u.name).join(", ");
      el("p", section, `${done.includes(c.id) ? "Unlocked" : "Unlocks"}: ${rewards}`, "panel-hint");
    }
  }

  private tablet(id: string): void {
    const t = TABLETS[id];
    if (!t) return;
    el("h2", this.body, t.title);
    for (const line of t.lines) el("p", this.body, line);
  }
}
