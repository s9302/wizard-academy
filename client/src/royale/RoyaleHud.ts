// On-screen info for the battle royale: the round and storm (top), your
// health, shield and spells (bottom), red flashes when you're hurt, a hit
// marker when your spell lands, and a purple haze while you're in the storm.
// Like the other HUDs, it only shows what the server decided.

import { ABILITIES, type AbilityId, abilityLevel, CLASS_ABILITY_POOL } from "../../../shared/src/abilities.ts";
import { abilityAllowed } from "../../../shared/src/unlocks.ts";
import { abilityInfo, weaponInfo } from "../../../shared/src/abilityInfo.ts";
import { attachTooltip, hideTooltip } from "../ui/Tooltip.ts";
import { CLASS_IDS, CLASSES, type ClassId, type Hand, SWAP_MS, WEAPONS, weaponOf } from "../../../shared/src/classes.ts";
import { MAX_HEALTH, SPELLS } from "../../../shared/src/combat.ts";
import { LEVELS } from "../../../shared/src/levels/index.ts";
import type { HordeMsg, LineupEntry, RoundState, RoyaleMode } from "../../../shared/src/protocol.ts";
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
  private boss: boolean;
  bossHint = "get out of the red circles"; // what the boss fight's HUD line says (Game sets it)
  private ctf: boolean;
  private horde: boolean;
  private hordeInfo: HordeMsg = { t: "horde", wave: 0, left: 0, nextAt: null, best: 0 };
  private respawnEl!: HTMLElement;
  private respawnAt = 0; // performance.now(): knocked out, back then (capture the flag)
  private actions: { onMode: (mode: RoyaleMode) => void; onPickTeam: (team: 0 | 1 | null) => void; onBotSet: (id: number, change: { cls?: ClassId; team?: 0 | 1 }) => void };
  private match: HTMLElement; // left column: ready, mode, teams, arena vote, monsters
  private modeBox: HTMLElement;
  private teamBox: HTMLElement;
  private botList: HTMLElement;
  private lastLineup: [LineupEntry[], RoyaleMode, RoyaleMode, number] | null = null;
  private readyButton: HTMLButtonElement;
  // The ready vote: how many have voted, how many it needs, and me.
  private readyVotes = { count: 0, needed: 0, mine: false, on: false };
  // A team round: my team (0 red, 1 blue) and how many of each are standing.
  private team: 0 | 1 | null = null;
  private teamAlive: [number, number] = [0, 0];
  private abilityPicker: HTMLElement;
  private onAbilities: (e: AbilityId, r: AbilityId) => void;
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
    actions: {
      onBots: (action: "add" | "remove") => void;
      onMonsters: (action: "add" | "remove") => void;
      onClass: (cls: ClassId) => void;
      onVote: (arena: string) => void;
      onAbilities: (e: AbilityId, r: AbilityId) => void;
      onMode: (mode: RoyaleMode) => void;
      onPickTeam: (team: 0 | 1 | null) => void;
      onBotSet: (id: number, change: { cls?: ClassId; team?: 0 | 1 }) => void;
      onReady: () => void;
    },
    variant: "royale" | "boss" | "ctf" | "horde" = "royale", // a boss fight (other words; no monsters, no teams), capture the flag (always teams), or Horde (like a boss fight, in waves)
  ) {
    this.clock = clock;
    this.boss = variant === "boss" || variant === "horde";
    this.horde = variant === "horde";
    this.ctf = variant === "ctf";
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
    this.onAbilities = actions.onAbilities;
    this.actions = actions;
    // Vote to start the next round (also Enter).
    this.readyButton = document.createElement("button");
    this.readyButton.type = "button";
    this.readyButton.id = "ready-button";
    this.readyButton.hidden = true;
    this.readyButton.onclick = (e) => {
      e.stopPropagation();
      actions.onReady();
    };
    this.abilityPicker = document.createElement("div");
    this.abilityPicker.id = "ability-picker";
    this.abilityPicker.onclick = (e) => e.stopPropagation();
    this.picker.appendChild(this.abilityPicker);
    this.votePanel = document.createElement("div");
    this.votePanel.id = "arena-vote";
    this.votePanel.hidden = true;
    this.votePanel.onclick = (e) => e.stopPropagation();
    this.monsterControls = new BotControls(actions.onMonsters, "monster");
    // Two columns: on the right, you (class, abilities) and the bots; on the
    // left, under the menu, the match (ready, mode, teams, next arena,
    // monsters).
    this.botList = document.createElement("div");
    this.botList.id = "bot-list";
    this.botList.onclick = (e) => e.stopPropagation();
    const botsTitle = document.createElement("div");
    botsTitle.className = "picker-title section-title";
    botsTitle.textContent = "Bots";
    this.side.append(this.picker, botsTitle, document.getElementById("bot-controls")!, this.botList);
    this.match = document.createElement("div");
    this.match.id = "arena-match";
    this.match.onclick = (e) => e.stopPropagation();
    this.modeBox = document.createElement("div");
    this.modeBox.id = "mode-box";
    this.teamBox = document.createElement("div");
    this.teamBox.id = "team-box";
    this.match.append(this.readyButton, this.modeBox, this.teamBox, this.votePanel, document.getElementById("monster-controls")!);
    pausePanel.appendChild(this.match);
    if (this.boss) {
      document.getElementById("monster-controls")!.hidden = true;
      this.modeBox.hidden = this.teamBox.hidden = true;
    }
    if (this.ctf) document.getElementById("monster-controls")!.hidden = true;

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
    this.respawnEl = el("div", "respawn-timer", hud);
    this.respawnEl.hidden = true;
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
      // Hover: the class's numbers and both weapons'.
      attachTooltip(button, () => {
        const main = weaponInfo(def.main, "Your Spellbook spell");
        const backup = weaponInfo(def.backup);
        const brief = (i: ReturnType<typeof weaponInfo>) => i.lines.slice(0, 2).map(([, v]) => v).join(", ");
        return {
          title: def.name,
          lines: [
            ["Health", `${def.maxHealth}`],
            ["Speed", `${Math.round(def.speed * 100)}%`],
            ["Defense", def.defense ? `${Math.round(def.defense * 100)}% less damage` : "none"],
            [`1: ${main.title}`, brief(main) || main.text],
            [`2: ${backup.title}`, brief(backup) || backup.text],
          ],
          text: def.blurb,
        };
      });
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

  // Esc panel: which abilities go on E and R (this class's pool; the level
  // 11 ones are greyed out until then). Picking one already on the other
  // key swaps them.
  showAbilities(cls: ClassId, chosen: [AbilityId, AbilityId], unlocked: Set<string>): void {
    hideTooltip();
    this.abilityPicker.replaceChildren();
    const title = document.createElement("div");
    title.className = "picker-title";
    title.textContent = "Abilities";
    this.abilityPicker.appendChild(title);
    (["E", "R"] as const).forEach((key, slot) => {
      const row = document.createElement("div");
      row.className = "ability-row";
      const label = document.createElement("span");
      label.className = "ability-key";
      label.textContent = key;
      row.appendChild(label);
      for (const id of CLASS_ABILITY_POOL[cls]) {
        const b = document.createElement("button");
        b.type = "button";
        b.innerHTML = ICONS[id] ?? "";
        const allowed = abilityAllowed(cls, id, unlocked);
        b.disabled = !allowed;
        b.className = chosen[slot] === id ? "on" : "";
        attachTooltip(b, () => {
          const info = abilityInfo(id);
          return allowed ? info : { ...info, text: `${info.text} Locked: reach level ${abilityLevel(id)}.` };
        });
        b.onclick = () => {
          const next: [AbilityId, AbilityId] = [...chosen];
          if (next[1 - slot] === id) next[1 - slot] = next[slot];
          next[slot] = id;
          this.onAbilities(next[0], next[1]);
        };
        row.appendChild(b);
      }
      this.abilityPicker.appendChild(row);
    });
    const names = document.createElement("div");
    names.className = "ability-names";
    names.textContent = `E: ${ABILITIES[chosen[0]].name} \u00b7 R: ${ABILITIES[chosen[1]].name}`;
    this.abilityPicker.appendChild(names);
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
    for (const b of this.picker.querySelectorAll<HTMLButtonElement>("button[data-cls]")) {
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

  // The lineup: the mode toggle, the two teams (with a Join button each),
  // and the bots with their class and team.
  lineup(players: LineupEntry[], mode: RoyaleMode, next: RoyaleMode, myId: number): void {
    if (this.boss) return;
    this.lastLineup = [players, mode, next, myId];
    // Mode: a two-way switch for the next round.
    this.modeBox.replaceChildren();
    const title = document.createElement("div");
    title.className = "picker-title section-title";
    title.textContent = next === mode ? "Mode" : `Mode (next round: ${next === "teams" ? "Teams" : "Free-for-all"})`;
    const row = document.createElement("div");
    row.className = "mode-row";
    for (const [m, label] of [
      ["ffa", "Free-for-all"],
      ["teams", "Teams"],
    ] as [RoyaleMode, string][]) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = next === m ? "on" : "";
      b.textContent = label;
      b.onclick = () => this.actions.onMode(m);
      row.appendChild(b);
    }
    this.modeBox.append(title, row);
    this.modeBox.hidden = this.ctf; // capture the flag is always teams
    // Teams: who's on which side; Join to switch (Either to let it balance).
    this.teamBox.replaceChildren();
    this.teamBox.hidden = next !== "teams";
    if (next === "teams") {
      const meEntry = players.find((p) => p.id === myId);
      const mine = meEntry?.team ?? null; // the team I'm on now (or picked, between rounds)
      const pick = meEntry?.pick ?? null;
      const midRound = this.state === "playing" || this.state === "countdown";
      const cols = document.createElement("div");
      cols.className = "team-cols";
      for (const team of [0, 1] as const) {
        const col = document.createElement("div");
        col.className = `team-col team-${team}`;
        const head = document.createElement("strong");
        head.textContent = team === 0 ? "Red" : "Blue";
        col.appendChild(head);
        for (const p of players.filter((x) => x.team === team)) {
          const line = document.createElement("div");
          line.className = p.id === myId ? "me" : "";
          line.textContent = `${p.name}${p.bot ? "" : p.id === myId ? " (you)" : ""} \u00b7 ${CLASSES[p.cls].name}`;
          col.appendChild(line);
        }
        const join = document.createElement("button");
        join.type = "button";
        const name = team === 0 ? "Red" : "Blue";
        if (midRound && pick === team && mine !== team) {
          // Picked mid-round: it happens at the next round.
          join.textContent = "Switching next round \u2713";
          join.disabled = true;
        } else if (mine === team && (!midRound || pick === null || pick === team)) {
          join.textContent = "Your team";
          join.disabled = true;
        } else {
          join.textContent = midRound ? `Join ${name} next round` : `Join ${name}`;
        }
        join.onclick = () => this.actions.onPickTeam(team);
        col.appendChild(join);
        cols.appendChild(col);
      }
      const either = players.filter((p) => p.team === null);
      this.teamBox.appendChild(cols);
      if (midRound && pick !== null && pick !== mine) {
        const note = document.createElement("div");
        note.className = "team-either";
        note.textContent = `You'll be on ${pick === 0 ? "Red" : "Blue"} from the next round.`;
        this.teamBox.appendChild(note);
      }
      if (either.length) {
        const note = document.createElement("div");
        note.className = "team-either";
        note.textContent = `Either team (balanced at the start): ${either.map((p) => p.name).join(", ")}`;
        this.teamBox.appendChild(note);
      }
    }
    // Bots: a class for each, and a team in team rounds.
    this.botList.replaceChildren();
    for (const p of players.filter((x) => x.bot)) {
      const row = document.createElement("div");
      row.className = "bot-row";
      const name = document.createElement("span");
      name.textContent = p.name;
      const cls = document.createElement("select");
      for (const c of CLASS_IDS) {
        const o = document.createElement("option");
        o.value = c;
        o.textContent = CLASSES[c].name;
        o.selected = c === p.cls;
        cls.appendChild(o);
      }
      cls.onchange = () => this.actions.onBotSet(p.id, { cls: cls.value as ClassId });
      row.append(name, cls);
      if (next === "teams") {
        for (const team of [0, 1] as const) {
          const b = document.createElement("button");
          b.type = "button";
          b.className = `team-dot team-${team}${p.team === team ? " on" : ""}`;
          b.title = team === 0 ? "Red team" : "Blue team";
          b.textContent = team === 0 ? "R" : "B";
          b.onclick = () => this.actions.onBotSet(p.id, { team });
          row.appendChild(b);
        }
      }
      this.botList.appendChild(row);
    }
  }

  // Knocked out (capture the flag): count down to coming back.
  respawnIn(ms: number): void {
    this.respawnAt = performance.now() + ms;
  }

  // Who has voted to start the next round.
  readyState(count: number, needed: number, mine: boolean, on: boolean): void {
    this.readyVotes = { count, needed, mine, on };
    this.showReady();
  }

  private showReady(): void {
    const between = this.state === "waiting" || this.state === "ended";
    const { count, needed, mine, on } = this.readyVotes;
    this.readyButton.hidden = !on || !between;
    this.readyButton.textContent = mine ? `Voted to start (${count}/${needed}): click to take it back` : `Vote to start the round (${count}/${needed})`;
    this.readyButton.classList.toggle("on", mine);
  }

  // Between rounds, waiting for votes? What the HUD's info line says.
  private readyLine(): string | null {
    const { count, needed, mine, on } = this.readyVotes;
    if (!on) return null;
    return mine ? `Voted to start \u00b7 ${count}/${needed}` : `Press Enter to vote start \u00b7 ${count}/${needed}`;
  }

  // A team round started (or ended: null).
  setTeam(team: 0 | 1 | null, alive: [number, number]): void {
    const changed = team !== this.team;
    this.team = team;
    this.teamAlive = alive;
    if (changed && team !== null) this.banner(`You're on the ${team === 0 ? "Red" : "Blue"} team!`, 3000);
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
    this.showReady();
    if (this.lastLineup) this.lineup(...this.lastLineup); // "next round" wording depends on the state
    if (state === "countdown") this.banner("Get ready!", 1500);
    if (state === "playing") this.banner(this.horde ? "Hold the line!" : this.boss ? "Bring it down!" : "Last wizard standing wins!", 2500);
  }

  // Horde: the wave, monsters left, the breather.
  hordeState(msg: HordeMsg): void {
    if (this.horde && msg.wave > this.hordeInfo.wave && msg.nextAt === null) this.banner(msg.wave % 5 === 0 ? `Wave ${msg.wave}: elite!` : `Wave ${msg.wave}`, 2000);
    this.hordeInfo = msg;
  }

  alive(count: number, amAlive: boolean): void {
    const wasAlive = this.amAlive;
    this.aliveCount = count;
    this.amAlive = amAlive;
    if (this.state === "playing" && wasAlive && !amAlive) this.banner(this.horde ? "You're down! Back next wave" : this.boss ? "You're down! Watching the others" : "You're out! Spectating", 3000);
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
    const back = this.respawnAt - performance.now();
    this.respawnEl.hidden = back <= 0 || this.amAlive;
    if (!this.respawnEl.hidden) this.respawnEl.textContent = `Respawning in ${Math.ceil(back / 1000)}\u2026`;
    const left = this.endsAt === null ? 0 : this.endsAt - now;
    switch (this.state) {
      case "waiting": {
        const vote = this.readyLine();
        this.timerEl.textContent = vote ? "Ready?" : "—";
        this.infoEl.textContent = vote ? `${vote}${this.boss ? "" : " · Esc to add bots"}` : "Waiting for 2+ players · Esc to add bots · practice your aim!";
        break;
      }
      case "countdown": {
        const secs = Math.max(1, Math.ceil(left / 1000));
        if (secs !== this.lastBeep && secs <= 5) sound.fx("beep", { volume: 0.5 });
        this.lastBeep = secs;
        this.timerEl.textContent = `Starting in ${secs}`;
        this.infoEl.textContent = "Spells are locked until the round starts";
        break;
      }
      case "playing": {
        if (this.horde) {
          const { wave, left: monsters, nextAt, best } = this.hordeInfo;
          const breather = nextAt !== null ? Math.max(1, Math.ceil((nextAt - now) / 1000)) : 0;
          this.timerEl.textContent = nextAt !== null ? `Wave ${wave + 1} in ${breather}` : `Wave ${wave}`;
          const status = this.amAlive ? `${this.aliveCount} fighting` : "Down · back next wave";
          this.infoEl.textContent = nextAt !== null ? `Breather · ${status}${best ? ` · best ${best}` : ""}` : `${monsters} monster${monsters === 1 ? "" : "s"} left · ${status}`;
          break;
        }
        if (this.boss) {
          this.timerEl.textContent = clockText(Math.max(0, left));
          this.infoEl.textContent = this.amAlive ? `${this.aliveCount} fighting · ${this.bossHint}` : "Down · watching the others";
          break;
        }
        if (this.team !== null) {
          const t = this.storm.timing(now);
          this.timerEl.textContent = t?.phase === "hold" ? clockText(t.msLeft) : t?.phase === "shrink" ? "Closing!" : "The storm!";
          const mine = this.team === 0 ? "Red (you)" : "Blue (you)";
          const other = this.team === 0 ? "Blue" : "Red";
          this.infoEl.textContent = `${mine} ${this.teamAlive[this.team]} \u00b7 ${other} ${this.teamAlive[1 - this.team]}${this.amAlive ? "" : " · Spectating"}`;
          break;
        }
        const t = this.storm.timing(now);
        this.timerEl.textContent = t?.phase === "hold" ? clockText(t.msLeft) : t?.phase === "shrink" ? "Closing!" : "The storm!";
        const what = t?.phase === "hold" ? "Storm moves in" : t?.phase === "shrink" ? "Storm closing" : "Storm everywhere";
        const status = this.amAlive ? `${this.aliveCount} wizards left` : "Spectating · Esc to leave";
        this.infoEl.textContent = `${what} · ${status}`;
        break;
      }
      case "ended": {
        const vote = this.readyLine();
        if (left > 0 || !vote) this.timerEl.textContent = `${this.boss ? "Next attempt" : "Next round"} in ${Math.max(1, Math.ceil(left / 1000))}`;
        else this.timerEl.textContent = this.boss ? "Fight again?" : "Next round?";
        this.infoEl.textContent = vote ?? "Round over";
        break;
      }
    }
    this.stormEl.classList.toggle("show", inStorm && this.state === "playing" && this.amAlive);
    const w = WEAPONS[weaponOf(this.cls, this.hand)];
    const full = w.kind === "spell" ? this.spellCooldown : w.kind === "projectile" ? SPELLS[w.projectile ?? "arrow"].cooldownMs : w.melee!.cooldownMs;
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
    this.match.remove();
    window.clearTimeout(this.calloutTimer);
    window.clearTimeout(this.bannerTimer);
    window.clearTimeout(this.hitTimer);
    window.clearTimeout(this.hurtTimer);
    document.body.classList.remove("spectating", "stealthed", "in-royale");
  }
}
