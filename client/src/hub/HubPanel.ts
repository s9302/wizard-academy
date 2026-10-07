// The window that opens when you press E at a hub station: the Spellbook
// (pick your left-click spell, see your perks), the Wardrobe (hat and robe),
// the Chronicle (the story so far) and the lore tablets.
//
// Choices go to the server ("loadout"), which checks they're unlocked and
// saves them; the panel redraws when the server confirms.

import { SPELLS } from "../../../shared/src/combat.ts";
import {
  FACE_NAMES,
  FACES,
  HAIR_COLOR_VALUES,
  HAIR_COLORS,
  HAIR_NAMES,
  HAIRS,
  LOCKED_OUTFITS,
  OUTFIT_NAMES,
  OUTFITS,
  SKIN_COLORS,
  SKINS,
  ACCESSORIES,
  ACCESSORY_NAMES,
  FEATURES,
  FEATURE_NAMES,
} from "../../../shared/src/appearance.ts";
import { getHallOfFame, TRIALS } from "./hallOfFame.ts";
import { HOUSES, type HouseId } from "../../../shared/src/houses.ts";
import { drawEmblem } from "../levels/paintings.ts";
import { WardrobePreview } from "./WardrobePreview.ts";
import { formatTime } from "../ParkourHud.ts";
import { levelInfo } from "../../../shared/src/progression.ts";
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
  lookOf,
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
  private myName: () => string;
  private sendLoadout: (loadout: Loadout) => void;
  private onClose: () => void;
  private myId: () => number;
  // Wardrobe: what you're trying on (saved shortly after you stop clicking,
  // since the server takes one save every 400 ms), the preview, the tab.
  private draft: Loadout | null = null;
  private saveTimer: number | undefined;
  private pendingSave = false;
  private preview: WardrobePreview | null = null;
  private tab = "outfit";

  constructor(profile: PanelProfile, save: (loadout: Loadout) => void, onClose: () => void, myId: () => number = () => 1, myName: () => string = () => "") {
    this.myName = myName;
    this.profile = profile;
    this.sendLoadout = save;
    this.onClose = onClose;
    this.myId = myId;
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
    this.root.classList.toggle("wide", station.kind === "wardrobe");
    this.render();
  }

  // The Wardrobe from anywhere in the hub (the pause panel's button).
  openWardrobe(): void {
    this.open({ id: "wardrobe", kind: "wardrobe", pos: [0, 0, 0], label: "Wardrobe" });
  }

  // relock: closed with the button (a click, so the mouse can be captured again).
  close(relock = false): void {
    if (!this.station) return;
    this.flushSave();
    this.station = null;
    this.root.hidden = true;
    this.preview?.dispose();
    this.preview = null;
    if (relock) this.onClose();
  }

  private save(loadout: Loadout): void {
    this.draft = loadout;
    this.pendingSave = true;
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.flushSave(), 450);
    if (this.station?.kind === "wardrobe") {
      this.preview?.setLook(lookOf(loadout));
      this.render();
    } else this.flushSave();
  }

  private flushSave(): void {
    window.clearTimeout(this.saveTimer);
    if (this.draft && this.pendingSave) this.sendLoadout(this.draft);
    this.pendingSave = false;
  }

  // The server saved a new loadout (or XP changed): redraw.
  update(profile: PanelProfile): void {
    this.profile = profile;
    // Nothing waiting to be sent: show what the server saved (it may have
    // refused something locked).
    if (!this.pendingSave) this.draft = null;
    if (this.station) this.render();
  }

  private get current(): Loadout {
    return this.draft ?? this.profile.loadout;
  }

  private render(): void {
    const s = this.station!;
    if (s.kind !== "wardrobe" && this.preview) {
      this.preview.dispose();
      this.preview = null;
    }
    // Keep the preview canvas across redraws (it's a WebGL context).
    const keep = this.preview?.canvas;
    keep?.remove();
    this.body.replaceChildren();
    if (s.kind === "spellbook") this.spellbook();
    else if (s.kind === "wardrobe") this.wardrobe();
    else if (s.kind === "chronicle") this.chronicle();
    else if (s.kind === "leaderboard") this.champions();
    else if (s.kind === "house" && s.house) this.houseRoll(s.house);
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
    const look = this.current;
    el("h2", b, "Wardrobe");
    const layout = el("div", b, "", "wardrobe");
    const left = el("div", layout, "", "wardrobe-left");
    if (!this.preview) this.preview = new WardrobePreview(this.myId(), lookOf(look));
    left.appendChild(this.preview.canvas);
    el("div", left, "Drag to turn", "panel-hint");
    const right = el("div", layout, "", "wardrobe-right");
    const tabs = el("div", right, "", "wardrobe-tabs");
    const TABS: [string, string][] = [
      ["outfit", "Outfit"],
      ["robe", "Color"],
      ["hat", "Hat"],
      ["hair", "Hair"],
      ["hairColor", "Hair color"],
      ["skin", "Skin"],
      ["face", "Face"],
      ["features", "Features"],
      ["acc", "Accessory"],
    ];
    for (const [id, name] of TABS) {
      const t = el("button", tabs, name, id === this.tab ? "tab on" : "tab");
      t.type = "button";
      t.onclick = () => {
        this.tab = id;
        this.render();
      };
    }
    const list = el("div", right, "", "wardrobe-options");
    // A chip: a choice, with a swatch, maybe locked.
    const chip = (label: string, on: boolean, pick: () => void, swatch?: string, unlockId?: string) => {
      const lock = unlockId ? this.lockText(unlockId) : null;
      const button = el("button", list, "", `chip${on ? " on" : ""}${lock ? " locked" : ""}`);
      button.type = "button";
      if (swatch) el("span", button, "", "swatch").style.background = swatch;
      el("span", button, label);
      if (lock) {
        el("small", button, lock);
        button.disabled = true;
      } else button.onclick = pick;
    };
    switch (this.tab) {
      case "outfit":
        for (const o of OUTFITS) chip(OUTFIT_NAMES[o], look.outfit === o, () => this.save({ ...look, outfit: o }), undefined, LOCKED_OUTFITS[o]);
        break;
      case "robe":
        for (const robe of ROBES as Robe[]) {
          const swatch = robe === "auto" ? "linear-gradient(90deg, #e86f6f, #6fe8a8, #6f8fe8)" : ROBE_COLORS[robe];
          chip(ROBE_NAMES[robe], look.robe === robe, () => this.save({ ...look, robe }), swatch, `robe:${robe}`);
        }
        break;
      case "hat":
        for (const hat of HATS as Hat[]) chip(HAT_NAMES[hat], look.hat === hat, () => this.save({ ...look, hat }), undefined, `hat:${hat}`);
        break;
      case "hair":
        for (const h of HAIRS) chip(HAIR_NAMES[h], look.hair === h, () => this.save({ ...look, hair: h }));
        break;
      case "hairColor":
        for (const c of HAIR_COLORS) chip(c[0].toUpperCase() + c.slice(1), look.hairColor === c, () => this.save({ ...look, hairColor: c }), HAIR_COLOR_VALUES[c]);
        break;
      case "skin":
        for (const sk of SKINS) chip(sk[0].toUpperCase() + sk.slice(1), look.skin === sk, () => this.save({ ...look, skin: sk }), SKIN_COLORS[sk]);
        break;
      case "face":
        for (const f of FACES) chip(FACE_NAMES[f], look.face === f, () => this.save({ ...look, face: f }));
        break;
      case "features": {
        // Any number at once: each chip turns one on or off.
        const on = look.features ?? [];
        for (const f of FEATURES) chip(FEATURE_NAMES[f], on.includes(f), () => this.save({ ...look, features: on.includes(f) ? on.filter((x) => x !== f) : [...on, f] }));
        break;
      }
      case "acc":
        for (const a of ACCESSORIES) chip(ACCESSORY_NAMES[a], (look.acc ?? "none") === a, () => this.save({ ...look, acc: a }));
        break;
    }
    el("p", right, "Changes save automatically. Everyone sees your new look right away.", "panel-hint");
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

  // A house's roll, in its common room: join it (or switch to it).
  private houseRoll(id: HouseId): void {
    const b = this.body;
    const h = HOUSES[id];
    const mine = this.current.house;
    const crest = el("canvas", b, "", "house-crest");
    crest.width = crest.height = 120;
    const g = crest.getContext("2d")!;
    g.fillStyle = h.color;
    g.beginPath();
    g.moveTo(14, 8);
    g.lineTo(106, 8);
    g.lineTo(106, 60);
    g.quadraticCurveTo(106, 96, 60, 112);
    g.quadraticCurveTo(14, 96, 14, 60);
    g.closePath();
    g.fill();
    g.lineWidth = 5;
    g.strokeStyle = h.trim;
    g.stroke();
    drawEmblem(g, h.emblem, 60, 54, 64, h.trim);
    el("h2", b, h.name).style.color = h.color;
    el("p", b, `“${h.motto}”`, "panel-hint");
    if (mine === id) {
      el("p", b, `You're in ${h.name}. Its crest is on your robe, and this common room is yours.`);
      return;
    }
    el("p", b, mine ? `You're in ${HOUSES[mine].name} now. You can switch, but your old house will miss you.` : "Sign the roll to join. Your house crest goes on your robe for everyone to see.");
    const join = el("button", b, mine ? `Switch to ${h.name}` : `Join ${h.name}`);
    join.type = "button";
    join.onclick = () => this.save({ ...this.current, house: id });
  }

  // The Hall of Champions' lectern: the full leaderboards.
  private champions(): void {
    const b = this.body;
    el("h2", b, "Hall of Champions");
    const status = el("p", b, "Reading the ledger…", "panel-hint");
    void getHallOfFame().then((data) => {
      if (this.station?.kind !== "leaderboard" || !status.isConnected) return; // closed meanwhile
      if (!data) {
        status.textContent = "The ledger can't be read right now. Try again in a moment.";
        return;
      }
      status.textContent = "Updated every minute. Your own name is highlighted.";
      const me = this.myName();
      const table = (title: string, rows: [string, string, string][]) => {
        el("h3", b, title);
        if (!rows.length) {
          el("p", b, "Nobody yet. It could be you.", "panel-hint");
          return;
        }
        const t = el("table", b, "", "champions");
        rows.forEach(([rank, name, value]) => {
          const tr = el("tr", t, "", name === me ? "me" : "");
          el("td", tr, rank, "rank");
          el("td", tr, name);
          el("td", tr, value, "value");
        });
      };
      table("Most experience", data.xp.map((r, i) => [`${i + 1}.`, r.name, `Level ${levelInfo(r.xp).level} · ${r.xp.toLocaleString()} XP`]));
      for (const t of TRIALS) {
        table(`${t.short}: ${t.title}`, (data.times[t.id] ?? []).map((e, i) => [`${i + 1}.`, e.name, formatTime(e.time)]));
      }
    });
  }

  private tablet(id: string): void {
    const t = TABLETS[id];
    if (!t) return;
    el("h2", this.body, t.title);
    for (const line of t.lines) el("p", this.body, line);
  }
}
