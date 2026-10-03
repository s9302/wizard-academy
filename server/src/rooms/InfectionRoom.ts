// Infection, themed as a spreading curse: the cursed chase everyone else, and
// anyone they touch is cursed too, for the rest of the round. The survivors
// win if anyone is still uncursed when time runs out; the curse wins if it
// takes everyone. Same rules engine as tag (ChaseRoom), different consequences.

import { XP } from "../xp.ts";
import type { Player } from "./Room.ts";
import { ChaseRoom } from "./ChaseRoom.ts";

// The newly cursed take a moment to "turn" before they can spread it.
const TURNING_MS = 1_500;

export class InfectionRoom extends ChaseRoom {
  private curses = new Map<number, number>(); // id -> how many they cursed
  private survivorsAtStart = 0;

  protected pickInitialChasers(ids: number[]): number[] {
    // One curse-bearer, or two in a bigger game so it doesn't drag.
    const shuffled = [...ids].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, ids.length >= 6 ? 2 : 1);
  }

  protected onRoundStart(): void {
    this.curses.clear();
    this.survivorsAtStart = this.players.size;
  }

  protected applyTag(tagger: Player, victim: Player, now: number): void {
    this.makeChaser(victim.conn.id, now, TURNING_MS);
    this.curses.set(tagger.conn.id, (this.curses.get(tagger.conn.id) ?? 0) + 1);
  }

  protected isRoundOver(): boolean {
    return this.chasers.size >= this.players.size; // nobody left to curse
  }

  protected lateJoinerIsChaser(): boolean {
    return true; // you arrive already cursed
  }

  protected results(): { title: string; lines: string[] } {
    const survivors = [...this.players.keys()].filter((id) => !this.chasers.has(id)).map((id) => this.nameOf(id));
    const spreaders = [...this.curses.entries()]
      .filter(([id]) => this.players.has(id))
      .sort((a, b) => b[1] - a[1])
      .map(([id, n]) => `${this.nameOf(id)} spread the curse ${n} time${n === 1 ? "" : "s"}`);

    if (survivors.length > 0) {
      return {
        title: survivors.length === 1 ? `${survivors[0]} survived the curse!` : "The survivors held out!",
        lines: [`Survivors: ${survivors.join(", ")}`, ...spreaders.slice(0, 3)],
      };
    }
    return {
      title: "The curse claimed everyone.",
      lines: [`All ${this.survivorsAtStart} wizards fell to the curse.`, ...spreaders.slice(0, 3)],
    };
  }

  protected xpAwards(): { id: number; amount: number; reason: string }[] {
    const awards: { id: number; amount: number; reason: string }[] = [];
    for (const id of this.players.keys()) {
      awards.push({ id, amount: XP.roundPlayed, reason: "Round played" });
      if (!this.chasers.has(id)) awards.push({ id, amount: XP.infectionSurvivor, reason: "Survived the curse" });
      const curses = Math.min(this.curses.get(id) ?? 0, XP.maxTagsPaid);
      if (curses) awards.push({ id, amount: curses * XP.perCurse, reason: `Cursed ${curses}` });
    }
    return awards;
  }

  protected describeTag(tagger: Player, victim: Player): string {
    const left = this.players.size - this.chasers.size;
    return `${tagger.conn.name} cursed ${victim.conn.name}! ${left} survivor${left === 1 ? "" : "s"} left.`;
  }

  protected describeStart(names: string[]): string {
    return `${names.join(" and ")} ${names.length === 1 ? "carries" : "carry"} the curse. Don't let them touch you!`;
  }
}
